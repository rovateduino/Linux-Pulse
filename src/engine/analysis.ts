import type {
  AssetAnalysis,
  Candle,
  IndicatorSnapshot,
  MarketSessionStats,
  RegimeInfo,
  ShadowEvaluation,
  SignalRecord,
  SignalView,
} from '../types/market'
import {
  regimeAt,
  buildSignalAnalysis,
  indicatorsAt,
  DEFAULT_SETUP_TIMING,
  type PreparedMarket,
  type StrategyConfig,
  type SetupTiming,
} from './strategy'
import { evaluateLatest, freshState } from './next'
import type { EdgeBook, EngineConfig } from './next'
import type { ModuleEvaluation } from './next'
import { localDayId } from './next/context'
import { toEngineCandles } from './nextAdapter'

export const CHANGE_WINDOW = 12

export function shadowSignalView(note: string): SignalView {
  return {
    phase: 'OBSERVANDO',
    direction: null,
    playbook: null,
    conditions: [],
    blockedBy: [],
    note,
    triggerTime: null,
    active: null,
    lastResult: null,
    pausedUntil: null,
  }
}

export function evaluateNextLatest(
  closed: readonly Candle[],
  config: EngineConfig,
  book: EdgeBook,
  costCalibrated: boolean,
  onModuleEvaluation?: (evaluation: ModuleEvaluation) => void,
): ShadowEvaluation {
  const candles = toEngineCandles(
    closed,
    config.timeframeMinutes,
    config.session.utcOffsetMinutes,
  )
  const last = candles[candles.length - 1]
  const evaluation = evaluateLatest(
    candles,
    config,
    book,
    freshState(
      localDayId(
        last?.time ?? 0,
        config.session.utcOffsetMinutes,
      ),
    ),
    undefined,
    onModuleEvaluation,
  )
  return {
    context: evaluation.context,
    candidates: evaluation.candidates.map(({ candidate, decision }) => ({
      candidate,
      statisticalAllowed: decision.allowed,
      decision: {
        ...decision,
        allowed: false,
        reasons: [
          ...decision.reasons,
          costCalibrated
            ? 'Custo da expiração ainda não foi incorporado ao EV; execução permanece bloqueada.'
            : 'Custo por operação não calibrado; gate permanece bloqueado.',
          'Modo shadow: nenhum sinal é encaminhado ao Auto-Trade.',
        ],
      },
    })),
    signals: [],
  }
}

export function forcedSignalView(candles: readonly Candle[]): SignalView {
  const last = candles[candles.length - 1]
  const direction =
    last === undefined
      ? null
      : last.close > last.open
        ? 'UP'
        : last.close < last.open
          ? 'DOWN'
          : null

  return {
    phase: direction === null ? 'OBSERVANDO' : 'ENTRAR',
    direction,
    playbook: null,
    conditions: [{ label: 'Bypass de filtros da estratégia (teste)', met: direction !== null }],
    blockedBy: [],
    note:
      direction === null
        ? last === undefined
          ? 'Modo de teste ativo; aguardando uma vela fechada.'
          : 'Modo de teste ativo; vela neutra sem direção, ordem não enviada.'
        : 'Sinal forçado no fechamento da vela para teste do Auto-Trade.',
    triggerTime: direction === null ? null : last.time,
    active: null,
    lastResult: null,
    pausedUntil: null,
  }
}

function emptyIndicators(): IndicatorSnapshot {
  return {
    ema20: null,
    ema50: null,
    ema200: null,
    atr: null,
    adx: null,
    rsi: null,
    bandwidthPct: null,
    slope: null,
  }
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

export function analyzeAsset(
  symbol: string,
  closed: readonly Candle[],
  confirmation: readonly Candle[],
  forming: Candle | null,
  config: StrategyConfig,
  changeWindow = CHANGE_WINDOW,
  timing: SetupTiming = DEFAULT_SETUP_TIMING,
): AssetAnalysis {
  const last = closed.length - 1

  const signalAnalysis = buildSignalAnalysis(
    symbol,
    closed,
    confirmation,
    forming,
    config,
    timing,
  )
  const prepared: PreparedMarket = signalAnalysis.prepared
  const signalView: SignalView = signalAnalysis.view
  const records: SignalRecord[] = signalAnalysis.records

  if (last < 0) {
    return {
      symbol,
      closed: [],
      regime: emptyRegime(),
      signal: signalView,
      indicators: emptyIndicators(),
      records,
      changePct: 0,
      changeWindow: 0,
      lastClosedTime: null,
    }
  }

  const regime = regimeAt(prepared, last)
  const window = Math.min(changeWindow, last)
  const reference = closed[last - window]
  const changePct =
    reference.close === 0 ? 0 : ((closed[last].close - reference.close) / reference.close) * 100

  return {
    symbol,
    closed: closed.slice(),
    regime,
    signal: signalView,
    indicators: indicatorsAt(prepared, last),
    records,
    changePct,
    changeWindow: window,
    lastClosedTime: closed[last].time,
  }
}

export function computeSessionStats(
  analyses: Record<string, AssetAnalysis>,
  elapsedSeconds: number,
): MarketSessionStats {
  const list = Object.values(analyses)
  const attention = list.filter((analysis) => analysis.signal.phase === 'ATENCAO').length
  const entries = list.filter(
    (analysis) =>
      analysis.signal.phase === 'ENTRAR' || analysis.signal.phase === 'EM_ANDAMENTO',
  ).length
  const totals: Record<string, number> = {}
  for (const analysis of list) {
    totals[analysis.regime.kind] = (totals[analysis.regime.kind] ?? 0) + 1
  }
  let dominant: MarketSessionStats['regimeLabel'] = 'SEM_REGIME'
  let dominantCount = 0
  for (const [kind, count] of Object.entries(totals)) {
    if (count > dominantCount) {
      dominant = kind as MarketSessionStats['regimeLabel']
      dominantCount = count
    }
  }

  return {
    elapsedMs: Math.max(0, elapsedSeconds) * 1000,
    closedM5: list[0]?.closed.length ?? 0,
    attention,
    entries,
    regimeLabel: dominant,
    regimeCount: dominantCount,
  }
}
