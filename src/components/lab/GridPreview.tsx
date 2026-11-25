import { CalendarRange, Check, Eye, Layers } from 'lucide-react'
import { formatUnixDateTime } from '../../lib/format'
import { isLabRunActive, useLabStore } from '../../stores/labStore'

const SPLIT_SEGMENTS = [
  { label: 'Treino', share: 60, className: 'bg-accent/45' },
  { label: 'Validação', share: 20, className: 'bg-info/45' },
  { label: 'Teste', share: 20, className: 'bg-warn/45' },
] as const

export function GridPreview() {
  const grid = useLabStore((state) => state.grid)
  const accepted = useLabStore((state) => state.gridAccepted)
  const phase = useLabStore((state) => state.phase)
  const runInfo = useLabStore((state) => state.runInfo)
  const previewGrid = useLabStore((state) => state.previewGrid)

  const running = isLabRunActive(phase)

  return (
    <section aria-labelledby="lab-grid-heading" className="surface p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Grade</p>
          <h2
            id="lab-grid-heading"
            className="mt-1 flex items-center gap-1.5 font-display text-base font-semibold tracking-tight"
          >
            <Layers className="h-4 w-4 text-accentText" aria-hidden="true" />
            Playbook × ativo × timeframe
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {accepted && (
            <span className="inline-flex items-center gap-1 rounded-full border border-buy/30 bg-buy/[0.07] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-buy">
              <Check className="h-3 w-3" aria-hidden="true" />
              Grid aceito
            </span>
          )}
          <span className="rounded-full border border-line bg-white/[0.02] px-2 py-1 font-mono text-[9px] text-muted">
            {grid.length} combinações
          </span>
        </div>
      </header>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {grid.length === 0 && (
          <p className="text-[10.5px] leading-relaxed text-muted">
            Nenhuma combinação pré-visualizada. O grid usa o ativo e o timeframe base atuais e
            testa os playbooks A e B.
          </p>
        )}
        {grid.map((combo) => (
          <span
            key={combo.id}
            className="rounded-lg border border-line bg-white/[0.02] px-2 py-1 font-mono text-[9.5px] text-content/90"
          >
            {combo.label}
          </span>
        ))}
      </div>

      <div className="mt-3 rounded-2xl border border-line bg-white/[0.02] p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[10px] font-medium text-content">
            <CalendarRange className="h-3 w-3 text-muted" aria-hidden="true" />
            Walk-forward 60/20/20
          </p>
          <span className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted">
            OOS = teste
          </span>
        </div>

        <div
          className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/[0.04]"
          role="img"
          aria-label="Divisão fixa: 60% treino, 20% validação, 20% teste"
        >
          {SPLIT_SEGMENTS.map((segment) => (
            <span
              key={segment.label}
              className={`h-full ${segment.className}`}
              style={{ width: `${segment.share}%` }}
            />
          ))}
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          {SPLIT_SEGMENTS.map((segment, index) => {
            const range = runInfo?.split[index]
            return (
              <div key={segment.label}>
                <p className="text-[8px] uppercase tracking-[0.1em] text-muted">
                  {segment.label} · {segment.share}%
                </p>
                <p className="mt-0.5 font-mono text-[8.5px] tnum text-muted/80">
                  {range !== undefined
                    ? `${formatUnixDateTime(range.startTime)} → ${formatUnixDateTime(range.endTime)}`
                    : '—'}
                </p>
              </div>
            )
          })}
        </div>

        <p className="mt-2 text-[9.5px] leading-relaxed text-muted">
          O treino ajusta a leitura, a validação acompanha e o Edge Gate decide apenas com o teste
          fora da amostra. Divisões são fixas por índice de vela, sem embaralhar o tempo.
        </p>
      </div>

      <button
        type="button"
        onClick={previewGrid}
        disabled={running}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-accent/30 bg-accent/[0.1] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-accentText transition-colors hover:bg-accent/[0.16] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        Pré-visualizar grid
      </button>
    </section>
  )
}
