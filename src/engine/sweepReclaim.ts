import { atr } from './indicators'
import type {
  AssetAnalysis,
  Candle,
  IndicatorSnapshot,
  RegimeInfo,
  StrategyEvaluationLog,
  SignalView,
} from '../types/market'

export interface SweepReclaimConfig {
  lookback: number
  atrPeriod: number
  minSweepAtr: number
  reclaimBufferAtr: number
  minWickFraction: number
}

export const SWEEP_RECLAIM_CONFIG: Readonly<SweepReclaimConfig> = {
  lookback: 20,
  atrPeriod: 14,
  minSweepAtr: 0.1,
  reclaimBufferAtr: 0.02,
  minWickFraction: 0.3,
}

export interface SweepReclaimCandles {
  closed: readonly Candle[]
  forming: Candle | null
}

function emptyIndicators(atrValue: number | null): IndicatorSnapshot {
  return {
    ema20: null,
    ema50: null,
    ema200: null,
    atr: atrValue,
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

function observing(note: string, blockedBy: string[] = []): SignalView {
  return {
    phase: 'OBSERVANDO',
    direction: null,
    playbook: null,
    conditions: [],
    blockedBy,
    note,
    triggerTime: null,
    active: null,
    lastResult: null,
    pausedUntil: null,
  }
}

function invalidCandle(candle: Candle): boolean {
  return (
    !Number.isFinite(candle.time) ||
    candle.time <= 0 ||
    ![candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) ||
    candle.open <= 0 ||
    candle.high <= 0 ||
    candle.low <= 0 ||
    candle.close <= 0 ||
    candle.volume < 0 ||
    candle.high < Math.max(candle.open, candle.close) ||
    candle.low > Math.min(candle.open, candle.close) ||
    candle.high < candle.low
  )
}

function makeAnalysis(
  symbol: string,
  closed: readonly Candle[],
  signal: SignalView,
  atrValue: number | null,
  referenceWindow: number,
): AssetAnalysis {
  const last = closed[closed.length - 1]
  const reference = closed[Math.max(0, closed.length - 1 - referenceWindow)]
  return {
    symbol,
    closed: closed.slice(),
    regime: emptyRegime(),
    signal,
    indicators: emptyIndicators(atrValue),
    records: [],
    changePct:
      last === undefined || reference === undefined || reference.close === 0
        ? 0
        : ((last.close - reference.close) / reference.close) * 100,
    changeWindow: Math.min(referenceWindow, Math.max(0, closed.length - 1)),
    lastClosedTime: last?.time ?? null,
  }
}

function makeSweepAnalysis(
  symbol: string,
  closed: readonly Candle[],
  signal: SignalView,
  atrValue: number | null,
  referenceWindow: number,
  details: Record<string, unknown> = {
    level_type: null,
    swept_level: null,
    sweep_distance: null,
    wick_fraction: null,
    reclaim_confirmed: false,
  },
): AssetAnalysis {
  const analysis = makeAnalysis(symbol, closed, signal, atrValue, referenceWindow)
  const evaluation: StrategyEvaluationLog = {
    strategy: 'sweep_reclaim',
    asset: symbol,
    timeframe: 'M1',
    mode: 'isolated',
    candleTime: analysis.lastClosedTime,
    result: signal.phase === 'ENTRAR' ? 'signal' : 'no_signal',
    direction: signal.direction,
    reason: signal.note,
    details: { ...details, atr: atrValue },
  }
  return { ...analysis, strategyEvaluations: [evaluation] }
}

export function buildSweepReclaimAnalysis(
  symbol: string,
  candles: SweepReclaimCandles,
  config: Readonly<SweepReclaimConfig> = SWEEP_RECLAIM_CONFIG,
): AssetAnalysis {
  const { closed } = candles
  const lastIndex = closed.length - 1
  const last = closed[lastIndex]

  if (
    !Number.isInteger(config.lookback) ||
    config.lookback < 1 ||
    !Number.isInteger(config.atrPeriod) ||
    config.atrPeriod < 1 ||
    !Number.isFinite(config.minSweepAtr) ||
    config.minSweepAtr < 0 ||
    !Number.isFinite(config.reclaimBufferAtr) ||
    config.reclaimBufferAtr < 0 ||
    !Number.isFinite(config.minWickFraction) ||
    config.minWickFraction < 0 ||
    config.minWickFraction > 1
  ) {
    const note = 'Parâmetros inválidos para Sweep & Reclaim; sinal bloqueado.'
    return makeSweepAnalysis(symbol, closed, observing(note, [note]), null, config.lookback || 1)
  }

  if (closed.some(invalidCandle)) {
    const note = 'Dados OHLCV ausentes ou inválidos; sinal Sweep & Reclaim bloqueado.'
    return makeSweepAnalysis(symbol, closed, observing(note, [note]), null, config.lookback)
  }
  for (let index = 1; index < closed.length; index += 1) {
    if (closed[index].time <= closed[index - 1].time) {
      const note = 'Candles fora de ordem cronológica; sinal Sweep & Reclaim bloqueado.'
      return makeSweepAnalysis(symbol, closed, observing(note, [note]), null, config.lookback)
    }
  }

  if (last === undefined) {
    const note = 'Aguardando candles fechados para Sweep & Reclaim.'
    return makeSweepAnalysis(symbol, closed, observing(note, [note]), null, config.lookback)
  }

  const requiredHistory = Math.max(config.lookback, config.atrPeriod + 1)
  if (lastIndex < requiredHistory) {
    const note = `Histórico insuficiente: necessários ${requiredHistory + 1} candles fechados para Sweep & Reclaim.`
    return makeSweepAnalysis(symbol, closed, observing(note, [note]), null, config.lookback)
  }

  const prior = closed.slice(0, lastIndex)
  const priorForReference = prior.slice(-config.lookback)
  const referenceHigh = Math.max(...priorForReference.map((candle) => candle.high))
  const referenceLow = Math.min(...priorForReference.map((candle) => candle.low))
  const atrValue = atr(prior, config.atrPeriod)[prior.length - 1]

  if (atrValue === null || !Number.isFinite(atrValue) || atrValue <= 0) {
    const note = 'ATR indisponível ou inválido no histórico fechado; sinal Sweep & Reclaim bloqueado.'
    return makeSweepAnalysis(symbol, closed, observing(note, [note]), null, config.lookback)
  }

  const candleRange = last.high - last.low
  if (candleRange <= 0) {
    const note = 'Candle avaliado sem amplitude válida; sinal Sweep & Reclaim bloqueado.'
    return makeSweepAnalysis(symbol, closed, observing(note, [note]), atrValue, config.lookback)
  }

  const lowSweepDistance = referenceLow - last.low
  const highSweepDistance = last.high - referenceHigh
  const sweptLow = lowSweepDistance >= atrValue * config.minSweepAtr
  const sweptHigh = highSweepDistance >= atrValue * config.minSweepAtr
  const buyReclaimed = last.close > referenceLow + atrValue * config.reclaimBufferAtr
  const sellReclaimed = last.close < referenceHigh - atrValue * config.reclaimBufferAtr
  const lowerWickFraction = (Math.min(last.open, last.close) - last.low) / candleRange
  const upperWickFraction = (last.high - Math.max(last.open, last.close)) / candleRange
  const buyReady =
    sweptLow && buyReclaimed && lowerWickFraction >= config.minWickFraction
  const sellReady =
    sweptHigh && sellReclaimed && upperWickFraction >= config.minWickFraction

  if (buyReady && sellReady) {
    const note = 'Sweep simultâneo de máxima e mínima; direção ambígua, sinal bloqueado.'
    return makeSweepAnalysis(
      symbol,
      closed,
      observing(note, [note]),
      atrValue,
      config.lookback,
      {
        level_type: null,
        swept_level: null,
        sweep_distance: Math.max(lowSweepDistance, highSweepDistance),
        wick_fraction: Math.max(lowerWickFraction, upperWickFraction),
        reclaim_confirmed: false,
      },
    )
  }

  if (buyReady || sellReady) {
    const direction = buyReady ? 'UP' : 'DOWN'
    const conditions = [
      { label: 'Sweep excede a distância mínima baseada em ATR', met: true },
      { label: 'Fechamento recupera o nível com buffer mínimo', met: true },
      { label: 'Pavio do sweep atinge a fração mínima', met: true },
      { label: 'Referência usa somente candles anteriores', met: true },
    ]
    const levelType = buyReady ? 'low' : 'high'
    return makeSweepAnalysis(
      symbol,
      closed,
      {
        ...observing(
          `Candidato Sweep & Reclaim de ${direction === 'UP' ? 'compra' : 'venda'} no fechamento do candle.`,
        ),
        phase: 'ENTRAR',
        direction,
        conditions,
        triggerTime: last.time,
      },
      atrValue,
      config.lookback,
      {
        level_type: levelType,
        swept_level: buyReady ? referenceLow : referenceHigh,
        sweep_distance: buyReady ? lowSweepDistance : highSweepDistance,
        wick_fraction: buyReady ? lowerWickFraction : upperWickFraction,
        reclaim_confirmed: true,
      },
    )
  }

  const conditions = [
    { label: 'Sweep de mínima detectado', met: sweptLow },
    { label: 'Reclaim de compra confirmado', met: sweptLow && buyReclaimed },
    { label: 'Sweep de máxima detectado', met: sweptHigh },
    { label: 'Reclaim de venda confirmado', met: sweptHigh && sellReclaimed },
    {
      label: 'Fração mínima do pavio atingida',
      met:
        (sweptLow && lowerWickFraction >= config.minWickFraction) ||
        (sweptHigh && upperWickFraction >= config.minWickFraction),
    },
  ]
  const note = 'Nenhum Sweep & Reclaim confirmado neste candle fechado.'
  const inspectedLow = sweptLow || (!sweptHigh && lowSweepDistance >= highSweepDistance)
  return makeSweepAnalysis(
    symbol,
    closed,
    { ...observing(note, [note]), conditions },
    atrValue,
    config.lookback,
    {
      level_type: sweptLow === sweptHigh ? null : sweptLow ? 'low' : 'high',
      swept_level: sweptLow ? referenceLow : sweptHigh ? referenceHigh : null,
      sweep_distance: sweptLow
        ? lowSweepDistance
        : sweptHigh
          ? highSweepDistance
          : Math.max(lowSweepDistance, highSweepDistance),
      wick_fraction:
        sweptLow && sweptHigh
          ? Math.max(lowerWickFraction, upperWickFraction)
          : inspectedLow
            ? lowerWickFraction
            : upperWickFraction,
      reclaim_confirmed: (sweptLow && buyReclaimed) || (sweptHigh && sellReclaimed),
    },
  )
}
