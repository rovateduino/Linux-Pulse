import { describe, expect, it } from 'vitest'
import { DEFAULT_SESSIONS } from '../../../config/sessions'
import type { Candle } from '../../../types/market'
import { filterCandlesBySession, isInSession } from '../sessionFilter'

function utcSeconds(hours: number, minutes = 0, seconds = 0): number {
  return Date.UTC(2026, 0, 5, hours, minutes, seconds) / 1000
}

const EURUSD_CSV = import.meta.glob('/candles_historico_EURUSD_M5.csv', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function loadCandles(modules: Record<string, string>): Candle[] {
  const raw = Object.values(modules)[0]
  if (raw === undefined) return []
  return raw
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const cells = line.split(',')
      return {
        time: Math.floor(Date.parse(cells[0]) / 1000),
        open: Number(cells[1]),
        high: Number(cells[2]),
        low: Number(cells[3]),
        close: Number(cells[4]),
        volume: Number(cells[5]),
      }
    })
}

describe('isInSession · fronteiras das janelas (UTC)', () => {
  it('inclusivo no início e exclusivo no fim', () => {
    expect(isInSession(utcSeconds(6, 59, 59))).toBe(false)
    expect(isInSession(utcSeconds(7, 0, 0))).toBe(true)
    expect(isInSession(utcSeconds(10, 59, 59))).toBe(true)
    expect(isInSession(utcSeconds(11, 0, 0))).toBe(false)

    // segunda janela padrão (Nova York 13:00-17:00)
    expect(isInSession(utcSeconds(12, 59, 59))).toBe(false)
    expect(isInSession(utcSeconds(13, 0, 0))).toBe(true)
    expect(isInSession(utcSeconds(16, 59, 59))).toBe(true)
    expect(isInSession(utcSeconds(17, 0, 0))).toBe(false)
  })

  it('usa DEFAULT_SESSIONS quando nenhuma janela é informada', () => {
    expect(DEFAULT_SESSIONS).toEqual([
      { name: 'london', startUtc: '07:00', endUtc: '11:00' },
      { name: 'ny', startUtc: '13:00', endUtc: '17:00' },
    ])
    expect(isInSession(utcSeconds(8, 30))).toBe(true)
    expect(isInSession(utcSeconds(12, 0))).toBe(false)
  })

  it('suporta janelas que cruzam a meia-noite', () => {
    const asia = [{ name: 'tokyo' as const, startUtc: '22:00', endUtc: '02:00' }]
    expect(isInSession(utcSeconds(21, 59, 59), asia)).toBe(false)
    expect(isInSession(utcSeconds(22, 0, 0), asia)).toBe(true)
    expect(isInSession(utcSeconds(23, 30), asia)).toBe(true)
    expect(isInSession(utcSeconds(1, 59, 59), asia)).toBe(true)
    expect(isInSession(utcSeconds(2, 0, 0), asia)).toBe(false)
  })

  it('ignora janelas malformadas e valores não finitos', () => {
    const broken = [{ name: 'london' as const, startUtc: 'nope', endUtc: '10:00' }]
    expect(isInSession(utcSeconds(8), broken)).toBe(false)
    expect(isInSession(Number.NaN)).toBe(false)
  })
})

describe('filterCandlesBySession · CSV real EURUSD M5', () => {
  const candles = loadCandles(EURUSD_CSV)

  it('reduz a contagem de velas em 50-70% com as janelas padrão', () => {
    expect(candles.length).toBeGreaterThan(1000)
    const kept = filterCandlesBySession(candles)
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThan(candles.length)

    const reduction = 1 - kept.length / candles.length
    expect(reduction).toBeGreaterThanOrEqual(0.5)
    expect(reduction).toBeLessThanOrEqual(0.7)
  })

  it('mantém apenas velas dentro das janelas', () => {
    for (const candle of filterCandlesBySession(candles)) {
      expect(isInSession(candle.time)).toBe(true)
    }
  })
})
