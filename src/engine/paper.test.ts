import { describe, expect, it } from 'vitest'
import {
  computeStats,
  dailyStatus,
  dayGate,
  statsByPlaybook,
  tradeFromRecord,
  tradePnl,
  tradesCsv,
  utcDayKey,
} from './paper'
import { DEFAULT_SETTINGS, type AppSettings, type PaperTrade } from '../types/trading'
import type { SignalRecord, TradeOutcome } from '../types/market'

const settings: AppSettings = {
  ...DEFAULT_SETTINGS,
  initialBalance: 1000,
  stake: 10,
  payout: 0.85,
  tieRefund: true,
  dailyStop: 50,
  dailyCap: 100,
}

const DAY = '2026-01-15'

function makeTrade(
  id: string,
  outcome: TradeOutcome | null,
  options: {
    openedAt?: number
    playbook?: 'A' | 'B'
    dayKey?: string
    stake?: number
    tieRefund?: boolean
  } = {},
): PaperTrade {
  const stake = options.stake ?? 10
  const tieRefund = options.tieRefund ?? true
  const openedAt = Math.floor((options.openedAt ?? Date.UTC(2026, 0, 15, 12, 0, 0)) / 1000)
  return {
    id,
    symbol: 'BTCUSDT',
    playbook: options.playbook ?? 'A',
    direction: 'UP',
    openedAt,
    entryPrice: 68_000,
    stake,
    payout: 0.85,
    tieRefund,
    expiryCandles: 1,
    expiresAt: openedAt + 300,
    closedAt: outcome === null ? null : openedAt + 300,
    exitPrice: outcome === null ? null : 68_100,
    outcome,
    pnl: outcome === null ? null : tradePnl(outcome, stake, 0.85, tieRefund),
    dayKey: options.dayKey ?? DAY,
    conditions: [{ label: 'Regime de tendência', met: true }],
    regime: 'TENDENCIA',
    indicators: {
      ema20: 68_000,
      ema50: 67_900,
      ema200: 67_500,
      atr: 120,
      adx: 31,
      rsi: 44,
      bandwidthPct: 55,
      slope: 0.6,
    },
  }
}

describe('tradePnl', () => {
  it('aplica payout, perda e regra de empate', () => {
    expect(tradePnl('WIN', 10, 0.85, true)).toBeCloseTo(8.5)
    expect(tradePnl('LOSS', 10, 0.85, true)).toBe(-10)
    expect(tradePnl('TIE', 10, 0.85, true)).toBe(0)
    expect(tradePnl('TIE', 10, 0.85, false)).toBe(-10)
  })
})

describe('computeStats', () => {
  it('consolida acertos, perdas, expectância, equity e drawdown', () => {
    const base = Date.UTC(2026, 0, 15, 12, 0, 0)
    const trades = [
      makeTrade('a', 'WIN', { openedAt: base }),
      makeTrade('b', 'LOSS', { openedAt: base + 300 }),
      makeTrade('c', 'WIN', { openedAt: base + 600 }),
      makeTrade('d', null, { openedAt: base + 900 }),
    ]

    const stats = computeStats(trades, 1000)

    expect(stats.total).toBe(4)
    expect(stats.closed).toBe(3)
    expect(stats.open).toBe(1)
    expect(stats.wins).toBe(2)
    expect(stats.losses).toBe(1)
    expect(stats.ties).toBe(0)
    expect(stats.winRate).toBeCloseTo((2 / 3) * 100)
    expect(stats.expectancy).toBeCloseTo((0.85 - 1 + 0.85) / 3)
    expect(stats.pnl).toBeCloseTo(7)
    expect(stats.equity).toBeCloseTo(1007)
    expect(stats.maxDrawdown).toBeCloseTo(10)
    expect(stats.openStake).toBe(10)
    expect(stats.equitySeries).toHaveLength(3)
    expect(stats.equitySeries[2].value).toBeCloseTo(1007)
  })

  it('trata empate reembolsado sem alterar a equity', () => {
    const trades = [makeTrade('a', 'TIE'), makeTrade('b', 'TIE', { openedAt: Date.UTC(2026, 0, 15, 12, 5, 0) })]
    const stats = computeStats(trades, 500)
    expect(stats.ties).toBe(2)
    expect(stats.winRate).toBe(0)
    expect(stats.pnl).toBe(0)
    expect(stats.equity).toBe(500)
    expect(stats.maxDrawdown).toBe(0)
  })

  it('separa o desempenho por playbook', () => {
    const trades = [
      makeTrade('a', 'WIN', { playbook: 'A' }),
      makeTrade('b', 'LOSS', { playbook: 'A', openedAt: Date.UTC(2026, 0, 15, 12, 5, 0) }),
      makeTrade('c', 'WIN', { playbook: 'B', openedAt: Date.UTC(2026, 0, 15, 12, 10, 0) }),
    ]
    const byPlaybook = statsByPlaybook(trades, 1000)
    expect(byPlaybook.A.closed).toBe(2)
    expect(byPlaybook.A.wins).toBe(1)
    expect(byPlaybook.A.pnl).toBeCloseTo(-1.5)
    expect(byPlaybook.B.closed).toBe(1)
    expect(byPlaybook.B.pnl).toBeCloseTo(8.5)
  })
})

describe('dayGate', () => {
  it('bloqueia stop e teto diário', () => {
    expect(dayGate([makeTrade('a', 'LOSS', { stake: 50 })], settings, DAY).allowed).toBe(false)
    expect(dayGate([makeTrade('a', 'WIN', { stake: 120 })], settings, DAY).allowed).toBe(false)
    expect(dayGate([makeTrade('a', 'LOSS', { stake: 40 })], settings, DAY).allowed).toBe(true)
    expect(dayGate([makeTrade('a', 'WIN', { stake: 100 })], settings, DAY).allowed).toBe(true)
  })

  it('considera apenas o dia informado', () => {
    const yesterday = makeTrade('a', 'LOSS', { stake: 50, dayKey: '2026-01-14' })
    expect(dayGate([yesterday], settings, DAY).allowed).toBe(true)
  })

  it('desativa limites zerados', () => {
    const unlimited = { ...settings, dailyStop: 0, dailyCap: 0 }
    expect(dayGate([makeTrade('a', 'LOSS', { stake: 1000 })], unlimited, DAY).allowed).toBe(true)
  })
})

describe('dailyStatus', () => {
  it('resume o dia UTC e o estado das entradas', () => {
    const timestamp = Date.UTC(2026, 0, 15, 18, 0, 0) / 1000
    const trades = [
      makeTrade('a', 'LOSS', { stake: 50 }),
      makeTrade('b', null, { openedAt: Date.UTC(2026, 0, 15, 18, 0, 0) }),
      makeTrade('c', 'WIN', { stake: 10, dayKey: '2026-01-14' }),
    ]
    const status = dailyStatus(trades, settings, timestamp)
    expect(status.dayKey).toBe(DAY)
    expect(status.realized).toBeCloseTo(-50)
    expect(status.closed).toBe(1)
    expect(status.open).toBe(1)
    expect(status.stopped).toBe(true)
    expect(status.allowed).toBe(false)

    expect(utcDayKey(timestamp)).toBe(DAY)
  })

  it('respeita o registro automático desligado', () => {
    const status = dailyStatus([], { ...settings, autoPaper: false }, Date.UTC(2026, 0, 15, 18) / 1000)
    expect(status.allowed).toBe(false)
    expect(status.stopped).toBe(false)
    expect(status.capped).toBe(false)
  })
})

describe('tradeFromRecord', () => {
  const record: SignalRecord = {
    id: 'BTCUSDT-1768000000',
    symbol: 'BTCUSDT',
    playbook: 'B',
    direction: 'DOWN',
    triggerTime: 1_768_000_000,
    triggerIndex: 300,
    entryTime: 1_768_000_300,
    entryPrice: 68_000,
    expiresAt: 1_768_000_900,
    outcome: 'WIN',
    exitPrice: 67_800,
    conditions: [{ label: 'RSI extremo', met: true }],
    regime: 'LATERAL',
    indicators: {
      ema20: 68_000,
      ema50: 67_950,
      ema200: 67_700,
      atr: 80,
      adx: 15,
      rsi: 28,
      bandwidthPct: 25,
      slope: 0.02,
    },
  }

  it('congela stake, payout e expiração no momento da entrada', () => {
    const trade = tradeFromRecord(record, { ...settings, stake: 25, payout: 0.9 }, DAY)
    expect(trade.id).toBe(record.id)
    expect(trade.stake).toBe(25)
    expect(trade.payout).toBe(0.9)
    expect(trade.expiryCandles).toBe(2)
    expect(trade.pnl).toBeCloseTo(22.5)
    expect(trade.closedAt).toBe(record.expiresAt)
    expect(trade.conditions).toEqual(record.conditions)
  })

  it('mantém operação aberta sem P&L', () => {
    const trade = tradeFromRecord({ ...record, outcome: null, exitPrice: null }, settings, DAY)
    expect(trade.outcome).toBeNull()
    expect(trade.pnl).toBeNull()
    expect(trade.closedAt).toBeNull()
  })
})

describe('tradesCsv', () => {
  it('exporta cabeçalho, resultado em português e quebra CRLF', () => {
    const base = Date.UTC(2026, 0, 15, 12, 0, 0)
    const csv = tradesCsv([
      makeTrade('a', 'WIN', { openedAt: base }),
      makeTrade('b', 'LOSS', { openedAt: base + 300 }),
      makeTrade('c', null, { openedAt: base + 600 }),
    ])

    const lines = csv.split('\r\n')
    expect(lines[0]).toContain('ativo;playbook;direcao')
    expect(lines[0]).toContain('condicoes')
    expect(lines[1]).toContain('ACERTO')
    expect(lines[2]).toContain('ERRO')
    expect(lines[3]).toContain('ABERTO')
    expect(lines[3]).toContain('BTCUSDT')
  })

  it('protege células com separador e aspas', () => {
    const trade = makeTrade('a', 'WIN')
    trade.conditions = [{ label: 'Regime; "teste"', met: true }]
    const csv = tradesCsv([trade])
    expect(csv.split('\r\n')[1]).toContain('"Regime; ""teste"": ok"')
  })
})
