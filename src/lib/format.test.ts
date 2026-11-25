import { describe, expect, it } from 'vitest'
import { formatClock, formatPercent, formatPrice, formatTimeLabel, formatUnixDateTime } from './format'

describe('formatPrice', () => {
  it('usa vírgula decimal e o número fixo de casas', () => {
    expect(formatPrice(1.248, 4)).toBe('1,2480')
    expect(formatPrice(128.4, 2)).toBe('128,40')
  })

  it('aplica separador de milhar em pt-BR', () => {
    expect(formatPrice(1234.5, 2)).toBe('1.234,50')
  })
})

describe('formatPercent', () => {
  it('prefixa o sinal e usa vírgula decimal', () => {
    expect(formatPercent(1.234)).toBe('+1,23%')
    expect(formatPercent(-1.234)).toBe('-1,23%')
  })

  it('evita saída negativa para valores que arredondam para zero', () => {
    expect(formatPercent(0)).toBe('0,00%')
    expect(formatPercent(-0.001)).toBe('0,00%')
    expect(formatPercent(0, 0)).toBe('0%')
  })
})

describe('formatClock', () => {
  it('formata horas, minutos e segundos com dois dígitos', () => {
    expect(formatClock(0)).toBe('00:00:00')
    expect(formatClock(59_999)).toBe('00:00:59')
    expect(formatClock(60_000)).toBe('00:01:00')
    expect(formatClock(3_723_000)).toBe('01:02:03')
  })

  it('nunca retorna tempo negativo', () => {
    expect(formatClock(-5_000)).toBe('00:00:00')
  })
})

describe('formatTimeLabel', () => {
  it('formata o horário local no padrão HH:MM:SS', () => {
    const timestamp = new Date(2026, 0, 15, 5, 4, 3).getTime()

    expect(formatTimeLabel(timestamp)).toBe('05:04:03')
  })
})

describe('formatUnixDateTime', () => {
  it('exibe data e hora locais a partir de segundos UTC', () => {
    const timestamp = new Date(2026, 0, 15, 5, 4, 3).getTime() / 1000
    expect(formatUnixDateTime(timestamp)).toBe('15/01 05:04:03')
  })
})
