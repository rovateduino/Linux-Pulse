import type {
  Candle,
  CandleDirection,
  IndicatorSnapshot,
  RegimeInfo,
  SignalPlaybook,
  SignalRecord,
  SignalView,
  SetupCondition,
} from '../types/market'
import { findAsset } from '../data/assets'
import { resolveOutcome } from '../lib/backtest/resolveOutcome'
import {
  adx,
  atr,
  bollinger,
  ema,
  normalizedSlope,
  percentileRank,
  rsi,
  type BollingerSeries,
  type Series,
} from './indicators'
import { classifyMetrics } from './regime'
import { evaluateA, evaluateB } from './playbooks/legacy'

export const WARMUP_INDEX = 209
const CANDLE_SECONDS = 300
const CONFIRMATION_SECONDS = 900

export interface StrategyConfig {
  expiryCandles: number
  spacingCandles: number
  pauseAfterLosses: number
  pauseMinutes: number
}

export interface SetupTiming {
  candleSeconds: number
  confirmationSeconds: number
}

export const DEFAULT_SETUP_TIMING: SetupTiming = {
  candleSeconds: CANDLE_SECONDS,
  confirmationSeconds: CONFIRMATION_SECONDS,
}

export const BASE_STRATEGY: StrategyConfig = {
  expiryCandles: 1,
  spacingCandles: 5,
  pauseAfterLosses: 2,
  pauseMinutes: 30,
}

export interface PreparedMarket {
  candles: readonly Candle[]
  closes: number[]
  ema20: Series
  ema50: Series
  ema200: Series
  atr: Series
  adx: Series
  rsi: Series
  bands: BollingerSeries
  bandwidthPct: Series
  slope: Series
  atrPct: Series
}

export interface PreparedConfirmation {
  candles: readonly Candle[]
  ema50: Series
}

export interface SetupEvaluation {
  playbook: SignalPlaybook | null
  direction: CandleDirection | null
  conditions: SetupCondition[]
  blockedBy: string[]
  phase: 'OBSERVANDO' | 'ATENCAO' | 'ENTRAR'
  ready: boolean
  regime: RegimeInfo['kind']
  indicators: IndicatorSnapshot
  triggerTime: number | null
}

export interface SignalAnalysis {
  view: SignalView
  records: SignalRecord[]
  prepared: PreparedMarket
  lastEvaluation: SetupEvaluation | null
}

export function prepareMarket(candles: readonly Candle[]): PreparedMarket {
  const closes = candles.map((candle) => candle.close)
  const ema20 = ema(closes, 20)
  const ema50 = ema(closes, 50)
  const ema200 = ema(closes, 200)
  const atrSeries = atr(candles, 14)
  const adxSeries = adx(candles, 14).adx
  const rsiSeries = rsi(closes, 14)
  const bands = bollinger(closes, 20, 2)

  const bandwidthPct: Series = new Array(candles.length).fill(null)
  const slope: Series = new Array(candles.length).fill(null)
  const atrPct: Series = new Array(candles.length).fill(null)
  for (let index = 0; index < candles.length; index += 1) {
    bandwidthPct[index] = trailingRank(bands.bandwidth, index, 100)
    slope[index] = normalizedSlope(ema50, atrSeries, 5, index)
    atrPct[index] = trailingRank(atrSeries, index, 100)
  }

  return {
    candles,
    closes,
    ema20,
    ema50,
    ema200,
    atr: atrSeries,
    adx: adxSeries,
    rsi: rsiSeries,
    bands,
    bandwidthPct,
    slope,
    atrPct,
  }
}

export function prepareConfirmation(candles: readonly Candle[]): PreparedConfirmation {
  return { candles, ema50: ema(candles.map((candle) => candle.close), 50) }
}

function trailingRank(series: Series, index: number, window: number): number | null {
  const current = series[index]
  if (current === null) return null
  const samples: number[] = []
  for (let cursor = index; cursor >= 0 && samples.length < window; cursor -= 1) {
    const value = series[cursor]
    if (value !== null) samples.push(value)
  }
  return percentileRank(samples, current)
}

function emptyRegime(): RegimeInfo {
  return {
    kind: 'SEM_REGIME',
    direction: null,
    adx: null,
    slope: null,
    bandwidthPct: null,
    emaAligned: false,
    ema20: null,
    ema50: null,
    ema200: null,
  }
}

export function regimeAt(prepared: PreparedMarket, index: number): RegimeInfo {
  if (index < WARMUP_INDEX || index >= prepared.candles.length) return emptyRegime()
  const adxValue = prepared.adx[index]
  const slope = prepared.slope[index]
  const bandwidthPct = prepared.bandwidthPct[index]
  const ema20 = prepared.ema20[index]
  const ema50 = prepared.ema50[index]
  const ema200 = prepared.ema200[index]

  if (
    adxValue === null ||
    slope === null ||
    bandwidthPct === null ||
    ema20 === null ||
    ema50 === null ||
    ema200 === null
  ) {
    return {
      ...emptyRegime(),
      adx: adxValue,
      slope,
      bandwidthPct,
      ema20,
      ema50,
      ema200,
    }
  }

  const alignedUp = ema20 > ema50 && ema50 > ema200
  const alignedDown = ema20 < ema50 && ema50 < ema200
  const kind = classifyMetrics({
    adx: adxValue,
    slope,
    bandwidthPct,
    emaAligned: alignedUp || alignedDown,
    alignedUp,
  })

  return {
    kind,
    direction: kind === 'TENDENCIA' ? (alignedUp ? 'UP' : 'DOWN') : null,
    adx: adxValue,
    slope,
    bandwidthPct,
    emaAligned: alignedUp || alignedDown,
    ema20,
    ema50,
    ema200,
  }
}

export function indicatorsAt(prepared: PreparedMarket, index: number): IndicatorSnapshot {
  return {
    ema20: prepared.ema20[index],
    ema50: prepared.ema50[index],
    ema200: prepared.ema200[index],
    atr: prepared.atr[index],
    adx: prepared.adx[index],
    rsi: prepared.rsi[index],
    bandwidthPct: prepared.bandwidthPct[index],
    slope: prepared.slope[index],
  }
}

function riskFilters(prepared: PreparedMarket, index: number): string[] {
  const candle = prepared.candles[index]
  const atrValue = prepared.atr[index]
  const atrRank = prepared.atrPct[index]
  if (atrValue === null || atrRank === null) {
    return ['Histórico insuficiente para os filtros de volatilidade']
  }
  const blocked: string[] = []
  if (atrRank <= 20) blocked.push('ATR abaixo do percentil 20 (mercado morto)')
  if (candle.high - candle.low > atrValue * 2.5) {
    blocked.push('Spike: range da última vela acima de 2,5× ATR')
  }
  return blocked
}

export function evaluateSetup(
  prepared: PreparedMarket,
  confirmation: PreparedConfirmation,
  index: number,
  timing: SetupTiming = DEFAULT_SETUP_TIMING,
): SetupEvaluation {
  const regime = regimeAt(prepared, index)
  const candles = prepared.candles
  const current = candles[index]
  const previous = candles[index - 1]
  const atrValue = prepared.atr[index]
  const ema20 = prepared.ema20[index]
  const ema50 = prepared.ema50[index]
  const blockedBy = riskFilters(prepared, index)
  const activePlaybook: SignalPlaybook | null =
    regime.kind === 'TENDENCIA' ? 'A' : regime.kind === 'LATERAL' ? 'B' : null

  if (current === undefined || previous === undefined || atrValue === null) {
    const conditions: SetupCondition[] = [
      { label: 'Histórico de candles', met: false },
      { label: 'Indicadores aquecidos', met: false },
    ]
    return {
      playbook: null,
      direction: null,
      conditions,
      blockedBy,
      phase: 'OBSERVANDO',
      ready: false,
      regime: regime.kind,
      indicators: indicatorsAt(prepared, index),
      triggerTime: null,
    }
  }

  const emaDirection: CandleDirection | null =
    ema20 !== null && ema50 !== null ? (ema20 >= ema50 ? 'UP' : 'DOWN') : null

  let conditions: SetupCondition[]
  let direction: CandleDirection | null

  if (activePlaybook === 'B') {
    const legacy = evaluateB(prepared, index, emaDirection, blockedBy)
    direction = legacy.direction
    conditions = legacy.conditions
  } else {
    const legacy = evaluateA(
      prepared,
      confirmation,
      index,
      timing,
      regime.direction,
      emaDirection,
      activePlaybook === 'A',
      blockedBy,
    )
    direction = legacy.direction
    conditions = legacy.conditions
  }

  const missing = conditions.slice(0, -1).filter((condition) => !condition.met).length
  const ready =
    activePlaybook !== null &&
    direction !== null &&
    blockedBy.length === 0 &&
    missing === 0
  const phase: SetupEvaluation['phase'] = ready
    ? 'ENTRAR'
    : activePlaybook !== null && direction !== null && blockedBy.length === 0 && missing === 1
      ? 'ATENCAO'
      : 'OBSERVANDO'

  return {
    playbook: activePlaybook,
    direction: phase === 'OBSERVANDO' ? null : direction,
    conditions,
    blockedBy,
    phase,
    ready,
    regime: regime.kind,
    indicators: indicatorsAt(prepared, index),
    triggerTime: ready ? current.time : null,
  }
}

function clampExpiry(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(3, Math.max(1, Math.round(value)))
}

function noteFor(evaluation: SetupEvaluation | null, pausedUntil: number | null, nowClose: number): string {
  if (pausedUntil !== null && pausedUntil > nowClose) {
    const minutes = Math.max(1, Math.ceil((pausedUntil - nowClose) / 60))
    return `Pausa após perdas consecutivas ativa por mais ${minutes} min. Nenhum novo gatilho será registrado.`
  }
  if (evaluation === null) return 'Histórico insuficiente para avaliar o setup.'
  if (evaluation.blockedBy.length > 0) {
    return 'Filtro de risco ativo. Aguarde o mercado normalizar.'
  }
  if (evaluation.playbook === null) {
    return 'Aguardando regime definido (tendência ou lateral) para habilitar um playbook.'
  }
  if (evaluation.phase === 'ATENCAO') {
    return 'Prepare-se, NÃO entre ainda: falta 1 condição para o gatilho fechado.'
  }
  const missing = evaluation.conditions.slice(0, -1).filter((condition) => !condition.met).length
  return `${missing} condições pendentes. O motor só age com candle fechado.`
}

function emptyView(): SignalView {
  return {
    phase: 'OBSERVANDO',
    direction: null,
    playbook: null,
    conditions: [
      { label: 'Histórico de candles', met: false },
      { label: 'Indicadores aquecidos', met: false },
    ],
    blockedBy: [],
    note: 'Histórico insuficiente para avaliar o setup.',
    triggerTime: null,
    active: null,
    lastResult: null,
    pausedUntil: null,
  }
}

export function buildSignalAnalysis(
  symbol: string,
  closed: readonly Candle[],
  confirmation: readonly Candle[],
  forming: Candle | null,
  config: StrategyConfig,
  timing: SetupTiming = DEFAULT_SETUP_TIMING,
): SignalAnalysis {
  const prepared = prepareMarket(closed)
  const confirmationPrepared = prepareConfirmation(confirmation)
  const lastIndex = closed.length - 1
  if (lastIndex < WARMUP_INDEX) {
    return {
      view: emptyView(),
      records: [],
      prepared,
      lastEvaluation: null,
    }
  }

  const expiry = clampExpiry(config.expiryCandles)
  const spacing = Math.max(1, Math.round(config.spacingCandles))
  const records: SignalRecord[] = []
  let lastTriggerIndex: number | null = null
  let pausedUntil: number | null = null
  let lossStreak = 0
  let lastEvaluation: SetupEvaluation | null = null
  let pending: SetupEvaluation | null = null
  let pendingBlock: string | null = null

  for (let index = WARMUP_INDEX; index <= lastIndex; index += 1) {
    const evaluation = evaluateSetup(prepared, confirmationPrepared, index, timing)
    if (index === lastIndex) lastEvaluation = evaluation
    if (!evaluation.ready || evaluation.playbook === null || evaluation.direction === null) continue

    const candle = closed[index]
    const triggerClose = candle.time + timing.candleSeconds

    if (pausedUntil !== null && triggerClose <= pausedUntil) {
      if (index === lastIndex) {
        const minutes = Math.max(1, Math.ceil((pausedUntil - triggerClose) / 60))
        pendingBlock = `Pausa pós-perdas ativa: retome em ${minutes} min.`
      }
      continue
    }
    if (lastTriggerIndex !== null && index - lastTriggerIndex < spacing) {
      if (index === lastIndex) {
        pendingBlock =
          `Sinal recente neste ativo: aguarde ${spacing - (index - lastTriggerIndex)} ` +
          `vela(s) de ${timing.candleSeconds / 60} min.`
      }
      continue
    }
    if (index === lastIndex) {
      pending = evaluation
      continue
    }

    const entryCandle = closed[index + 1]
    const lastOperationIndex = index + expiry
    const record: SignalRecord = {
      id: `${symbol}-${candle.time}`,
      symbol,
      playbook: evaluation.playbook,
      direction: evaluation.direction,
      triggerTime: candle.time,
      triggerIndex: index,
      entryTime: entryCandle.time,
      entryPrice: entryCandle.open,
      expiresAt: entryCandle.time + expiry * timing.candleSeconds,
      outcome: null,
      exitPrice: null,
      conditions: evaluation.conditions,
      regime: evaluation.regime,
      indicators: evaluation.indicators,
    }

    if (lastOperationIndex <= lastIndex) {
      const exitCandle = closed[lastOperationIndex]
      record.exitPrice = exitCandle.close
      record.outcome = resolveOutcome(
        entryCandle.open,
        exitCandle.close,
        evaluation.direction,
        0,
        { tickSize: findAsset(symbol).tickSize },
      ).result
      if (record.outcome === 'LOSS') {
        lossStreak += 1
        if (lossStreak >= Math.max(1, config.pauseAfterLosses)) {
          pausedUntil = record.expiresAt + Math.max(0, config.pauseMinutes) * 60
          lossStreak = 0
        }
      } else {
        lossStreak = 0
      }
    }

    records.push(record)
    lastTriggerIndex = index
  }

  let active: SignalRecord | null = null
  let lastResult: SignalRecord | null = null
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    if (active === null && record.outcome === null) active = record
    if (record.outcome !== null) {
      lastResult = record
      break
    }
  }

  const nowClose = closed[lastIndex].time + timing.candleSeconds
  const livePause = pausedUntil !== null && pausedUntil > nowClose ? pausedUntil : null

  let pendingRecord: SignalRecord | null = null
  if (pending !== null && pending.playbook !== null && pending.direction !== null) {
    const trigger = closed[lastIndex]
    const entryTime = forming?.time ?? trigger.time + timing.candleSeconds
    const entryPrice = forming?.open ?? trigger.close
    pendingRecord = {
      id: `${symbol}-${trigger.time}`,
      symbol,
      playbook: pending.playbook,
      direction: pending.direction,
      triggerTime: trigger.time,
      triggerIndex: lastIndex,
      entryTime,
      entryPrice,
      expiresAt: entryTime + expiry * timing.candleSeconds,
      outcome: null,
      exitPrice: null,
      conditions: pending.conditions,
      regime: pending.regime,
      indicators: pending.indicators,
    }
  }

  let phase: SignalView['phase']
  if (pendingRecord !== null) phase = 'ENTRAR'
  else if (active !== null) phase = 'EM_ANDAMENTO'
  else if (lastResult !== null && lastResult.expiresAt === nowClose) phase = 'RESULTADO'
  else phase = pendingBlock !== null ? 'OBSERVANDO' : (lastEvaluation?.phase ?? 'OBSERVANDO')

  let conditions = lastEvaluation?.conditions ?? emptyView().conditions
  let playbook = lastEvaluation?.playbook ?? null
  let direction: CandleDirection | null = null
  let triggerTime: number | null = null
  let note = noteFor(lastEvaluation, livePause, nowClose)
  const blockedBy = pendingBlock !== null ? [pendingBlock] : [...(lastEvaluation?.blockedBy ?? [])]

  if (livePause !== null) {
    blockedBy.unshift(noteFor(lastEvaluation, livePause, nowClose))
  }

  if (pendingRecord !== null) {
    conditions = pendingRecord.conditions
    playbook = pendingRecord.playbook
    direction = pendingRecord.direction
    triggerTime = pendingRecord.triggerTime
    note = 'Gatilho fechado confirmado. Entrada simulada na abertura da próxima vela M5; a expiração começa a contar dessa entrada.'
  } else if (active !== null) {
    conditions = active.conditions
    playbook = active.playbook
    direction = active.direction
    triggerTime = active.triggerTime
    note = 'Operação em andamento. O resultado é apurado no fechamento da última vela da expiração.'
  } else if (phase === 'RESULTADO' && lastResult !== null) {
    conditions = lastResult.conditions
    playbook = lastResult.playbook
    direction = lastResult.direction
    triggerTime = lastResult.triggerTime
    note =
      lastResult.outcome === 'WIN'
        ? 'Acerto: o fechamento da última vela da expiração confirmou a direção.'
        : lastResult.outcome === 'LOSS'
          ? 'Erro: o fechamento da última vela da expiração foi contra a direção.'
          : 'Empate: o fechamento igualou a abertura de entrada. Vale a regra de reembolso das configurações.'
  } else if (phase === 'ATENCAO') {
    direction = lastEvaluation?.direction ?? null
  }

  return {
    view: {
      phase,
      direction,
      playbook,
      conditions,
      blockedBy,
      note,
      triggerTime,
      active: pendingRecord ?? active,
      lastResult,
      pausedUntil: livePause,
    },
    records,
    prepared,
    lastEvaluation,
  }
}
