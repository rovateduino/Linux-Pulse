import type { EdgeStatus } from '../types/lab'

export const EDGE_STATUS_LABEL: Record<EdgeStatus, string> = {
  VALIDADO: 'VALIDADO',
  INCONCLUSIVO: 'INCONCLUSIVO',
  SEM_VANTAGEM: 'SEM VANTAGEM',
}

export const EDGE_BADGE_CLASS: Record<EdgeStatus, string> = {
  VALIDADO: 'border-buy/30 bg-buy/[0.08] text-buy',
  INCONCLUSIVO: 'border-warn/30 bg-warn/[0.08] text-warn',
  SEM_VANTAGEM: 'border-sell/30 bg-sell/[0.08] text-sell',
}

export function edgeBadgeClass(status: EdgeStatus): string {
  return EDGE_BADGE_CLASS[status]
}
