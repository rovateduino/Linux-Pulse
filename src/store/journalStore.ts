import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { AssetAnalysis, SignalRecord } from '../types/market'
import { DEFAULT_SETTINGS, type AppSettings, type PaperTrade } from '../types/trading'
import { tradePnl } from '../engine/paper'

interface JournalStore {
  settings: AppSettings
  trades: PaperTrade[]
  clearedRecordIds: string[]
  updateSettings: (patch: Partial<AppSettings>) => void
  sync: (analyses: Record<string, AssetAnalysis>, sessionStart: number) => void
  reset: (clearedRecordIds: string[]) => void
}

type PersistedJournalState = {
  settings?: Partial<AppSettings>
  trades?: PaperTrade[]
  clearedRecordIds?: string[]
}

export const useJournalStore = create<JournalStore>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      trades: [],
      clearedRecordIds: [],

      updateSettings: (patch) => {
        set((state) => ({ settings: { ...state.settings, ...patch } }))
      },

      sync: (analyses, sessionStart) => {
        const { trades, clearedRecordIds } = get()
        const candidates = new Map<string, SignalRecord>()
        const clearedIds = new Set(clearedRecordIds)

        for (const analysis of Object.values(analyses)) {
          for (const record of analysis.records) {
            if (record.entryTime >= sessionStart && !clearedIds.has(record.id)) {
              candidates.set(record.id, record)
            }
          }
          const active = analysis.signal.active
          if (
            analysis.signal.phase === 'ENTRAR' &&
            active !== null &&
            active.outcome === null &&
            active.entryTime >= sessionStart &&
            !clearedIds.has(active.id)
          ) {
            candidates.set(active.id, active)
          }
        }
        if (candidates.size === 0) return

        const next = [...trades]
        const indexById = new Map(next.map((trade, index) => [trade.id, index]))
        let changed = false

        const ordered = [...candidates.values()].sort(
          (a, b) => a.entryTime - b.entryTime || a.id.localeCompare(b.id),
        )

        for (const record of ordered) {
          const existingIndex = indexById.get(record.id)
          if (existingIndex !== undefined) {
            const existing = next[existingIndex]
            if (existing.outcome === null && record.outcome !== null && record.exitPrice !== null) {
              next[existingIndex] = {
                ...existing,
                outcome: record.outcome,
                exitPrice: record.exitPrice,
                closedAt: record.expiresAt,
                expiresAt: record.expiresAt,
                pnl: tradePnl(record.outcome, existing.stake, existing.payout, existing.tieRefund),
              }
              changed = true
            }
          }
        }

        if (changed) set({ trades: next })
      },

      reset: (clearedRecordIds) => set({ trades: [], clearedRecordIds }),
    }),
    {
      name: 'pulse-signals-journal-v1',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) => {
        const saved = persistedState as PersistedJournalState
        const savedMinTrades = saved.settings?.minTradesPerBucket
        return {
          ...saved,
          settings: {
            ...saved.settings,
            ...(version < 2 && savedMinTrades === 300 ? { minTradesPerBucket: 10 } : {}),
          },
        }
      },
      partialize: (state) => ({
        settings: state.settings,
        trades: state.trades,
        clearedRecordIds: state.clearedRecordIds,
      }),
      merge: (persisted, current) => {
        const saved = persisted as PersistedJournalState | undefined
        return {
          ...current,
          settings: { ...DEFAULT_SETTINGS, ...saved?.settings },
          trades: Array.isArray(saved?.trades) ? saved.trades : [],
          clearedRecordIds: Array.isArray(saved?.clearedRecordIds)
            ? saved.clearedRecordIds
            : [],
        }
      },
    },
  ),
)
