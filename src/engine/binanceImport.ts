import type { Candle } from '../types/market'
import type { LabDataset } from '../types/lab'

export const BINANCE_DAYS = 60
export const BINANCE_INTERVAL = '5m'
export const BINANCE_INTERVAL_SECONDS = 300
export const CANDLES_PER_DAY = 288
export const BINANCE_EXPECTED_CANDLES = BINANCE_DAYS * CANDLES_PER_DAY

const API_URL = 'https://api.binance.com/api/v3/klines'
const PAGE_LIMIT = 1000
const PAGE_DELAY_MS = 200
const REQUEST_TIMEOUT_MS = 15_000

export interface BinanceImportOptions {
  days?: number
  signal?: AbortSignal
  onProgress?: (pct: number) => void
  fetchImpl?: typeof fetch
  now?: number
}

interface BinanceErrorBody {
  code?: unknown
  msg?: unknown
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function aborted(signal?: AbortSignal): boolean {
  return signal !== undefined && signal.aborted
}

function abortError(): Error {
  const error = new Error('Importação cancelada.')
  error.name = 'AbortError'
  return error
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError())
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    function handleAbort() {
      signal?.removeEventListener('abort', handleAbort)
      if (timer !== undefined) clearTimeout(timer)
      reject(abortError())
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

function bodyMessage(body: unknown, symbol: string): string | null {
  if (typeof body !== 'object' || body === null) return null
  const { code, msg } = body as BinanceErrorBody
  if (typeof code === 'number' && code === -1121) {
    return `O símbolo ${symbol} não está disponível na Binance (delistado ou inválido).`
  }
  if (typeof msg !== 'string' || msg.trim() === '') return null
  return `Binance respondeu: ${msg}`
}

function httpMessage(status: number, body: unknown, symbol: string): string {
  const detail = bodyMessage(body, symbol)
  if (status === 451) {
    return 'A Binance bloqueia requisições desta região (HTTP 451).'
  }
  if (status === 418 || status === 429) {
    return 'Limite de requisições da Binance atingido. Aguarde alguns minutos e tente novamente.'
  }
  if (status >= 500) {
    return 'A Binance está indisponível no momento. Tente novamente mais tarde.'
  }
  if (detail !== null) return detail
  return `Falha ao consultar a Binance (HTTP ${status}).`
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

interface KlineRequest {
  symbol: string
  startTime: number
  endTime: number
  fetchImpl: typeof fetch
  signal?: AbortSignal
}

async function requestKlines(request: KlineRequest): Promise<unknown> {
  const { symbol, startTime, endTime, fetchImpl, signal } = request
  const controller = new AbortController()
  let timedOut = false
  let responseError: Error | null = null

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  const forwardAbort = () => controller.abort()
  if (aborted(signal)) {
    clearTimeout(timer)
    throw abortError()
  }
  signal?.addEventListener('abort', forwardAbort, { once: true })

  const url = new URL(API_URL)
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('interval', BINANCE_INTERVAL)
  url.searchParams.set('limit', String(PAGE_LIMIT))
  url.searchParams.set('startTime', String(startTime))
  url.searchParams.set('endTime', String(endTime))

  try {
    const response = await fetchImpl(url.toString(), {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    const body = await readBody(response)
    if (!response.ok) {
      responseError = new Error(httpMessage(response.status, body, symbol))
      throw responseError
    }
    return body
  } catch (error) {
    if (responseError !== null) throw responseError
    if (aborted(signal)) throw abortError()
    if (timedOut) {
      throw new Error('Tempo esgotado ao consultar a Binance. Tente novamente.')
    }
    if (isAbortError(error)) throw abortError()
    throw new Error(
      'Falha de rede ao acessar a Binance. Verifique a conexão e tente novamente.',
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

function parseKline(row: readonly unknown[]): Candle | null {
  if (row.length < 6) return null
  const openTime = row[0]
  if (typeof openTime !== 'number' || !Number.isFinite(openTime)) return null

  const open = Number(row[1])
  const high = Number(row[2])
  const low = Number(row[3])
  const close = Number(row[4])
  const volume = Number(row[5])
  if (
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    !Number.isFinite(volume)
  ) {
    return null
  }
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) return null
  if (high < low) return null
  if (high < Math.max(open, close) || low > Math.min(open, close)) return null

  return {
    time: Math.floor(openTime / 1000),
    open,
    high,
    low,
    close,
    volume,
  }
}

export async function fetchBinanceCandles(
  symbol: string,
  options: BinanceImportOptions = {},
): Promise<LabDataset> {
  const days = Math.max(1, Math.floor(options.days ?? BINANCE_DAYS))
  const expected = days * CANDLES_PER_DAY
  const intervalMs = BINANCE_INTERVAL_SECONDS * 1000
  const nowMs = options.now ?? Date.now()
  const lastClosedOpenMs = Math.floor(nowMs / intervalMs) * intervalMs - intervalMs
  const startOpenMs = lastClosedOpenMs - (expected - 1) * intervalMs
  const totalPages = Math.ceil(expected / PAGE_LIMIT)
  const fetchImpl: typeof fetch =
    options.fetchImpl ?? ((input, init) => fetch(input, init))
  const signal = options.signal
  const onProgress = options.onProgress

  const byTime = new Map<number, Candle>()
  let cursor = startOpenMs
  let page = 0

  while (cursor <= lastClosedOpenMs) {
    if (signal?.aborted === true) throw abortError()
    if (page >= totalPages + 8) break

    const body = await requestKlines({
      symbol,
      startTime: cursor,
      endTime: lastClosedOpenMs,
      fetchImpl,
      signal,
    })
    if (!Array.isArray(body)) {
      throw new Error('Resposta inesperada da Binance. Nenhum candle foi aceito.')
    }
    if (body.length === 0) break

    const rows: readonly unknown[] = body
    let lastRawOpen: number | null = null
    for (const row of rows) {
      const values: readonly unknown[] = Array.isArray(row) ? row : []
      if (values.length === 0) continue
      const rawOpen = values[0]
      if (typeof rawOpen !== 'number' || !Number.isFinite(rawOpen)) continue
      if (rawOpen < startOpenMs || rawOpen > lastClosedOpenMs) continue
      if (lastRawOpen === null || rawOpen > lastRawOpen) lastRawOpen = rawOpen
      const candle = parseKline(values)
      if (candle !== null) byTime.set(candle.time, candle)
    }

    page += 1
    onProgress?.(Math.min(99, Math.round((page / totalPages) * 100)))
    if (lastRawOpen === null || lastRawOpen >= lastClosedOpenMs) break

    cursor = lastRawOpen + intervalMs
    if (cursor > lastClosedOpenMs) break
    await sleep(PAGE_DELAY_MS, signal)
  }

  const candles = [...byTime.values()].sort((first, second) => first.time - second.time)
  if (candles.length === 0) {
    throw new Error(
      `A Binance não retornou candles fechados para ${symbol}. Nenhuma vela foi inventada.`,
    )
  }

  onProgress?.(100)

  return {
    symbol,
    source: 'binance',
    candles,
    fetchedAt: Date.now(),
    gaps: Math.max(0, expected - candles.length),
    expected,
  }
}
