import { describe, expect, it, vi } from 'vitest'
import type { SetupEvaluation } from '../strategy'

vi.mock('../strategy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../strategy')>()
  return { ...actual, evaluateSetup: vi.fn() }
})

import { runBacktest } from '../backtest'
import { evaluateSetup } from '../strategy'
import type { Candle } from '../../types/market'
import type { RunBacktestInput } from '../../types/lab'

describe('backtest settlement timing', () => {
  it('does not apply an outcome before its expiry candle has closed', () => {
    const candles: Candle[] = Array.from({ length: 260 }, (_, index) => {
      const time = Date.UTC(2026, 0, 5) + index * 300_000
      const close = index === 223 ? 0.9 : 1.001
      return {
        time,
        open: 1,
        high: Math.max(1.002, close),
        low: Math.min(0.999, close),
        close,
        volume: 100,
      }
    })
    const input: RunBacktestInput = {
      symbol: 'EURUSD',
      timeframe: '5m',
      confirmation: '15m',
      payout: 0.85,
      expiryCandles: 3,
      m5Candles: candles,
      playbooks: ['A'],
      strategy: {
        expiryCandles: 3,
        spacingCandles: 1,
        pauseAfterLosses: 1,
        pauseMinutes: 30,
      },
      // Cobre o dia inteiro: este teste valida liquidação, não o filtro de sessão.
      sessions: [
        { name: 'london', startUtc: '00:00', endUtc: '12:00' },
        { name: 'ny', startUtc: '12:00', endUtc: '00:00' },
      ],
    }

    vi.mocked(evaluateSetup).mockImplementation((prepared, _confirmation, index) => {
      const ready = index === 220 || index === 221
      return {
        playbook: ready ? 'A' : null,
        direction: ready ? 'UP' : null,
        conditions: [],
        blockedBy: [],
        phase: ready ? 'ENTRAR' : 'OBSERVANDO',
        ready,
        regime: 'TENDENCIA',
        indicators: {
          ema20: null,
          ema50: null,
          ema200: null,
          atr: null,
          adx: null,
          rsi: null,
          bandwidthPct: null,
          slope: null,
        },
        triggerTime: ready ? prepared.candles[index].time : null,
      } satisfies SetupEvaluation
    })

    const result = runBacktest(input)
    const trades = result.results.flatMap((entry) => entry.trades)

    expect(trades.map((trade) => trade.triggerIndex)).toEqual([220, 221])
    expect(trades[0]?.outcome).toBe('LOSS')
  })
})
