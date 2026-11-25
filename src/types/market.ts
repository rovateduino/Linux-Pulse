import type { LiveEvaluation } from '../engine/next/engine'

export type Timeframe = '1m' | '5m' | '15m'

export type RealCandleTimeframe = 'M1' | 'M5' | 'M15'

export type CandleDirection = 'UP' | 'DOWN'

export type RegimeKind = 'TENDENCIA' | 'LATERAL' | 'SEM_REGIME'

export type SignalPhase = 'OBSERVANDO' | 'ATENCAO' | 'ENTRAR' | 'EM_ANDAMENTO' | 'RESULTADO'

export type SignalPlaybook = 'A' | 'B' | 'C' | 'D'

export type TradeOutcome = 'WIN' | 'LOSS' | 'TIE'

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface AssetDef {
  symbol: string
  name: string
  basePrice: number
  decimals: number
  /** Tamanho de 1 pip do ativo (ex.: EURUSD 0.0001, USDJPY/GBPJPY 0.01). */
  pipSize: number
  /** Tamanho de 1 tick (pipette), 1/10 do pip — usado na tolerância de EMPATE. */
  tickSize: number
  seed: number
  volatility: number
  trendPeriod: number
  phase: number
  volumeBase: number
}

export interface RegimeInfo {
  kind: RegimeKind
  direction: CandleDirection | null
  adx: number | null
  slope: number | null
  bandwidthPct: number | null
  emaAligned: boolean
  ema20: number | null
  ema50: number | null
  ema200: number | null
}

export interface SetupCondition {
  label: string
  met: boolean
}

export interface SignalRecord {
  id: string
  symbol: string
  playbook: SignalPlaybook
  direction: CandleDirection
  triggerTime: number
  triggerIndex: number
  entryTime: number
  entryPrice: number
  expiresAt: number
  outcome: TradeOutcome | null
  exitPrice: number | null
  conditions: SetupCondition[]
  regime: RegimeKind
  indicators: IndicatorSnapshot
}

export interface SignalView {
  phase: SignalPhase
  direction: CandleDirection | null
  playbook: SignalPlaybook | null
  conditions: SetupCondition[]
  blockedBy: string[]
  note: string
  triggerTime: number | null
  active: SignalRecord | null
  lastResult: SignalRecord | null
  pausedUntil: number | null
}

export interface StrategyEvaluationLog {
  strategy: string
  asset: string
  timeframe: 'M1' | 'M5' | 'M15'
  mode: 'standard' | 'isolated'
  candleTime: number | null
  result: 'signal' | 'no_signal'
  direction: CandleDirection | 'long' | 'short' | null
  reason: string
  details: Record<string, unknown>
}

export type ShadowEvaluation = Omit<LiveEvaluation, 'candidates'> & {
  candidates: Array<LiveEvaluation['candidates'][number] & { statisticalAllowed: boolean }>
}

export interface IndicatorSnapshot {
  ema20: number | null
  ema50: number | null
  ema200: number | null
  atr: number | null
  adx: number | null
  rsi: number | null
  bandwidthPct: number | null
  slope: number | null
}

export interface AssetAnalysis {
  symbol: string
  closed: Candle[]
  regime: RegimeInfo
  signal: SignalView
  indicators: IndicatorSnapshot
  records: SignalRecord[]
  changePct: number
  changeWindow: number
  lastClosedTime: number | null
  strategyEvaluations?: StrategyEvaluationLog[]
  nextEvaluation?: ShadowEvaluation | null
  engineError?: string | null
}

export interface MarketSessionStats {
  elapsedMs: number
  closedM5: number
  attention: number
  entries: number
  regimeLabel: RegimeKind
  regimeCount: number
}
