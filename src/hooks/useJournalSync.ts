import { useEffect, useRef } from 'react'
import type { AssetAnalysis } from '../types/market'
import { useJournalStore } from '../store/journalStore'
import { notifySignal, playAlertTone } from '../lib/alerts'
import { directionLabel } from '../lib/signalMeta'

export function useJournalSync(
  analyses: Record<string, AssetAnalysis>,
  sessionStart: number,
): void {
  useEffect(() => {
    useJournalStore.getState().sync(analyses, sessionStart)
  }, [analyses, sessionStart])
}

export function useSignalAlerts(analyses: Record<string, AssetAnalysis>): void {
  const soundEnabled = useJournalStore((state) => state.settings.soundEnabled)
  const notificationsEnabled = useJournalStore((state) => state.settings.notificationsEnabled)
  const seen = useRef<Set<string>>(new Set())
  const primed = useRef(false)

  useEffect(() => {
    const current = new Set<string>()
    for (const analysis of Object.values(analyses)) {
      const signal = analysis.signal
      if (signal.phase !== 'ENTRAR' || signal.active === null) continue
      const id = signal.active.id
      current.add(id)
      if (!primed.current || seen.current.has(id)) continue
      if (soundEnabled) playAlertTone()
      if (notificationsEnabled) {
        const expiry = useJournalStore.getState().settings.expiryCandles
        notifySignal(
          `PULSE SIGNALS · ${signal.active.symbol}`,
          `${directionLabel(signal.active.direction)} · Playbook ${signal.active.playbook} · expira em ${expiry} vela(s).`,
        )
      }
    }
    seen.current = current
    primed.current = true
  }, [analyses, soundEnabled, notificationsEnabled])
}
