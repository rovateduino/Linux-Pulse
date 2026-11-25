import type {
  AssetDef,
  Candle,
  CandleDirection,
  SetupCondition,
  SignalPlaybook,
} from '../../types/market'
import type { SessionWindow } from '../../types/lab'

/** Playbooks ativos do registry principal. A/B ficam em `legacy/`. */
export type RegistryPlaybookId = 'C' | 'D'

/** Metadados de saída em múltiplos de ATR. A liquidação segue por expiração. */
export interface PlaybookExits {
  takeProfitAtr: number
  stopLossAtr: number
}

export interface PlaybookSignal {
  playbook: SignalPlaybook
  direction: CandleDirection
  conditions: SetupCondition[]
  exits: PlaybookExits
}

export type PlaybookEvaluator = (
  candles: readonly Candle[],
  index: number,
  cfg: AssetDef,
  sessions?: readonly SessionWindow[],
) => PlaybookSignal | null
