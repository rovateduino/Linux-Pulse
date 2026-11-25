import { CircleHelp, ShieldCheck, TrendingDown } from 'lucide-react'
import { EDGE_BADGE_CLASS, EDGE_STATUS_LABEL } from '../../lib/edgeBadge'
import type { GateResult } from '../../types/lab'

export function EdgeBadge({
  gate,
  className = '',
}: {
  gate: GateResult
  className?: string
}) {
  const Icon =
    gate.status === 'VALIDADO'
      ? ShieldCheck
      : gate.status === 'SEM_VANTAGEM'
        ? TrendingDown
        : CircleHelp

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${EDGE_BADGE_CLASS[gate.status]} ${className}`}
      title={gate.reason}
      aria-label={`Edge Gate: ${EDGE_STATUS_LABEL[gate.status]}. ${gate.reason}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {EDGE_STATUS_LABEL[gate.status]}
    </span>
  )
}
