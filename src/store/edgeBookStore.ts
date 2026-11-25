import { EdgeBook } from '../engine/next'
import type { TradeResult } from '../engine/next'

const DATABASE_NAME = 'pulse-signals-edgebook'
const DATABASE_VERSION = 1
const TRADE_STORE = 'shadowTrades'

interface StoredShadowTrade {
  id: string
  bookKey: string
  symbol: string
  timeframeMinutes: number
  trade: TradeResult
}

const books = new Map<string, EdgeBook>()
const loading = new Map<string, Promise<EdgeBook>>()
const listeners = new Set<(symbol: string, timeframeMinutes: number) => void>()
let databasePromise: Promise<IDBDatabase> | null = null

function bookKey(symbol: string, timeframeMinutes: number): string {
  return `${symbol}:${timeframeMinutes}m`
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB indisponível; o EdgeBook não pode ser persistido.'))
  }
  if (databasePromise !== null) return databasePromise

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(TRADE_STORE)) {
        const store = database.createObjectStore(TRADE_STORE, { keyPath: 'id' })
        store.createIndex('bookKey', 'bookKey', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      reject(request.error ?? new Error('Falha ao abrir o EdgeBook IndexedDB.'))
    }
  })

  return databasePromise
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      reject(request.error ?? new Error('Falha ao ler o EdgeBook IndexedDB.'))
    }
  })
}

function isStoredShadowTrade(value: unknown): value is StoredShadowTrade {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<StoredShadowTrade>
  return (
    typeof record.id === 'string' &&
    typeof record.bookKey === 'string' &&
    typeof record.symbol === 'string' &&
    typeof record.timeframeMinutes === 'number' &&
    typeof record.trade === 'object' &&
    record.trade !== null &&
    typeof record.trade.moduleId === 'string' &&
    typeof record.trade.bucket === 'string' &&
    typeof record.trade.entryTime === 'number'
  )
}

function notify(symbol: string, timeframeMinutes: number): void {
  for (const listener of listeners) listener(symbol, timeframeMinutes)
}

export function getEdgeBook(symbol: string, timeframeMinutes: number): EdgeBook {
  return books.get(bookKey(symbol, timeframeMinutes)) ?? new EdgeBook()
}

export function subscribeEdgeBook(
  listener: (symbol: string, timeframeMinutes: number) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function loadEdgeBook(symbol: string, timeframeMinutes: number): Promise<EdgeBook> {
  const key = bookKey(symbol, timeframeMinutes)
  const cached = books.get(key)
  if (cached !== undefined) return Promise.resolve(cached)

  const pending = loading.get(key)
  if (pending !== undefined) return pending

  const promise = openDatabase()
    .then((database) => {
      const request = database
        .transaction(TRADE_STORE, 'readonly')
        .objectStore(TRADE_STORE)
        .index('bookKey')
        .getAll(key)
      return requestValue<unknown[]>(request)
    })
    .then((values) => {
      const book = new EdgeBook()
      book.addAll(values.filter(isStoredShadowTrade).map((value) => value.trade))
      books.set(key, book)
      notify(symbol, timeframeMinutes)
      return book
    })
    .finally(() => loading.delete(key))

  loading.set(key, promise)
  return promise
}

function shadowTradeId(
  symbol: string,
  timeframeMinutes: number,
  trade: TradeResult,
): string {
  return [
    symbol,
    timeframeMinutes,
    trade.moduleId,
    trade.bucket,
    trade.sessionId,
    trade.entryTime,
    trade.direction,
  ].join(':')
}

export async function appendShadowTrades(
  symbol: string,
  timeframeMinutes: number,
  trades: readonly TradeResult[],
): Promise<number> {
  const key = bookKey(symbol, timeframeMinutes)
  const book = await loadEdgeBook(symbol, timeframeMinutes)
  const database = await openDatabase()
  const additions: StoredShadowTrade[] = []

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(TRADE_STORE, 'readwrite')
    const store = transaction.objectStore(TRADE_STORE)
    const request = store.index('bookKey').getAll(key)

    request.onsuccess = () => {
      const existingIds = new Set(
        (request.result as unknown[])
          .filter(isStoredShadowTrade)
          .map((record) => record.id),
      )
      for (const trade of trades) {
        const id = shadowTradeId(symbol, timeframeMinutes, trade)
        if (existingIds.has(id)) continue
        existingIds.add(id)
        const record = { id, bookKey: key, symbol, timeframeMinutes, trade }
        additions.push(record)
        store.put(record)
      }
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('Falha ao persistir resultados sombra no EdgeBook.'))
    }
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('A gravação do EdgeBook foi cancelada.'))
    }
  })

  book.addAll(additions.map((record) => record.trade))
  if (additions.length > 0) notify(symbol, timeframeMinutes)
  return additions.length
}
