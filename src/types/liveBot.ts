import type { Candle, RealCandleTimeframe } from './market'

export type LiveBotStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type LiveTradeDirection = 'CALL' | 'PUT'
export type LiveTradeResult = 'WIN' | 'LOSS' | 'DRAW' | 'SKIPPED'
export type AccountType = 'PRACTICE' | 'REAL'

export interface AvailableAsset {
  symbol: string
  available: boolean
  payout: number
}

export interface LiveTradeOpenMessage {
  type: 'trade_open'
  trade_id?: string
  asset: string
  direction: LiveTradeDirection
  amount: number
  entry_price: number
  expiration: number
  timestamp: string
}

export interface LiveTradeResultMessage {
  type: 'trade_result'
  trade_id?: string
  asset: string
  direction: LiveTradeDirection
  result: LiveTradeResult
  pnl: number
  timestamp: string
  reason?: string
}

export interface BotStoppedMessage {
  type: 'bot_stopped'
  reason: string
}

export interface LiveTradeErrorMessage {
  type: 'trade_error'
  reason: string
}

export interface ExecutionModeChangedMessage {
  type: 'mode_changed'
  live: boolean
}

export interface ExecutionModeErrorMessage {
  type: 'mode_error'
  reason: string
}

export interface SessionAuthResultMessage {
  type: 'auth_result'
  authenticated: boolean
  reason?: string
}

export interface AccountBalanceMessage {
  type: 'account_balance'
  balance: number
  currency: string
  account_type: AccountType
}

export interface AssetsStatusMessage {
  type: 'assets_status'
  assets: AvailableAsset[]
}

export interface RealCandlesMessage {
  type: 'real_candles'
  asset: string
  timeframe: RealCandleTimeframe
  candles: Candle[]
  /** Timestamp da corretora em segundos Unix. */
  timestamp: number
}

export interface StrategyLogResultMessage {
  type: 'strategy_log_result'
  key: string
  written: boolean
  duplicate: boolean
  reason?: string
}

export type LiveBotMessage =
  | LiveTradeOpenMessage
  | LiveTradeResultMessage
  | BotStoppedMessage
  | LiveTradeErrorMessage
  | ExecutionModeChangedMessage
  | ExecutionModeErrorMessage
  | SessionAuthResultMessage
  | AccountBalanceMessage
  | AssetsStatusMessage
  | RealCandlesMessage
  | StrategyLogResultMessage

export interface LiveBotState {
  status: LiveBotStatus
  lastMessage: LiveBotMessage | null
  accountBalance: number | null
  accountCurrency: string
  accountType: AccountType | null
  liveModeEnabled: boolean
  modeNotice: string | null
  isLive: boolean
}

export interface LiveAutoOrder {
  signalId: string
  asset: string
  direction: LiveTradeDirection
  stage: 'sent' | 'open' | 'result' | 'error'
  sentAtSec: number
  tradeId?: string
  result?: LiveTradeResult
  pnl?: number
  errorReason?: string
}

export interface LiveBotSession extends LiveBotState {
  lastAutoOrder: LiveAutoOrder | null
  sessionToken: string
  authStatus: 'unauthenticated' | 'pending' | 'authenticated' | 'rejected'
  authNotice: string | null
  autoTrade: boolean
  stake: number
  tradeNotice: string | null
  /** Aviso de negócio (amarelo): ex. ativo não aceita ordens no momento. */
  assetWarning: string | null
  setAutoTrade: (enabled: boolean) => void
  setStake: (amount: number) => void
  setTradeNotice: (notice: string | null) => void
  setAssetWarning: (warning: string | null) => void
  setLastAutoOrder: (order: LiveAutoOrder | null) => void
  setLiveMode: (live: boolean) => void
  authenticateSessionToken: (token: string) => void
}

export interface LiveTrade {
  id: string
  asset: string
  direction: LiveTradeDirection
  amount: number | null
  entryPrice: number | null
  expiration: number | null
  result: LiveTradeResult | null
  pnl: number | null
  openedAt: string | null
  closedAt: string | null
}
