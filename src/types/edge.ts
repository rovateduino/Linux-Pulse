import type { LabTimeframe } from './lab'
import type { SignalPlaybook } from './market'

/**
 * Veredito do Edge Gate rápido: fail-fast (KILL) + confirmação (CONFIRM).
 * Distinto de `GateResult` (IC95% de Wilson) em `types/lab`, que segue
 * alimentando as tabelas do Laboratório.
 */
export type GateVerdict =
  | { kind: 'KILL'; reason: string; n: number; winRate: number }
  | { kind: 'INCONCLUSIVE'; reason: string; n: number; winRate: number }
  | { kind: 'CONFIRM'; reason: string; n: number; winRate: number }

export type GateVerdictKind = GateVerdict['kind']

/**
 * Registro de auditoria de um veredito do Edge Gate, persistido no IndexedDB
 * (store `edgeHistory`).
 */
export interface EdgeVerdictRecord {
  id: string
  symbol: string
  timeframe: LabTimeframe
  playbook: SignalPlaybook
  computedAt: number
  payout: number
  n: number
  wins: number
  winRate: number
  /** Erro-padrão SE(n) usado no veredito. */
  se: number
  breakeven: number
  killBound: number
  confirmBound: number
  kind: GateVerdictKind
  reason: string
}
