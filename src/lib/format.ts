const priceFormatters = new Map<number, Intl.NumberFormat>()

function priceFormatter(decimals: number): Intl.NumberFormat {
  const cached = priceFormatters.get(decimals)
  if (cached !== undefined) {
    return cached
  }

  const formatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  priceFormatters.set(decimals, formatter)
  return formatter
}

export function formatPrice(value: number, decimals: number): string {
  return priceFormatter(decimals).format(value)
}

export function formatPercent(value: number, decimals = 2): string {
  const absolute = Math.abs(value).toFixed(decimals).replace('.', ',')
  const rounded = Number(absolute.replace(',', '.'))

  if (rounded === 0) {
    return `0${decimals > 0 ? `,${'0'.repeat(decimals)}` : ''}%`
  }
  return `${value > 0 ? '+' : '-'}${absolute}%`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

export function formatTimeLabel(timestamp: number): string {
  const date = new Date(timestamp)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatUnixTime(timestampSeconds: number): string {
  return formatTimeLabel(timestampSeconds * 1000)
}

export function formatUnixDateTime(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000)
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

const usdFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatUsd(value: number): string {
  return usdFormatter.format(value)
}

export function formatSignedUsd(value: number): string {
  const formatted = usdFormatter.format(Math.abs(value))
  if (value > 0) return `+${formatted}`
  if (value < 0) return `-${formatted}`
  return formatted
}

export function formatDayKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return dayKey
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}`
}
