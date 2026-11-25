import type {
  CandleDirection,
  IndicatorSnapshot,
  RegimeKind,
  SetupCondition,
  SignalPlaybook,
  TradeOutcome,
} from './market'

export interface AppSettings {
  initialBalance: number
  stake: number
  payout: number
  strategyEngine: 'legacy' | 'next'
  sweepReclaimOnly: boolean
  costPerTrade: number
  costCalibrated: boolean
  minTradesPerBucket: number
  edgeMargin: number
  maxSignalsPerDay: number
  utcOffsetMinutes: number
  sessionOpenMinute: number
  sessionCloseMinute: number
  openingRangeMinutes: number
  noEntryAfterOpenMinutes: number
  noEntryBeforeCloseMinutes: number
  lookbackSessions: number
  expiryCandles: number
  tieRefund: boolean
  pauseAfterLosses: number
  pauseMinutes: number
  spacingCandles: number
  dailyStop: number
  dailyCap: number
  autoPaper: boolean
  soundEnabled: boolean
  notificationsEnabled: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  initialBalance: 1000,
  stake: 10,
  payout: 0.85,
  strategyEngine: 'next',
  sweepReclaimOnly: false,
  costPerTrade: 0,
  costCalibrated: false,
  minTradesPerBucket: 10,
  edgeMargin: 0.03,
  maxSignalsPerDay: 10,
  utcOffsetMinutes: 0,
  sessionOpenMinute: 420,
  sessionCloseMinute: 960,
  openingRangeMinutes: 30,
  noEntryAfterOpenMinutes: 5,
  noEntryBeforeCloseMinutes: 15,
  lookbackSessions: 8,
  expiryCandles: 1,
  tieRefund: true,
  pauseAfterLosses: 2,
  pauseMinutes: 30,
  spacingCandles: 5,
  dailyStop: 50,
  dailyCap: 100,
  autoPaper: false,
  soundEnabled: false,
  notificationsEnabled: false,
}

export interface PaperTrade {
  id: string
  symbol: string
  playbook: SignalPlaybook
  direction: CandleDirection
  openedAt: number
  entryPrice: number
  stake: number
  payout: number
  tieRefund: boolean
  expiryCandles: number
  expiresAt: number
  closedAt: number | null
  exitPrice: number | null
  outcome: TradeOutcome | null
  pnl: number | null
  dayKey: string
  conditions: SetupCondition[]
  regime: RegimeKind
  indicators: IndicatorSnapshot
}

export interface DailyStatus {
  dayKey: string
  realized: number
  closed: number
  open: number
  stopped: boolean
  capped: boolean
  allowed: boolean
}
