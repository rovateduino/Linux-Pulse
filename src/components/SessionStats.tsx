import { Gauge, Layers3, Timer, Zap } from 'lucide-react'
import type { MarketSessionStats } from '../types/market'
import { formatClock } from '../lib/format'
import { regimeLabel } from '../lib/signalMeta'

interface SessionStatsProps {
  stats: MarketSessionStats
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'text-content',
}: {
  icon: typeof Timer
  label: string
  value: string
  hint: string
  tone?: string
}) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5 text-muted">
        <Icon className="h-3 w-3" aria-hidden="true" />
        <p className="text-[8.5px] uppercase tracking-[0.12em]">{label}</p>
      </div>
      <p className={`mt-1.5 font-mono text-lg font-medium leading-none tnum ${tone}`}>{value}</p>
      <p className="mt-1 text-[9px] leading-tight text-muted">{hint}</p>
    </div>
  )
}

export function SessionStats({ stats }: SessionStatsProps) {
  return (
    <section aria-labelledby="session-heading" className="surface p-4 sm:p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Sessão</p>
          <h2 id="session-heading" className="mt-1 font-display text-base font-semibold tracking-tight">
            Pulso do terminal
          </h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-[9px] uppercase tracking-[0.1em] text-muted">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-buy" aria-hidden="true" />
          30×
        </span>
      </header>

      <div className="mt-3.5 grid grid-cols-2 gap-2">
        <Stat
          icon={Timer}
          label="Sessão simulada"
          value={formatClock(stats.elapsedMs)}
          hint="tempo acelerado"
        />
        <Stat
          icon={Layers3}
          label="Histórico M5"
          value={String(stats.closedM5)}
          hint="velas fechadas"
        />
        <Stat
          icon={Gauge}
          label="Em atenção"
          value={`${stats.attention}/5`}
          hint="setup incompleto"
          tone={stats.attention > 0 ? 'text-warn' : 'text-content'}
        />
        <Stat
          icon={Zap}
          label="Gatilhos ativos"
          value={String(stats.entries)}
          hint="entrada simulada"
          tone={stats.entries > 0 ? 'text-buy' : 'text-content'}
        />
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-line pt-3 text-[9.5px] text-muted">
        Regime dominante:
        <span className="font-medium text-content">
          {regimeLabel(stats.regimeLabel)}
        </span>
        <span className="text-muted">({stats.regimeCount}/5 ativos)</span>
      </p>
    </section>
  )
}
