import { describe, expect, it } from 'vitest'
import { DEFAULT_SESSIONS } from '../../config/sessions'
import { ASSETS } from '../../data/assets'
import { aggregateCandles, createSimFeed } from '../../data/simulator'
import type { RunBacktestInput, SessionWindow } from '../../types/lab'
import { runBacktest } from '../backtest'

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0)
const asset = ASSETS[0]
const feed = createSimFeed(NOW, [asset])
const m5 = aggregateCandles(feed.series[asset.symbol] ?? [], 300)

/** Cobre o dia inteiro em [00:00, 24:00): equivale a "sem filtro". */
const ALL_DAY: SessionWindow[] = [
  { name: 'london', startUtc: '00:00', endUtc: '12:00' },
  { name: 'ny', startUtc: '12:00', endUtc: '00:00' },
]

function config(overrides: Partial<RunBacktestInput> = {}): RunBacktestInput {
  return {
    symbol: asset.symbol,
    timeframe: '5m',
    confirmation: '15m',
    payout: 0.85,
    expiryCandles: 1,
    m5Candles: m5,
    ...overrides,
  }
}

function tradeKey(trade: { playbook: string; triggerIndex: number }): string {
  return `${trade.playbook}:${trade.triggerIndex}`
}

describe('runBacktest · filtro de sessão', () => {
  it('usa DEFAULT_SESSIONS quando runConfig.sessions é omitido', () => {
    const output = runBacktest(config())
    expect(output.sessionsUsed).toEqual(DEFAULT_SESSIONS)
    expect(output.pctCandlesFiltrados).toBeGreaterThan(0)
    expect(output.pctCandlesFiltrados).toBeLessThan(100)
  })

  it('reflete no runInfo as janelas informadas na config', () => {
    const custom: SessionWindow[] = [
      { name: 'tokyo', startUtc: '01:00', endUtc: '05:00' },
    ]
    const output = runBacktest(config({ sessions: custom }))
    expect(output.sessionsUsed).toEqual(custom)
  })

  it('pctCandlesFiltrados é ~1 - cobertura das janelas', () => {
    const output = runBacktest(config({ sessions: DEFAULT_SESSIONS }))
    // London (4h) + NY (4h) = 8h de 24h => ~66,7% filtrado.
    expect(output.pctCandlesFiltrados).toBeGreaterThan(50)
    expect(output.pctCandlesFiltrados).toBeLessThan(70)
  })

  it('é seleção pura: menos trades e outcomes por trade inalterados', () => {
    const filtered = runBacktest(config({ sessions: DEFAULT_SESSIONS }))
    const unfiltered = runBacktest(config({ sessions: ALL_DAY }))

    const filteredTrades = filtered.results.flatMap((result) => result.trades)
    const unfilteredTrades = unfiltered.results.flatMap((result) => result.trades)
    const baseline = new Map(
      unfilteredTrades.map((trade) => [tradeKey(trade), trade]),
    )

    expect(unfilteredTrades.length).toBeGreaterThan(0)
    expect(filteredTrades.length).toBeGreaterThan(0)
    expect(filteredTrades.length).toBeLessThan(unfilteredTrades.length)

    for (const trade of filteredTrades) {
      const reference = baseline.get(tradeKey(trade))
      expect(reference).toBeDefined()
      // Filtro é de seleção: cada operação sobrevivente é idêntica à original.
      expect(trade.outcome).toBe(reference?.outcome)
      expect(trade.entryTime).toBe(reference?.entryTime)
      expect(trade.entryPrice).toBe(reference?.entryPrice)
      expect(trade.exitTime).toBe(reference?.exitTime)
      expect(trade.exitPrice).toBe(reference?.exitPrice)
      expect(trade.pnlUsd).toBe(reference?.pnlUsd)
    }
  })
})
