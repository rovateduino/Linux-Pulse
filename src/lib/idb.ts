import type { GateVerdictKind, EdgeVerdictRecord } from '../types/edge'
import type { Candle } from '../types/market'
import type { LabTimeframe } from '../types/lab'

const DB_NAME = 'pulse-signals-lab'
const DB_VERSION = 3
const STORE = 'candles'
const BOT_STORE = 'botCandles'
const EDGE_HISTORY_STORE = 'edgeHistory'

export interface CandleCacheEntry {
  id: string
  symbol: string
  interval: '5m'
  days: number
  fetchedAt: number
  gaps: number
  candles: Candle[]
}

/** CSV exportado pelo bot, persistido pelo nome do ativo. */
export interface BotCandleCacheEntry {
  symbol: string
  source: 'bot'
  timeframe: LabTimeframe | null
  fetchedAt: number
  gaps: number
  expected: number
  fileName: string | null
  candles: Candle[]
}

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB indisponível neste navegador.'))
  }
  if (databasePromise !== null) return databasePromise

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(BOT_STORE)) {
        database.createObjectStore(BOT_STORE, { keyPath: 'symbol' })
      }
      if (!database.objectStoreNames.contains(EDGE_HISTORY_STORE)) {
        database.createObjectStore(EDGE_HISTORY_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      reject(request.error ?? new Error('Falha ao abrir o cache IndexedDB.'))
    }
  })

  return databasePromise
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      reject(request.error ?? new Error('Falha ao acessar o cache IndexedDB.'))
    }
  })
}

export function candleCacheKey(symbol: string, days: number): string {
  return `${symbol}:5m:${days}`
}

function isCacheEntry(value: unknown): value is CandleCacheEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<CandleCacheEntry>
  const first = Array.isArray(entry.candles) ? entry.candles[0] : undefined
  return (
    typeof entry.symbol === 'string' &&
    typeof entry.fetchedAt === 'number' &&
    typeof entry.gaps === 'number' &&
    Array.isArray(entry.candles) &&
    entry.candles.length > 0 &&
    typeof first === 'object' &&
    first !== null &&
    typeof first.time === 'number'
  )
}

export async function readCandlesCache(
  symbol: string,
  days: number,
): Promise<CandleCacheEntry | null> {
  try {
    const database = await openDatabase()
    const request = database
      .transaction(STORE, 'readonly')
      .objectStore(STORE)
      .get(candleCacheKey(symbol, days))
    const value: unknown = await requestValue(request)
    return isCacheEntry(value) ? value : null
  } catch {
    return null
  }
}

export async function writeCandlesCache(entry: CandleCacheEntry): Promise<void> {
  const database = await openDatabase()
  await requestValue(
    database.transaction(STORE, 'readwrite').objectStore(STORE).put(entry),
  )
}

export async function clearCandlesCache(): Promise<void> {
  const database = await openDatabase()
  await requestValue(database.transaction(STORE, 'readwrite').objectStore(STORE).clear())
}

function isBotCacheEntry(value: unknown): value is BotCandleCacheEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<BotCandleCacheEntry>
  const first = Array.isArray(entry.candles) ? entry.candles[0] : undefined
  const timeframe = entry.timeframe
  const validTimeframe =
    timeframe === null ||
    timeframe === undefined ||
    timeframe === '1m' ||
    timeframe === '5m' ||
    timeframe === '15m'
  return (
    typeof entry.symbol === 'string' &&
    entry.source === 'bot' &&
    typeof entry.fetchedAt === 'number' &&
    typeof entry.gaps === 'number' &&
    typeof entry.expected === 'number' &&
    validTimeframe &&
    Array.isArray(entry.candles) &&
    entry.candles.length > 0 &&
    typeof first === 'object' &&
    first !== null &&
    typeof first.time === 'number'
  )
}

export async function readBotCandlesCache(
  symbol: string,
): Promise<BotCandleCacheEntry | null> {
  try {
    const database = await openDatabase()
    const request = database
      .transaction(BOT_STORE, 'readonly')
      .objectStore(BOT_STORE)
      .get(symbol)
    const value: unknown = await requestValue(request)
    return isBotCacheEntry(value) ? value : null
  } catch {
    return null
  }
}

export async function listBotCandlesCache(): Promise<BotCandleCacheEntry[]> {
  try {
    const database = await openDatabase()
    const request = database
      .transaction(BOT_STORE, 'readonly')
      .objectStore(BOT_STORE)
      .getAll()
    const value: unknown = await requestValue(request)
    return Array.isArray(value) ? value.filter(isBotCacheEntry) : []
  } catch {
    return []
  }
}

export async function writeBotCandlesCache(entry: BotCandleCacheEntry): Promise<void> {
  const database = await openDatabase()
  await requestValue(
    database.transaction(BOT_STORE, 'readwrite').objectStore(BOT_STORE).put(entry),
  )
}

const GATE_VERDICT_KINDS: readonly string[] = ['KILL', 'INCONCLUSIVE', 'CONFIRM']

function isGateVerdictKind(value: unknown): value is GateVerdictKind {
  return typeof value === 'string' && GATE_VERDICT_KINDS.includes(value)
}

function isEdgeVerdictRecord(value: unknown): value is EdgeVerdictRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<EdgeVerdictRecord>
  return (
    typeof record.id === 'string' &&
    typeof record.symbol === 'string' &&
    typeof record.timeframe === 'string' &&
    typeof record.playbook === 'string' &&
    typeof record.computedAt === 'number' &&
    typeof record.payout === 'number' &&
    typeof record.n === 'number' &&
    typeof record.wins === 'number' &&
    typeof record.winRate === 'number' &&
    typeof record.se === 'number' &&
    typeof record.breakeven === 'number' &&
    typeof record.killBound === 'number' &&
    typeof record.confirmBound === 'number' &&
    isGateVerdictKind(record.kind) &&
    typeof record.reason === 'string'
  )
}

/** Grava os vereditos do Edge Gate no histórico de auditoria. */
export async function writeEdgeHistory(
  records: readonly EdgeVerdictRecord[],
): Promise<void> {
  if (records.length === 0) return
  const database = await openDatabase()
  const transaction = database.transaction(EDGE_HISTORY_STORE, 'readwrite')
  const store = transaction.objectStore(EDGE_HISTORY_STORE)
  for (const record of records) store.put(record)
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Falha ao gravar o histórico do Edge Gate.'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Falha ao gravar o histórico do Edge Gate.'))
  })
}

/** Histórico de vereditos do Edge Gate, do mais recente ao mais antigo. */
export async function listEdgeHistory(): Promise<EdgeVerdictRecord[]> {
  try {
    const database = await openDatabase()
    const request = database
      .transaction(EDGE_HISTORY_STORE, 'readonly')
      .objectStore(EDGE_HISTORY_STORE)
      .getAll()
    const value: unknown = await requestValue(request)
    return Array.isArray(value)
      ? value.filter(isEdgeVerdictRecord).sort((a, b) => b.computedAt - a.computedAt)
      : []
  } catch {
    return []
  }
}
