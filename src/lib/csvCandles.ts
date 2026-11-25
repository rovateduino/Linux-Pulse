import type { Candle } from '../types/market'
import type { LabTimeframe } from '../types/lab'

const REQUIRED_COLUMNS = ['open', 'high', 'low', 'close', 'volume'] as const
const TIMESTAMP_COLUMNS = ['timestamp_utc', 'timestamp', 'time'] as const
const HEADER_HINT = 'timestamp_utc,open,high,low,close,volume'

/** Normaliza as grafias aceitas para a coluna opcional `timeframe`. */
const TIMEFRAME_ALIASES: Readonly<Record<string, LabTimeframe>> = {
  '1m': '1m',
  m1: '1m',
  '5m': '5m',
  m5: '5m',
  '15m': '15m',
  m15: '15m',
}

export interface ParsedCandles {
  candles: Candle[]
  /** Timeframe declarado na coluna `timeframe`; `null` quando a coluna não existe. */
  timeframe: LabTimeframe | null
  source: string | null
  asset: string | null
  periodStartUtc: string | null
  periodEndUtc: string | null
  stepSeconds: number
  gapCount: number
  missingIntervals: number
}

const TIMEFRAME_SECONDS: Readonly<Record<LabTimeframe, number>> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
}

function invalid(message: string): Error {
  return new Error(message)
}

function toNumber(raw: string, column: string, lineNumber: number): number {
  const normalized = raw.trim().replace(/\s/g, '')
  const decimal = normalized.includes(',') && !normalized.includes('.')
    ? normalized.replace(',', '.')
    : normalized
  const value = Number(decimal)
  if (!Number.isFinite(value)) {
    throw invalid(`Linha ${lineNumber}: ${column} inválido (${raw.trim() === '' ? 'vazio' : raw.trim()}).`)
  }
  return value
}

function toSeconds(raw: string, lineNumber: number): number {
  const value = raw.trim()
  if (value === '') throw invalid(`Linha ${lineNumber}: timestamp vazio.`)

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) throw invalid(`Linha ${lineNumber}: timestamp inválido (${value}).`)
    return Math.floor(numeric > 1e12 ? numeric / 1000 : numeric)
  }

  const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value)
  const iso = hasZone
    ? value
    : /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T00:00:00Z`
      : `${value.replace(' ', 'T')}Z`
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) throw invalid(`Linha ${lineNumber}: timestamp inválido (${value}).`)
  return Math.floor(parsed / 1000)
}

function toTimeframe(raw: string, lineNumber: number): LabTimeframe {
  const normalized = raw.trim().toLowerCase()
  const match: LabTimeframe | undefined = TIMEFRAME_ALIASES[normalized]
  if (match === undefined) {
    throw invalid(
      `Linha ${lineNumber}: timeframe não suportado (${raw.trim()}). Use 1m, M1, 5m, M5, 15m ou M15.`,
    )
  }
  return match
}

function readConsistentMetadata(
  cells: readonly string[],
  index: number,
  previous: string | null,
  field: string,
  lineNumber: number,
): string | null {
  if (index === -1) return previous
  const value = (cells[index] ?? '').trim()
  if (value === '') throw invalid(`Linha ${lineNumber}: metadado ${field} vazio.`)
  if (previous !== null && previous !== value) {
    throw invalid(`Linha ${lineNumber}: metadado ${field} inconsistente.`)
  }
  return value
}

function modalStep(candles: readonly Candle[]): number {
  const counts = new Map<number, number>()
  for (let index = 1; index < candles.length; index += 1) {
    const difference = candles[index].time - candles[index - 1].time
    if (difference > 0) counts.set(difference, (counts.get(difference) ?? 0) + 1)
  }

  let step = 0
  let best = 0
  for (const [difference, count] of counts) {
    if (count > best || (count === best && (step === 0 || difference < step))) {
      best = count
      step = difference
    }
  }
  return step
}

export function parseCandlesCsv(text: string): ParsedCandles {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const headerIndex = lines.findIndex((line) => line.trim() !== '')
  if (headerIndex === -1) throw invalid('Arquivo CSV vazio.')

  const headerLine = lines[headerIndex].trim()
  const delimiter = headerLine.includes(';') ? ';' : ','
  const header = headerLine.split(delimiter).map((cell) => cell.trim().toLowerCase())

  const timestampIndex = TIMESTAMP_COLUMNS.reduce<number>(
    (found, column) => (found === -1 ? header.indexOf(column) : found),
    -1,
  )
  if (timestampIndex === -1) {
    throw invalid(`Coluna faltando: timestamp_utc (ou timestamp). Cabeçalho esperado: ${HEADER_HINT}.`)
  }

  const columns = REQUIRED_COLUMNS.map((column) => ({
    column,
    index: header.indexOf(column),
  }))
  const missing = columns.find((entry) => entry.index === -1)
  if (missing !== undefined) {
    throw invalid(`Coluna faltando: ${missing.column}. Cabeçalho esperado: ${HEADER_HINT}.`)
  }

  // Coluna opcional: quando existe, o timeframe declarado é lido linha a linha.
  const timeframeIndex = header.indexOf('timeframe')
  const sourceIndex = header.indexOf('source')
  const assetIndex = header.indexOf('asset')
  const periodStartIndex = header.indexOf('period_start_utc')
  const periodEndIndex = header.indexOf('period_end_utc')
  let declaredTimeframe: LabTimeframe | null = null
  let declaredSource: string | null = null
  let declaredAsset: string | null = null
  let declaredPeriodStart: string | null = null
  let declaredPeriodEnd: string | null = null

  const candles: Candle[] = []
  const seen = new Set<number>()

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line === '') continue

    const lineNumber = index + 1
    const cells = line.split(delimiter)
    const time = toSeconds(cells[timestampIndex] ?? '', lineNumber)
    const open = toNumber(cells[columns[0].index] ?? '', 'open', lineNumber)
    const high = toNumber(cells[columns[1].index] ?? '', 'high', lineNumber)
    const low = toNumber(cells[columns[2].index] ?? '', 'low', lineNumber)
    const close = toNumber(cells[columns[3].index] ?? '', 'close', lineNumber)
    const volume = toNumber(cells[columns[4].index] ?? '', 'volume', lineNumber)

    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
      throw invalid(`Linha ${lineNumber}: preço inválido (OHLC deve ser maior que zero).`)
    }
    if (volume < 0) throw invalid(`Linha ${lineNumber}: volume negativo.`)
    if (high < low || high < open || high < close || low > open || low > close) {
      throw invalid(`Linha ${lineNumber}: OHLC inconsistente.`)
    }
    if (seen.has(time)) throw invalid(`Linha ${lineNumber}: timestamp duplicado.`)

    if (timeframeIndex !== -1) {
      const raw = cells[timeframeIndex] ?? ''
      if (raw.trim() === '') throw invalid(`Linha ${lineNumber}: timeframe vazio.`)
      const value = toTimeframe(raw, lineNumber)
      if (declaredTimeframe === null) {
        declaredTimeframe = value
      } else if (declaredTimeframe !== value) {
        throw invalid(
          `Linha ${lineNumber}: timeframe inconsistente (o arquivo começou como ${declaredTimeframe} e esta linha indica ${value}).`,
        )
      }
    }

    declaredSource = readConsistentMetadata(
      cells,
      sourceIndex,
      declaredSource,
      'source',
      lineNumber,
    )
    declaredAsset = readConsistentMetadata(
      cells,
      assetIndex,
      declaredAsset,
      'asset',
      lineNumber,
    )
    declaredPeriodStart = readConsistentMetadata(
      cells,
      periodStartIndex,
      declaredPeriodStart,
      'period_start_utc',
      lineNumber,
    )
    declaredPeriodEnd = readConsistentMetadata(
      cells,
      periodEndIndex,
      declaredPeriodEnd,
      'period_end_utc',
      lineNumber,
    )

    seen.add(time)
    candles.push({ time, open, high, low, close, volume })
  }

  if (candles.length === 0) throw invalid('Nenhuma vela encontrada no CSV.')

  const sortedCandles = candles.sort((first, second) => first.time - second.time)
  const firstTime = sortedCandles[0].time
  const lastTime = sortedCandles[sortedCandles.length - 1].time
  if (
    declaredPeriodStart !== null &&
    toSeconds(declaredPeriodStart, headerIndex + 1) !== firstTime
  ) {
    throw invalid('O metadado period_start_utc não corresponde ao primeiro candle.')
  }
  if (
    declaredPeriodEnd !== null &&
    toSeconds(declaredPeriodEnd, headerIndex + 1) !== lastTime
  ) {
    throw invalid('O metadado period_end_utc não corresponde ao último candle.')
  }

  const observedStep = modalStep(sortedCandles)
  const stepSeconds =
    declaredTimeframe === null ? observedStep : TIMEFRAME_SECONDS[declaredTimeframe]
  if (stepSeconds > 0 && firstTime % stepSeconds !== 0) {
    throw invalid(
      `O primeiro candle não está alinhado ao timeframe de ${stepSeconds} s.`,
    )
  }

  let gapCount = 0
  let missingIntervals = 0
  if (stepSeconds > 0) {
    for (let index = 1; index < sortedCandles.length; index += 1) {
      const difference = sortedCandles[index].time - sortedCandles[index - 1].time
      if (difference % stepSeconds !== 0) {
        throw invalid(
          `Linha temporal irregular entre ${sortedCandles[index - 1].time} e ${sortedCandles[index].time}; intervalo não compatível com ${stepSeconds} s.`,
        )
      }
      if (difference > stepSeconds) {
        gapCount += 1
        missingIntervals += difference / stepSeconds - 1
      }
    }
  }

  return {
    candles: sortedCandles,
    timeframe: declaredTimeframe,
    source: declaredSource,
    asset: declaredAsset,
    periodStartUtc: declaredPeriodStart,
    periodEndUtc: declaredPeriodEnd,
    stepSeconds,
    gapCount,
    missingIntervals,
  }
}
