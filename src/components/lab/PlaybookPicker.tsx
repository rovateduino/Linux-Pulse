import { isLabRunActive, useLabStore } from '../../stores/labStore'
import type { PlaybookId } from '../../types/lab'

const FIELD_CLASS =
  'w-full rounded-xl border border-line bg-white/[0.02] px-2.5 py-2 font-mono text-[11px] text-content outline-none transition-colors focus:border-accent/50'

const OPTIONS: { id: PlaybookId; label: string }[] = [
  { id: 'C', label: 'C · Momentum de sessão (breakout)' },
  { id: 'D', label: 'D · Reversão em extremos (fade)' },
  { id: 'A', label: 'A · Legado · pullback em tendência' },
  { id: 'B', label: 'B · Legado · reversão em lateral' },
]

/**
 * Seletor de playbook do laboratório. C/D são o registry principal;
 * A/B só aparecem quando o "modo legado" está ligado.
 */
export function PlaybookPicker({ idSuffix = '' }: { idSuffix?: string }) {
  const playbook = useLabStore((state) => state.config.playbook)
  const legacyPlaybooks = useLabStore((state) => state.config.legacyPlaybooks)
  const phase = useLabStore((state) => state.phase)
  const setConfig = useLabStore((state) => state.setConfig)

  const running = isLabRunActive(phase)
  const visible = OPTIONS.filter((option) => legacyPlaybooks || option.id === 'C' || option.id === 'D')

  return (
    <div>
      <label htmlFor={`lab-playbook${idSuffix}`} className="text-[9px] uppercase tracking-[0.1em] text-muted">
        Playbook
      </label>
      <select
        id={`lab-playbook${idSuffix}`}
        value={playbook}
        disabled={running}
        onChange={(event) => setConfig({ playbook: event.target.value as PlaybookId })}
        className={`mt-1 ${FIELD_CLASS}`}
      >
        {visible.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <label className="mt-2 flex items-center gap-1.5 text-[9.5px] text-muted">
        <input
          type="checkbox"
          checked={legacyPlaybooks}
          disabled={running}
          onChange={(event) => setConfig({ legacyPlaybooks: event.target.checked })}
          className="h-3 w-3 accent-accent"
        />
        Modo legado (A/B)
      </label>
    </div>
  )
}
