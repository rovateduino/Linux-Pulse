import { describe, expect, it } from 'vitest'
import { ASSETS } from '../../data/assets'
import { aggregateCandles, createSimFeed } from '../../data/simulator'
import type { RunBacktestInput } from '../../types/lab'
import type { TradeOutcome } from '../../types/market'
import { LAB_STAKE_USD, labTradesCsv, runBacktest } from '../backtest'
import { RANDOM_BASELINE_SEED, runBaselines } from '../baselines'
import { WARMUP_INDEX } from '../strategy'

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0)
const PAYOUT = 0.85
const EXPIRY = 1
const asset = ASSETS[0]
const feed = createSimFeed(NOW, [asset])
const m5 = aggregateCandles(feed.series[asset.symbol] ?? [], 300)

function config(overrides: Partial<RunBacktestInput> = {}): RunBacktestInput {
  return {
    symbol: asset.symbol,
    timeframe: '5m',
    confirmation: '15m',
    payout: PAYOUT,
    expiryCandles: EXPIRY,
    m5Candles: m5,
    ...overrides,
  }
}

describe('runBacktest', () => {
  it('produz resultados determinísticos', () => {
    const first = runBacktest(config())
    const second = runBacktest(config())

    expect(second).toEqual(first)
    expect(first.results.map((result) => result.playbook)).toEqual(['C', 'D'])
  })

  it('não usa candles futuros na decisão do sinal', () => {
    const full = runBacktest(config())
    const trades = full.results.flatMap((result) => result.trades)
    expect(trades.length).toBeGreaterThan(0)

    const minimumExit = WARMUP_INDEX + 12
    const sample = [...trades]
      .filter((trade) => trade.exitIndex >= minimumExit)
      .sort((first, second) => first.exitIndex - second.exitIndex)
      .slice(-8)
    expect(sample.length).toBeGreaterThan(0)
    for (const trade of sample) {
      const prefix = runBacktest(
        config({ m5Candles: m5.slice(0, trade.exitIndex + 1) }),
      )
      const match = prefix.results
        .flatMap((result) => result.trades)
        .find(
          (candidate) =>
            candidate.playbook === trade.playbook &&
            candidate.triggerIndex === trade.triggerIndex,
        )

      expect(match).toBeDefined()
      if (match === undefined) {
        throw new Error(
          `Operação ausente no prefixo: ${trade.playbook} @ ${trade.triggerIndex}`,
        )
      }
      expect(match).toEqual({ ...trade, split: match.split })
    }
  })

  it('registra no máximo uma operação por sinal', () => {
    const output = runBacktest(config())
    const trades = output.results.flatMap((result) => result.trades)
    const triggers = trades.map((trade) => trade.triggerIndex)

    expect(trades.length).toBeGreaterThan(0)
    expect(new Set(triggers).size).toBe(triggers.length)
    expect(output.opportunities).toHaveLength(triggers.length)

    for (const trade of trades) {
      const entry = m5[trade.entryIndex]
      const exit = m5[trade.exitIndex]

      expect(trade.entryIndex).toBe(trade.triggerIndex + 1)
      expect(trade.exitIndex).toBe(trade.triggerIndex + EXPIRY)
      expect(trade.entryTime).toBe(entry.time)
      expect(trade.entryPrice).toBe(entry.open)
      expect(trade.exitTime).toBe(trade.entryTime + EXPIRY * 300)
      expect(trade.exitPrice).toBe(exit.close)

      const expected: TradeOutcome =
        exit.close === entry.open
          ? 'TIE'
          : (trade.direction === 'UP') === (exit.close > entry.open)
            ? 'WIN'
            : 'LOSS'
      expect(trade.outcome).toBe(expected)
      expect(trade.pnlUsd).toBe(
        expected === 'WIN'
          ? LAB_STAKE_USD * PAYOUT
          : expected === 'LOSS'
            ? -LAB_STAKE_USD
            : 0,
      )

      const split = output.split.find(
        (range) =>
          trade.entryIndex >= range.startIndex && trade.entryIndex < range.endIndex,
      )
      expect(trade.split).toBe(split?.name)
    }
  })

  it('separa treino, validação e teste e avalia o Edge Gate só no teste', () => {
    const output = runBacktest(config())

    expect(output.split.map((range) => range.name)).toEqual([
      'treino',
      'validacao',
      'teste',
    ])
    expect(output.split[0].startIndex).toBe(0)
    expect(output.split[1].startIndex).toBe(Math.floor(m5.length * 0.6))
    expect(output.split[2].startIndex).toBe(Math.floor(m5.length * 0.8))
    expect(output.split[2].endIndex).toBe(m5.length)

    for (const result of output.results) {
      expect(result.train.n + result.validation.n + result.test.n).toBe(
        result.overall.n,
      )
      expect(result.overall.n).toBe(result.trades.length)
      expect(result.test.n).toBeLessThanOrEqual(result.overall.n)
      expect(result.gate.n).toBe(result.test.n)
      expect(result.gate.wins).toBe(result.test.wins)
      expect(result.gate.low).toBeCloseTo(result.test.low, 12)
      expect(result.gate.high).toBeCloseTo(result.test.high, 12)
      expect(result.gate.breakeven).toBeCloseTo(result.test.breakeven, 12)
    }
  })

  it('exporta CSV com cabeçalho fixo e colunas documentadas', () => {
    const output = runBacktest(config())
    const trades = output.results.flatMap((result) => result.trades)
    expect(trades.length).toBeGreaterThan(0)

    const lines = labTradesCsv(trades).split('\r\n')
    expect(lines[0]).toBe(
      'timestamp_utc;ativo;timeframe;playbook;direcao;entrada;saida;resultado;payout;pnl_usd',
    )
    expect(lines).toHaveLength(trades.length + 1)

    const columns = lines[1].split(';')
    expect(columns).toHaveLength(10)
    expect(columns[0]).toMatch(/Z$/)
    expect(columns[1]).toBe(asset.symbol)
    expect(columns[2]).toBe('M5')
    expect(['C', 'D']).toContain(columns[3])
    expect(['COMPRA', 'VENDA']).toContain(columns[4])
    expect(['ACERTO', 'ERRO', 'EMPATE']).toContain(columns[7])
    expect(columns[8]).toBe('0,85')
  })

  it('mantém baselines estáveis com a mesma semente', () => {
    const output = runBacktest(config())
    const input = {
      symbol: asset.symbol,
      timeframe: '5m' as const,
      payout: PAYOUT,
      stake: LAB_STAKE_USD,
      opportunities: output.opportunities,
    }

    const first = runBaselines(input)
    const second = runBaselines({ ...input, seed: RANDOM_BASELINE_SEED })

    expect(second).toEqual(first)
    expect(first.map((baseline) => baseline.kind)).toEqual([
      'aleatoria',
      'sempre_call',
      'ultima_vela',
    ])

    const testOpportunities = output.opportunities.filter(
      (opportunity) => opportunity.split === 'teste',
    )
    for (const baseline of first) {
      expect(baseline.metrics.n).toBe(testOpportunities.length)
      expect(baseline.gate.n).toBe(baseline.metrics.n)
    }
  })
})
