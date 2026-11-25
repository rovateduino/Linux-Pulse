import type {
  Candle,
  CandleDirection,
  SignalPlaybook,
  TradeOutcome,
} from './market'
import type { StrategyConfig } from '../engine/strategy'
import type { BacktestReport, EngineConfig } from '../engine/next'

export type LabTimeframe = '1m' | '5m' | '15m'
export type LabConfirmation = '15m' | '30m'
export type LabSource = 'binance' | 'simulado' | 'bot'

/** Playbooks selecionáveis no laboratório. C/D são o registry principal; A/B são legado. */
export type PlaybookId = 'C' | 'D' | 'A' | 'B'

export type SessionName = 'london' | 'ny' | 'tokyo' | 'sydney'

/** Janela de sessão de mercado em UTC. `startUtc` é inclusivo, `endUtc` exclusivo. */
export interface SessionWindow {
  name: SessionName
  startUtc: string
  endUtc: string
}

export type LabRunPhase =
  | 'idle'
  | 'carregando'
  | 'treinando'
  | 'validando'
  | 'testando'
  | 'baselines'
  | 'done'
  | 'error'
  | 'cancelled'

export type SplitName = 'treino' | 'validacao' | 'teste'
export type EdgeStatus = 'VALIDADO' | 'INCONCLUSIVO' | 'SEM_VANTAGEM'
export type BaselineKind = 'aleatoria' | 'sempre_call' | 'ultima_vela'

export interface LabDataset {
  symbol: string
  source: LabSource
  candles: Candle[]
  timeframe?: LabTimeframe | null
  fetchedAt: number
  gaps: number
  expected: number
}

export type DatasetState =
  | { status: 'idle' }
  | { status: 'fetching'; progress: number }
  | { status: 'parsing' }
  | { status: 'ready'; dataset: LabDataset; cached: boolean }
  | { status: 'error'; message: string }

/** Metadados de um CSV do bot salvo no IndexedDB, para o painel de importação. */
export interface BotDatasetSummary {
  symbol: string
  timeframe: LabTimeframe | null
  candleCount: number
  fetchedAt: number
  gaps: number
  expected: number
  fileName: string | null
}

export interface LabConfig {
  symbol: string
  baseTimeframe: LabTimeframe
  confirmation: LabConfirmation
  payout: number
  expiryCandles: number
  /** Playbook selecionado para a grade. Padrão 'C'; A/B exigem modo legado. */
  playbook: PlaybookId
  /** Quando true, os playbooks legados A/B ficam selecionáveis. */
  legacyPlaybooks: boolean
  /** Janelas de sessão do funil de entrada. Ausente = DEFAULT_SESSIONS. */
  sessions?: SessionWindow[]
}

export interface GridCombo {
  id: string
  symbol: string
  timeframe: LabTimeframe
  playbook: SignalPlaybook
  label: string
}

export interface SplitRange {
  name: SplitName
  startIndex: number
  endIndex: number
  startTime: number
  endTime: number
}

export interface EquityPoint {
  index: number
  time: number
  value: number
}

export interface BacktestMetrics {
  n: number
  wins: number
  losses: number
  ties: number
  winRate: number
  low: number
  high: number
  breakeven: number
  expectancy: number
  pnlUsd: number
  maxDrawdown: number
  equity: EquityPoint[]
}

export interface GateResult {
  status: EdgeStatus
  reason: string
  n: number
  wins: number
  winRate: number
  low: number
  high: number
  breakeven: number
}

export interface BacktestTrade {
  id: string
  symbol: string
  timeframe: LabTimeframe
  playbook: SignalPlaybook
  direction: CandleDirection
  lastCandleDirection: CandleDirection
  triggerIndex: number
  triggerTime: number
  entryIndex: number
  entryTime: number
  entryPrice: number
  exitIndex: number
  exitTime: number
  exitPrice: number
  outcome: TradeOutcome
  payout: number
  pnlUsd: number
  split: SplitName
}

export interface BacktestResult {
  comboId: string
  symbol: string
  timeframe: LabTimeframe
  playbook: SignalPlaybook
  splits: SplitRange[]
  train: BacktestMetrics
  validation: BacktestMetrics
  test: BacktestMetrics
  overall: BacktestMetrics
  gate: GateResult
  trades: BacktestTrade[]
}

export interface BaselineOpportunity {
  symbol: string
  timeframe: LabTimeframe
  triggerIndex: number
  triggerTime: number
  entryIndex: number
  exitIndex: number
  entryTime: number
  entryPrice: number
  exitTime: number
  exitPrice: number
  lastDirection: CandleDirection
  split: SplitName
}

export interface BaselineResult {
  kind: BaselineKind
  label: string
  timeframe: LabTimeframe
  trials: number
  seed: number | null
  metrics: BacktestMetrics
  gate: GateResult
}

export interface RunBacktestInput {
  symbol: string
  timeframe: LabTimeframe
  confirmation: LabConfirmation
  payout: number
  expiryCandles: number
  m5Candles: readonly Candle[]
  playbooks?: readonly SignalPlaybook[]
  strategy?: StrategyConfig
  stake?: number
  /** Filtro de sessão do funil de entrada. Ausente = DEFAULT_SESSIONS. */
  sessions?: SessionWindow[]
}

export interface RunBacktestOutput {
  results: BacktestResult[]
  split: SplitRange[]
  opportunities: BaselineOpportunity[]
  sessionsUsed: SessionWindow[]
  /** Percentual (0-100) de velas do timeframe base fora das janelas usadas. */
  pctCandlesFiltrados: number
}

export interface RunBaselinesInput {
  symbol: string
  timeframe: LabTimeframe
  payout: number
  stake: number
  opportunities: readonly BaselineOpportunity[]
  trials?: number
  seed?: number
}

export type WorkerRunInput = Omit<RunBacktestInput, 'm5Candles' | 'playbooks'> & {
  candles: Candle[]
  playbooks: SignalPlaybook[]
  nextEngineConfig: EngineConfig
}

export type WorkerProgressPhase = Exclude<LabRunPhase, 'idle' | 'done' | 'error' | 'cancelled'>

export type NextShadowResult =
  | (Pick<BacktestReport, 'summary' | 'stats' | 'shadowTrades'> & {
      status: 'complete'
      timeframeMinutes: number
    })
  | { status: 'skipped'; timeframeMinutes: number; reason: string }

export type WorkerRequest = { type: 'run'; config: WorkerRunInput }

export type WorkerResponse =
  | { type: 'progress'; phase: WorkerProgressPhase; pct: number }
  | {
      type: 'done'
      results: BacktestResult[]
      baselines: BaselineResult[]
      split: SplitRange[]
      generatedAt: number
      nextShadow: NextShadowResult
      sessionsUsed: SessionWindow[]
      pctCandlesFiltrados: number
    }
  | { type: 'error'; message: string }

export interface LabRunInfo {
  symbol: string
  timeframe: LabTimeframe
  source: LabSource
  generatedAt: number
  trades: number
  /** Playbook efetivamente avaliado nesta rodada. */
  playbookId: PlaybookId
  split: SplitRange[]
  /** Janelas de sessão efetivamente usadas no funil de entrada desta rodada. */
  sessionsUsed: SessionWindow[]
  /** Percentual (0-100) de velas do timeframe base descartadas pelo filtro. */
  pctCandlesFiltrados: number
  nextShadow?:
    | {
        status: 'complete'
        timeframeMinutes: number
        persistedTrades: number
        summary: BacktestReport['summary']
        stats: BacktestReport['stats']
      }
    | { status: 'skipped'; timeframeMinutes: number; reason: string }
}
