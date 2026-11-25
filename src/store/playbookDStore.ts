import { create } from 'zustand'
import { DEFAULT_SESSIONS } from '../config/sessions'
import { findAsset } from '../data/assets'
import { PLAYBOOKS } from '../engine/playbooks'
import {
  PLAYBOOK_D_TF_SECONDS,
  playbookDTradeId,
  settlePlaybookDTrade,
  type PlaybookDLiveTrade,
} from '../engine/playbooks/liveD'
import type { Candle } from '../types/market'
import { useJournalStore } from './journalStore'

const DB_NAME = 'pulse-signals-playbookd'
const DB_VERSION = 1
const TRADE_STORE = 'trades'

interface PlaybookDState {
  trades: PlaybookDLiveTrade[]
  /** Último candle M15 fechado já avaliado por ativo (anti-reavaliação). */
  evaluatedSignalTime: Record<string, number>
  hydrated: boolean
  hydrate: () => void
  /**
   * Processa um pacote de candles M15 reais de um ativo:
   * liquida trades abertos cuja vela de saída fechou e avalia o Playbook D
   * no último candle fechado (sem look-ahead — candle em formação ignorado).
   */
  ingest: (symbol: string, candles: readonly Candle[], nowSec: number) => void
}

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB indisponível.'))
  }
  if (databasePromise !== null) return databasePromise
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(TRADE_STORE)) {
        database.createObjectStore(TRADE_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      reject(request.error ?? new Error('Falha ao abrir o IndexedDB do Playbook D.'))
    }
  })
  return databasePromise
}

function isPlaybookDTrade(value: unknown): value is PlaybookDLiveTrade {
  const record = value as Partial<PlaybookDLiveTrade>
  return (
    typeof record?.id === 'string' &&
    typeof record.symbol === 'string' &&
    typeof record.signalTime === 'number' &&
    typeof record.entryPrice === 'number' &&
    (record.direction === 'UP' || record.direction === 'DOWN')
  )
}

/** Persistência best-effort: sem IndexedDB (testes/SSR) opera só em memória. */
function persistTrade(trade: PlaybookDLiveTrade): void {
  if (typeof indexedDB === 'undefined') return
  void openDatabase()
    .then((database) => {
      const transaction = database.transaction(TRADE_STORE, 'readwrite')
      transaction.objectStore(TRADE_STORE).put(trade)
    })
    .catch(() => undefined)
}

export const usePlaybookDStore = create<PlaybookDState>()((set, get) => ({
  trades: [],
  evaluatedSignalTime: {},
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof indexedDB === 'undefined') return
    void openDatabase()
      .then((database) => {
        const request = database.transaction(TRADE_STORE, 'readonly').objectStore(TRADE_STORE).getAll()
        return new Promise<unknown[]>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result as unknown[])
          request.onerror = () => reject(request.error)
        })
      })
      .then((values) => {
        set({
          trades: values.filter(isPlaybookDTrade),
          hydrated: true,
        })
      })
      .catch(() => {
        // Sem persistência disponível: segue apenas em memória.
        set({ hydrated: true })
      })
  },

  ingest: (symbol, candles, nowSec) => {
    if (candles.length === 0) return
    const tf = PLAYBOOK_D_TF_SECONDS

    // Último candle FECHADO: só é conhecido depois de time + tf <= nowSec.
    let lastClosedIdx = -1
    for (let index = candles.length - 1; index >= 0; index -= 1) {
      if (candles[index].time + tf <= nowSec) {
        lastClosedIdx = index
        break
      }
    }
    if (lastClosedIdx < 0) return

    const lastClosed = candles[lastClosedIdx]
    const closedPrefix = candles.slice(0, lastClosedIdx + 1)
    const asset = findAsset(symbol)
    const state = get()
    const payout = useJournalStore.getState().settings.payout

    // 1) Liquida trades abertos do ativo cuja vela de saída já fechou.
    const openTrades = state.trades.filter(
      (trade) => trade.symbol === symbol && trade.outcome === undefined,
    )
    const settled: PlaybookDLiveTrade[] = []
    const stillOpen: PlaybookDLiveTrade[] = []
    for (const trade of openTrades) {
      const exitIndex = closedPrefix.findIndex((candle) => candle.time > trade.signalTime)
      if (exitIndex === -1) {
        stillOpen.push(trade)
      } else {
        settled.push(settlePlaybookDTrade(trade, closedPrefix[exitIndex], asset.tickSize))
      }
    }

    // 2) Avalia o Playbook D somente quando um NOVO candle fechou agora
    //    (freshness < 1 vela evita sinais zumbis de dados velhos).
    const freshClose = lastClosed.time + tf > nowSec - tf
    const previousEval = state.evaluatedSignalTime[symbol] ?? Number.NEGATIVE_INFINITY
    const shouldEvaluate = freshClose && lastClosed.time > previousEval
    let nextTrade: PlaybookDLiveTrade | null = null

    if (shouldEvaluate) {
      const signal = PLAYBOOKS.D(candles, lastClosedIdx, asset, DEFAULT_SESSIONS)
      if (signal !== null) {
        const id = playbookDTradeId(symbol, lastClosed.time, signal.direction)
        const exists = state.trades.some((trade) => trade.id === id)
        if (!exists) {
          nextTrade = {
            id,
            symbol,
            direction: signal.direction,
            signalTime: lastClosed.time,
            entryPrice: lastClosed.close,
            payout,
            createdAt: nowSec * 1000,
          }
        }
      }
    }

    const evaluatedSignalTime = shouldEvaluate
      ? { ...state.evaluatedSignalTime, [symbol]: lastClosed.time }
      : state.evaluatedSignalTime

    if (settled.length > 0 || nextTrade !== null) {
      const remaining = state.trades.filter(
        (trade) => !(trade.symbol === symbol && trade.outcome === undefined),
      )
      set({
        trades: [...remaining, ...stillOpen, ...settled, ...(nextTrade ? [nextTrade] : [])],
        evaluatedSignalTime,
      })
      for (const trade of [...settled, ...(nextTrade ? [nextTrade] : [])]) persistTrade(trade)
    } else {
      set({ evaluatedSignalTime })
    }
  },
}))
