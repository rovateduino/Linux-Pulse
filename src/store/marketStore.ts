import { create } from 'zustand'
import { ASSETS, DEFAULT_SYMBOL, TIMEFRAME_SECONDS } from '../data/assets'
import {
  advanceSimFeed,
  aggregateCandles,
  createSimFeed,
  currentFormingCandle,
  simNowSeconds,
  type SimFeed,
} from '../data/simulator'
import {
  CHANGE_WINDOW,
  analyzeAsset,
  evaluateNextLatest,
  forcedSignalView,
  shadowSignalView,
} from '../engine/analysis'
import { buildSweepReclaimAnalysis } from '../engine/sweepReclaim'
import type { StrategyConfig } from '../engine/strategy'
import { nextEngineConfigFromSettings, strategyConfigFromSettings } from '../lib/settings'
import { useJournalStore } from './journalStore'
import { usePlaybookDStore } from './playbookDStore'
import { getEdgeBook, loadEdgeBook, subscribeEdgeBook } from './edgeBookStore'
import type {
  AssetAnalysis,
  AssetDef,
  Candle,
  RealCandleTimeframe,
  StrategyEvaluationLog,
  Timeframe,
} from '../types/market'
import type { ModuleEvaluation } from '../engine/next'
import type { AppSettings } from '../types/trading'
import type { EngineConfig } from '../engine/next'

const REAL_TIMEFRAME_SECONDS: Record<RealCandleTimeframe, number> = {
  M1: TIMEFRAME_SECONDS['1m'],
  M5: TIMEFRAME_SECONDS['5m'],
  M15: TIMEFRAME_SECONDS['15m'],
}

const REAL_TIMEFRAME_BY_TF: Record<Timeframe, RealCandleTimeframe> = {
  '1m': 'M1',
  '5m': 'M5',
  '15m': 'M15',
}

const REAL_TIMEFRAMES: readonly RealCandleTimeframe[] = ['M1', 'M5', 'M15']
const REAL_CANDLE_RETENTION = 2_000
const hydratedBooks = new Set<string>()
const loadingBooks = new Set<string>()
const failedBooks = new Set<string>()
const edgeBookLoadErrors = new Map<string, string>()

export type RealSeries = Record<string, Partial<Record<RealCandleTimeframe, Candle[]>>>

export interface RealClock {
  /** Hora da corretora (segundos Unix) no instante em que o pacote chegou. */
  nowSec: number
  /** Relógio local (milissegundos) usado para avançar o countdown em tempo real. */
  atMs: number
}

export interface RealChartCandles {
  closed: Candle[]
  forming: Candle | null
}

function sortByTime(candles: readonly Candle[]): Candle[] {
  return [...candles].sort((left, right) => left.time - right.time)
}

function splitClosedCandles(
  candles: readonly Candle[],
  timeframeSec: number,
  nowSec: number,
): RealChartCandles {
  const sorted = sortByTime(candles)
  if (sorted.length === 0) return { closed: [], forming: null }

  const last = sorted[sorted.length - 1]
  if (last.time + timeframeSec > nowSec + 1e-6) {
    return { closed: sorted.slice(0, -1), forming: last }
  }
  return { closed: sorted, forming: null }
}

function aggregateClosedCandles(
  candles: readonly Candle[],
  sourceSec: number,
  targetSec: number,
): Candle[] {
  if (candles.length === 0) return []
  if (sourceSec === targetSec) return candles.slice()
  const expectedParts = targetSec / sourceSec
  if (!Number.isInteger(expectedParts) || expectedParts < 1) return []

  const lastEnd = candles[candles.length - 1].time + sourceSec
  const buckets = new Map<
    number,
    { candle: Candle; count: number; firstTime: number; lastTime: number; contiguous: boolean }
  >()

  for (const candle of candles) {
    const bucket = Math.floor(candle.time / targetSec) * targetSec
    if (bucket + targetSec > lastEnd + 1e-6) continue

    const current = buckets.get(bucket)
    if (current === undefined) {
      buckets.set(bucket, {
        candle: {
          time: bucket,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
        count: 1,
        firstTime: candle.time,
        lastTime: candle.time,
        contiguous: true,
      })
      continue
    }

    current.candle.high = Math.max(current.candle.high, candle.high)
    current.candle.low = Math.min(current.candle.low, candle.low)
    current.candle.close = candle.close
    current.candle.volume += candle.volume
    current.contiguous &&= candle.time === current.lastTime + sourceSec
    current.lastTime = candle.time
    current.count += 1
  }

  return [...buckets.values()]
    .filter(
      (bucket) =>
        bucket.count === expectedParts &&
        bucket.firstTime === bucket.candle.time &&
        bucket.contiguous &&
        bucket.lastTime + sourceSec === bucket.candle.time + targetSec,
    )
    .map((bucket) => bucket.candle)
}

function aggregateFormingBucket(
  candles: readonly Candle[],
  targetSec: number,
  bucketStart: number,
): Candle | null {
  const parts = candles.filter(
    (candle) => Math.floor(candle.time / targetSec) * targetSec === bucketStart,
  )
  if (parts.length === 0) return null

  const first = parts[0]
  const last = parts[parts.length - 1]
  return {
    time: bucketStart,
    open: first.open,
    high: Math.max(...parts.map((candle) => candle.high)),
    low: Math.min(...parts.map((candle) => candle.low)),
    close: last.close,
    volume: parts.reduce((total, candle) => total + candle.volume, 0),
  }
}

export function realChartCandles(
  realSeries: RealSeries,
  symbol: string,
  timeframe: Timeframe,
  nowSec: number,
): RealChartCandles | null {
  const sets = realSeries[symbol]
  if (sets === undefined) return null

  const targetSec = TIMEFRAME_SECONDS[timeframe]
  const exactKey = REAL_TIMEFRAME_BY_TF[timeframe]
  const exact = sets[exactKey]
  if (exact !== undefined && exact.length > 0) {
    return splitClosedCandles(exact, targetSec, nowSec)
  }

  const sourceKey = REAL_TIMEFRAMES.find(
    (key) => REAL_TIMEFRAME_SECONDS[key] < targetSec && (sets[key]?.length ?? 0) > 0,
  )
  if (sourceKey === undefined) return null

  const source = sets[sourceKey] ?? []
  const sourceSec = REAL_TIMEFRAME_SECONDS[sourceKey]
  const split = splitClosedCandles(source, sourceSec, nowSec)
  if (split.closed.length === 0 && split.forming === null) return null

  const closed = aggregateClosedCandles(split.closed, sourceSec, targetSec)
  let forming: Candle | null = null
  if (split.forming !== null) {
    const bucketStart = Math.floor(split.forming.time / targetSec) * targetSec
    forming = aggregateFormingBucket(source, targetSec, bucketStart)
  }

  return { closed, forming }
}

function replaceRealCandles(incoming: readonly Candle[]): Candle[] {
  return [...incoming].sort((left, right) => left.time - right.time).slice(-REAL_CANDLE_RETENTION)
}

function sanitizeRealCandles(candles: readonly Candle[]): Candle[] {
  const byTime = new Map<number, Candle>()
  for (const candle of candles) {
    const values = [candle.open, candle.high, candle.low, candle.close, candle.volume]
    if (
      !Number.isFinite(candle.time) ||
      candle.time <= 0 ||
      !values.every((value) => Number.isFinite(value)) ||
      Math.min(candle.open, candle.high, candle.low, candle.close) <= 0 ||
      candle.volume < 0 ||
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.high < candle.low
    ) {
      continue
    }

    const normalized: Candle = {
      time: Math.floor(candle.time),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }
    byTime.set(normalized.time, normalized)
  }
  return [...byTime.values()].sort((left, right) => left.time - right.time)
}

function legacyEvaluationLog(
  analysis: AssetAnalysis,
  selectedEngine: AppSettings['strategyEngine'],
): StrategyEvaluationLog {
  const isSignal =
    analysis.signal.phase === 'ENTRAR' &&
    analysis.signal.triggerTime === analysis.lastClosedTime
  return {
    strategy: 'legacy',
    asset: analysis.symbol,
    timeframe: 'M5',
    mode: 'standard',
    candleTime: analysis.lastClosedTime,
    result: isSignal ? 'signal' : 'no_signal',
    direction: isSignal ? analysis.signal.direction : null,
    reason: analysis.signal.note,
    details: {
      phase: analysis.signal.phase,
      playbook: analysis.signal.playbook,
      selected_engine: selectedEngine,
      output_selected: selectedEngine === 'legacy',
    },
  }
}

function nextModuleEvaluationLog(
  symbol: string,
  candleTime: number | null,
  evaluation: ModuleEvaluation,
): StrategyEvaluationLog {
  const { candidate, decision } = evaluation
  const reason =
    candidate === null
      ? 'Nenhum candidato gerado por este módulo neste candle.'
      : decision?.allowed
        ? 'Candidato aprovado pelo gate estatístico; execução bloqueada no modo shadow.'
        : `Candidato bloqueado pelo gate: ${decision?.reasons.join(' · ') || 'motivo não informado'}.`

  return {
    strategy: evaluation.moduleId,
    asset: symbol,
    timeframe: 'M1',
    mode: 'standard',
    candleTime,
    result: candidate === null ? 'no_signal' : 'signal',
    direction: candidate?.direction ?? null,
    reason,
    details: {
      candidate_found: candidate !== null,
      gate_allowed: decision?.allowed ?? false,
      bucket: candidate?.bucket ?? null,
      module_reasons: candidate?.reasons ?? [],
    },
  }
}

function nextEngineErrorLog(symbol: string, candleTime: number | null, reason: string): StrategyEvaluationLog {
  return {
    strategy: 'next',
    asset: symbol,
    timeframe: 'M1',
    mode: 'standard',
    candleTime,
    result: 'no_signal',
    direction: null,
    reason,
    details: { candidate_count: 0 },
  }
}

function buildAnalysis(
  asset: AssetDef,
  feed: SimFeed,
  realSeries: RealSeries,
  nowSec: number,
  config: StrategyConfig,
  engine: AppSettings['strategyEngine'],
  nextConfig: EngineConfig,
  costCalibrated: boolean,
  sweepReclaimOnly: boolean,
  devForcedSignal = false,
  forceTimeframe: Timeframe = '1m',
): AssetAnalysis {
  const realM1 = realChartCandles(realSeries, asset.symbol, '1m', nowSec)
  const realM5 = realChartCandles(realSeries, asset.symbol, '5m', nowSec)
  const realM15 = realChartCandles(realSeries, asset.symbol, '15m', nowSec)
  let closedM1: Candle[]
  let m5Closed: Candle[]
  let m15Closed: Candle[]
  let formingM5: Candle | null

  if (realM1 === null && realSeries[asset.symbol] === undefined) {
    const m1 = feed.series[asset.symbol] ?? []
    closedM1 = aggregateCandles(m1, TIMEFRAME_SECONDS['1m'])
    m5Closed = aggregateCandles(m1, TIMEFRAME_SECONDS['5m'])
    m15Closed = aggregateCandles(m1, TIMEFRAME_SECONDS['15m'])
    formingM5 = currentFormingCandle(asset, m1, '5m', nowSec)
  } else {
    closedM1 = realM1?.closed ?? []
    const m1 = realSeries[asset.symbol]?.M1 ?? []
    m5Closed =
      realM5?.closed ??
      aggregateClosedCandles(closedM1, TIMEFRAME_SECONDS['1m'], TIMEFRAME_SECONDS['5m'])
    m15Closed =
      realM15?.closed ??
      aggregateClosedCandles(closedM1, TIMEFRAME_SECONDS['1m'], TIMEFRAME_SECONDS['15m'])
    formingM5 =
      realM5?.forming ??
      (realM1?.forming === null || realM1 === null
        ? null
        : aggregateFormingBucket(
            m1,
            TIMEFRAME_SECONDS['5m'],
            Math.floor(realM1.forming.time / TIMEFRAME_SECONDS['5m']) *
              TIMEFRAME_SECONDS['5m'],
          ))
  }

  if (sweepReclaimOnly) {
    const formingM1 =
      realM1?.forming ??
      (realM1 === null && realSeries[asset.symbol] === undefined
        ? currentFormingCandle(asset, feed.series[asset.symbol] ?? [], '1m', nowSec)
        : null)
    return {
      ...buildSweepReclaimAnalysis(asset.symbol, { closed: closedM1, forming: formingM1 }),
      nextEvaluation: null,
      engineError: null,
    }
  }

  const analysis = analyzeAsset(asset.symbol, m5Closed, m15Closed, formingM5, config)
  const legacyLog = legacyEvaluationLog(analysis, engine)

  if (devForcedSignal && import.meta.env.DEV) {
    const forceCandles =
      realChartCandles(realSeries, asset.symbol, forceTimeframe, nowSec)?.closed ??
      aggregateCandles(
        feed.series[asset.symbol] ?? [],
        TIMEFRAME_SECONDS[forceTimeframe],
      )
    return {
      ...analysis,
      signal: forcedSignalView(forceCandles),
      nextEvaluation: null,
      engineError: null,
      strategyEvaluations: [legacyLog],
    }
  }

  if (engine === 'next') {
    try {
      const bookKey = `${asset.symbol}:${nextConfig.timeframeMinutes}m`
      const loadError = edgeBookLoadErrors.get(bookKey)
      if (loadError !== undefined) throw new Error(loadError)
      if (closedM1.length === 0) {
        throw new Error('Feed M1 real indisponível; o motor shadow não usará candles simulados.')
      }
      const moduleLogs: StrategyEvaluationLog[] = []
      const evaluation = evaluateNextLatest(
        closedM1,
        nextConfig,
        getEdgeBook(asset.symbol, nextConfig.timeframeMinutes),
        costCalibrated,
        (moduleEvaluation) => {
          moduleLogs.push(
            nextModuleEvaluationLog(
              asset.symbol,
              closedM1[closedM1.length - 1]?.time ?? null,
              moduleEvaluation,
            ),
          )
        },
      )
      const window = Math.min(CHANGE_WINDOW, Math.max(0, closedM1.length - 1))
      const last = closedM1[closedM1.length - 1]
      const reference = closedM1[closedM1.length - 1 - window]
      return {
        ...analysis,
        closed: closedM1.slice(),
        records: [],
        signal: shadowSignalView(
          'Motor next em modo shadow: resultados exibidos para validação; nenhuma ordem é enviada.',
        ),
        changePct:
          last === undefined || reference === undefined || reference.close === 0
            ? 0
            : ((last.close - reference.close) / reference.close) * 100,
        changeWindow: window,
        lastClosedTime: last?.time ?? null,
        nextEvaluation: evaluation,
        engineError: null,
        strategyEvaluations: [legacyLog, ...moduleLogs],
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro inesperado ao avaliar o motor shadow.'
      return {
        ...analysis,
        closed: closedM1,
        records: [],
        signal: shadowSignalView(`Análise bloqueada: ${message}`),
        nextEvaluation: null,
        engineError: message,
        strategyEvaluations: [
          legacyLog,
          nextEngineErrorLog(
            asset.symbol,
            closedM1[closedM1.length - 1]?.time ?? null,
            message,
          ),
        ],
      }
    }
  }

  return {
    ...analysis,
    nextEvaluation: null,
    engineError: null,
    strategyEvaluations: [legacyLog],
  }
}

function buildAnalyses(
  feed: SimFeed,
  realSeries: RealSeries,
  nowSec: number,
  config: StrategyConfig,
  engine: AppSettings['strategyEngine'],
  nextConfig: EngineConfig,
  costCalibrated: boolean,
  sweepReclaimOnly: boolean,
  selectedSymbol: string,
  devForcedSignal: boolean,
  forceTimeframe: Timeframe,
): Record<string, AssetAnalysis> {
  const analyses: Record<string, AssetAnalysis> = {}
  for (const asset of ASSETS) {
    analyses[asset.symbol] = buildAnalysis(
      asset,
      feed,
      realSeries,
      nowSec,
      config,
      engine,
      nextConfig,
      costCalibrated,
      sweepReclaimOnly,
      devForcedSignal && asset.symbol === selectedSymbol,
      forceTimeframe,
    )
  }
  return analyses
}

interface MarketStore {
  feed: SimFeed
  simNowSec: number
  selectedSymbol: string
  selectedTimeframe: Timeframe
  devForcedSignal: boolean
  strategyConfig: StrategyConfig
  strategyEngine: AppSettings['strategyEngine']
  sweepReclaimOnly: boolean
  nextEngineConfig: EngineConfig
  costCalibrated: boolean
  analyses: Record<string, AssetAnalysis>
  realSeries: RealSeries
  realClock: RealClock | null
  assetHistoryClearedAt: Record<string, number>
  setSelectedSymbol: (symbol: string) => void
  clearAssetHistory: () => void
  setSelectedTimeframe: (timeframe: Timeframe) => void
  setDevForcedSignal: (enabled: boolean) => void
  setStrategyConfig: (config: StrategyConfig) => void
  setEngineSettings: (settings: AppSettings) => void
  refreshAnalysis: (symbol: string) => void
  setAnalysisError: (symbol: string, message: string) => void
  applyRealCandles: (
    asset: string,
    timeframe: RealCandleTimeframe,
    candles: readonly Candle[],
    brokerTimeSec: number,
  ) => void
  tick: () => void
}

const initialFeed = createSimFeed(Date.now())
const initialSettings = useJournalStore.getState().settings
const initialConfig = strategyConfigFromSettings(initialSettings)
const initialNextConfig = nextEngineConfigFromSettings(initialSettings)

export const useMarketStore = create<MarketStore>()((set, get) => ({
  feed: initialFeed,
  simNowSec: initialFeed.anchorSec,
  selectedSymbol: DEFAULT_SYMBOL,
  selectedTimeframe: '1m',
  devForcedSignal: false,
  strategyConfig: initialConfig,
  strategyEngine: initialSettings.strategyEngine,
  sweepReclaimOnly: initialSettings.sweepReclaimOnly,
  nextEngineConfig: initialNextConfig,
  costCalibrated: initialSettings.costCalibrated,
  analyses: buildAnalyses(
    initialFeed,
    {},
    initialFeed.anchorSec,
    initialConfig,
    initialSettings.strategyEngine,
    initialNextConfig,
    initialSettings.costCalibrated,
    initialSettings.sweepReclaimOnly,
    DEFAULT_SYMBOL,
    false,
    '1m',
  ),
  realSeries: {},
  realClock: null,
  assetHistoryClearedAt: {},

  setSelectedSymbol: (symbol) => {
    const state = get()
    if (!state.devForcedSignal) {
      set({ selectedSymbol: symbol })
      if (state.strategyEngine === 'next' && !state.sweepReclaimOnly) {
        hydrateEdgeBook(symbol, state.nextEngineConfig.timeframeMinutes)
      }
      return
    }
    set({
      selectedSymbol: symbol,
      analyses: buildAnalyses(
        state.feed,
        state.realSeries,
        state.simNowSec,
        state.strategyConfig,
        state.strategyEngine,
        state.nextEngineConfig,
        state.costCalibrated,
        state.sweepReclaimOnly,
        symbol,
        true,
        state.selectedTimeframe,
      ),
    })
  },
  clearAssetHistory: () => {
    const { selectedSymbol, simNowSec, assetHistoryClearedAt } = get()
    set({
      assetHistoryClearedAt: {
        ...assetHistoryClearedAt,
        [selectedSymbol]: simNowSec,
      },
    })
  },
  setSelectedTimeframe: (timeframe) => {
    const state = get()
    if (!state.devForcedSignal) {
      set({ selectedTimeframe: timeframe })
      return
    }
    set({
      selectedTimeframe: timeframe,
      analyses: buildAnalyses(
        state.feed,
        state.realSeries,
        state.simNowSec,
        state.strategyConfig,
        state.strategyEngine,
        state.nextEngineConfig,
        state.costCalibrated,
        state.sweepReclaimOnly,
        state.selectedSymbol,
        true,
        timeframe,
      ),
    })
  },

  setDevForcedSignal: (enabled) => {
    if (!import.meta.env.DEV) return
    const state = get()
    if (state.devForcedSignal === enabled) return
    set({
      devForcedSignal: enabled,
      analyses: buildAnalyses(
        state.feed,
        state.realSeries,
        state.simNowSec,
        state.strategyConfig,
        state.strategyEngine,
        state.nextEngineConfig,
        state.costCalibrated,
        state.sweepReclaimOnly,
        state.selectedSymbol,
        enabled,
        state.selectedTimeframe,
      ),
    })
  },

  setStrategyConfig: (config) => {
    const state = get()
    set({
      strategyConfig: config,
      analyses: buildAnalyses(
        state.feed,
        state.realSeries,
        state.simNowSec,
        config,
        state.strategyEngine,
        state.nextEngineConfig,
        state.costCalibrated,
        state.sweepReclaimOnly,
        state.selectedSymbol,
        state.devForcedSignal,
        state.selectedTimeframe,
      ),
    })
  },

  setEngineSettings: (settings) => {
    const state = get()
    const strategyConfig = strategyConfigFromSettings(settings)
    const nextEngineConfig = nextEngineConfigFromSettings(settings)
    set({
      strategyConfig,
      strategyEngine: settings.strategyEngine,
      sweepReclaimOnly: settings.sweepReclaimOnly,
      nextEngineConfig,
      costCalibrated: settings.costCalibrated,
      analyses: buildAnalyses(
        state.feed,
        state.realSeries,
        state.simNowSec,
        strategyConfig,
        settings.strategyEngine,
        nextEngineConfig,
        settings.costCalibrated,
        settings.sweepReclaimOnly,
        state.selectedSymbol,
        state.devForcedSignal,
        state.selectedTimeframe,
      ),
    })
    if (settings.strategyEngine === 'next' && !settings.sweepReclaimOnly) {
      for (const asset of ASSETS) {
        if (state.realSeries[asset.symbol]?.M1 !== undefined) {
          hydrateEdgeBook(asset.symbol, nextEngineConfig.timeframeMinutes)
        }
      }
    }
  },

  refreshAnalysis: (symbol) => {
    const state = get()
    const asset = ASSETS.find((item) => item.symbol === symbol)
    if (asset === undefined) return
    const analysis = buildAnalysis(
      asset,
      state.feed,
      state.realSeries,
      state.simNowSec,
      state.strategyConfig,
      state.strategyEngine,
      state.nextEngineConfig,
      state.costCalibrated,
      state.sweepReclaimOnly,
      state.devForcedSignal && symbol === state.selectedSymbol,
      state.selectedTimeframe,
    )
    set({ analyses: { ...state.analyses, [symbol]: analysis } })
  },

  setAnalysisError: (symbol, message) => {
    const state = get()
    const analysis = state.analyses[symbol]
    if (analysis === undefined || state.sweepReclaimOnly) return
    set({
      analyses: {
        ...state.analyses,
        [symbol]: {
          ...analysis,
          signal: shadowSignalView(`Análise bloqueada: ${message}`),
          nextEvaluation: null,
          engineError: message,
        },
      },
    })
  },

  applyRealCandles: (asset, timeframe, candles, brokerTimeSec) => {
    const state = get()
    const incoming = sanitizeRealCandles(candles)

    // [DEBUG RADAR] remover depois de diagnosticar a rotação.
    if (incoming.length === 0) {
      console.warn('[Radar] applyRealCandles DESCARTADO', {
        asset,
        timeframe,
        recebidos: candles.length,
      })
      return
    }

    const received = replaceRealCandles(incoming)

    // [DEBUG RADAR] só loga o primeiro pacote de cada ativo/timeframe para não
    // inundar o console (a cada ciclo chegam ~17 pacotes por segundo).
    if (state.realSeries[asset]?.[timeframe] === undefined) {
      console.log('[Radar] applyRealCandles OK', {
        asset,
        timeframe,
        candles: received.length,
        ativos: Object.keys(state.realSeries).length + 1,
      })
    }
    const realSeries: RealSeries = {
      ...state.realSeries,
      [asset]: {
        ...state.realSeries[asset],
        [timeframe]: received,
      },
    }

    const last = received[received.length - 1]
    const fallbackNowSec = last.time + REAL_TIMEFRAME_SECONDS[timeframe]
    const nowSec =
      Number.isFinite(brokerTimeSec) && brokerTimeSec > 0 ? brokerTimeSec : fallbackNowSec
    const realClock: RealClock = { nowSec, atMs: Date.now() }
    const assetDef = ASSETS.find((item) => item.symbol === asset)

    if (assetDef === undefined) {
      set({ realSeries, realClock, simNowSec: nowSec })
      return
    }

    const analysis = buildAnalysis(
      assetDef,
      state.feed,
      realSeries,
      nowSec,
      state.strategyConfig,
      state.strategyEngine,
      state.nextEngineConfig,
      state.costCalibrated,
      state.sweepReclaimOnly,
      state.devForcedSignal && asset === state.selectedSymbol,
      state.selectedTimeframe,
    )

    set({
      realSeries,
      realClock,
      simNowSec: nowSec,
      analyses: { ...state.analyses, [asset]: analysis },
    })
    // Modo Sombra do Playbook D: avalia o último M15 fechado de cada ativo
    // que a corretora alimenta (independente do motor de análise principal).
    if (timeframe === 'M15') {
      usePlaybookDStore.getState().hydrate()
      usePlaybookDStore.getState().ingest(asset, received, nowSec)
    }
    if (state.strategyEngine === 'next' && !state.sweepReclaimOnly && timeframe === 'M1') {
      hydrateEdgeBook(asset, state.nextEngineConfig.timeframeMinutes)
    }
  },

  tick: () => {
    const state = get()

    if (state.realClock !== null) {
      const elapsedSec = (Date.now() - state.realClock.atMs) / 1000
      const now = state.realClock.nowSec + Math.max(0, elapsedSec)
      const crossedCandleBoundary =
        Math.floor(now / TIMEFRAME_SECONDS['5m']) !==
        Math.floor(state.simNowSec / TIMEFRAME_SECONDS['5m'])

      if (crossedCandleBoundary) {
        set({
          simNowSec: now,
          analyses: buildAnalyses(
            state.feed,
            state.realSeries,
            now,
            state.strategyConfig,
            state.strategyEngine,
            state.nextEngineConfig,
            state.costCalibrated,
            state.sweepReclaimOnly,
            state.selectedSymbol,
            state.devForcedSignal,
            state.selectedTimeframe,
          ),
        })
        return
      }
      if (now !== state.simNowSec) set({ simNowSec: now })
      return
    }

    const now = simNowSeconds(state.feed, Date.now())
    const feed = advanceSimFeed(state.feed, now)

    if (feed === state.feed) {
      if (now !== state.simNowSec) set({ simNowSec: now })
      return
    }

    set({
      feed,
      simNowSec: now,
      analyses: buildAnalyses(
        feed,
        state.realSeries,
        now,
        state.strategyConfig,
        state.strategyEngine,
        state.nextEngineConfig,
        state.costCalibrated,
        state.sweepReclaimOnly,
        state.selectedSymbol,
        state.devForcedSignal,
        state.selectedTimeframe,
      ),
    })
  },
}))

function hydrateEdgeBook(symbol: string, timeframeMinutes: number): void {
  const key = `${symbol}:${timeframeMinutes}m`
  if (hydratedBooks.has(key) || loadingBooks.has(key) || failedBooks.has(key)) return
  loadingBooks.add(key)
  void loadEdgeBook(symbol, timeframeMinutes)
    .then(() => {
      hydratedBooks.add(key)
      edgeBookLoadErrors.delete(key)
    })
    .catch((error: unknown) => {
      failedBooks.add(key)
      const message =
        error instanceof Error ? error.message : 'Falha inesperada ao carregar o EdgeBook.'
      edgeBookLoadErrors.set(key, message)
      useMarketStore.getState().setAnalysisError(symbol, message)
    })
    .finally(() => loadingBooks.delete(key))
}

subscribeEdgeBook((symbol, timeframeMinutes) => {
  const state = useMarketStore.getState()
  if (
    state.strategyEngine === 'next' &&
    !state.sweepReclaimOnly &&
    state.nextEngineConfig.timeframeMinutes === timeframeMinutes
  ) {
    state.refreshAnalysis(symbol)
  }
})

useJournalStore.subscribe((state, previous) => {
  const before = previous.settings
  const after = state.settings
  if (
    before.payout === after.payout &&
    before.strategyEngine === after.strategyEngine &&
    before.sweepReclaimOnly === after.sweepReclaimOnly &&
    before.costPerTrade === after.costPerTrade &&
    before.costCalibrated === after.costCalibrated &&
    before.minTradesPerBucket === after.minTradesPerBucket &&
    before.edgeMargin === after.edgeMargin &&
    before.maxSignalsPerDay === after.maxSignalsPerDay &&
    before.utcOffsetMinutes === after.utcOffsetMinutes &&
    before.sessionOpenMinute === after.sessionOpenMinute &&
    before.sessionCloseMinute === after.sessionCloseMinute &&
    before.openingRangeMinutes === after.openingRangeMinutes &&
    before.noEntryAfterOpenMinutes === after.noEntryAfterOpenMinutes &&
    before.noEntryBeforeCloseMinutes === after.noEntryBeforeCloseMinutes &&
    before.lookbackSessions === after.lookbackSessions &&
    before.expiryCandles === after.expiryCandles &&
    before.spacingCandles === after.spacingCandles &&
    before.pauseAfterLosses === after.pauseAfterLosses &&
    before.pauseMinutes === after.pauseMinutes
  ) {
    return
  }
  useMarketStore.getState().setEngineSettings(after)
})
