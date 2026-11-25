import { CircleHelp, ShieldCheck, TrendingDown } from 'lucide-react'
import { VERDICT_BADGE_CLASS, VERDICT_LABEL, verdictTooltip } from '../../lib/edgeVerdict'
import type { GateVerdict, GateVerdictKind } from '../../types/edge'

const ICON: Record<GateVerdictKind, typeof ShieldCheck> = {
  KILL: TrendingDown,
  INCONCLUSIVE: CircleHelp,
  CONFIRM: ShieldCheck,
}

export function GateVerdictBadge({
  verdict,
  payout,
  className = '',
}: {
  verdict: GateVerdict
  payout: number
  className?: string
}) {
  const Icon = ICON[verdict.kind]
  const label = VERDICT_LABEL[verdict.kind]

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${VERDICT_BADGE_CLASS[verdict.kind]} ${className}`}
      title={verdictTooltip(verdict, payout)}
      aria-label={`Edge Gate: ${label}. ${verdict.reason}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  )
}
