import { describe, expect, it } from 'vitest'
import { runBacktest } from './engine'
import type { Candle, EngineConfig } from './types'
import type { SetupModule } from './modules'

describe('fixed-expiry diagnostics', () => {
  it('keeps stake EV separate from directional R diagnostics', () => {
    const setupId = 'expiry-test'
    const candles: Candle[] = Array.from({ length: 60 }, (_, index) => {
      const open = 1 + index * 0.001
      return {
        time: Date.UTC(2026, 0, 5, 8) + index * 60_000,
        open,
        high: open + 0.0012,
        low: open - 0.0002,
        close: open + 0.001,
        volume: 100,
      }
    })
    const setup: SetupModule = {
      id: setupId,
      label: 'Expiry test',
      thesis: 'Validates independent expiry and R diagnostics.',
      evaluate(context) {
        if (context.index !== 10) return null
        return {
          moduleId: setupId,
          direction: 'long',
          reference: context.candle.close,
          stop: context.candle.close - 0.01,
          target: context.candle.close + 0.02,
          expiryCandles: 1,
          bucket: setupId,
          reasons: [],
          confidence: 1,
        }
      },
    }
    const config: EngineConfig = {
      timeframeMinutes: 1,
      mode: 'expiry',
      expiryOverrideCandles: 1,
      session: {
        utcOffsetMinutes: 0,
        openMinute: 0,
        closeMinute: 1439,
        openingRangeMinutes: 30,
        noEntryAfterOpenMinutes: 0,
        noEntryBeforeCloseMinutes: 0,
        lookbackSessions: 1,
      },
      minTradesPerBucket: 10,
      edgeMargin: 0.03,
      payoutRatio: 0.85,
      costPerTrade: 0,
      riskPerTradePct: 0.01,
      maxSignalsPerDay: 10,
      cooldownCandlesAfterLoss: 2,
      pauseAfterConsecutiveLosses: 2,
      pauseMinutes: 30,
    }

    const report = runBacktest(candles, config, { modules: [setup] })
    expect(report.shadowTrades).toHaveLength(1)
    expect(report.shadowTrades[0]?.expiryOutcome).toBe('win')
    expect(report.shadowTrades[0]?.evPerStake).toBe(0.85)
    expect(report.shadowTrades[0]?.rMultiple).toBeCloseTo(0.1, 8)
  })

  it('does not train the next session on a trade that has not settled yet', () => {
    const candles: Candle[] = Array.from({ length: 2_890 }, (_, index) => {
      const open = 1 + index * 0.0001
      return {
        time: Date.UTC(2026, 0, 5) + index * 60_000,
        open,
        high: open + 0.0002,
        low: open - 0.0002,
        close: open + 0.0001,
        volume: 100,
      }
    })
    const setup: SetupModule = {
      id: 'walk-forward-test',
      label: 'Walk-forward test',
      thesis: 'Only resolved outcomes may train the next session.',
      evaluate(context) {
        const trainingIndex =
          context.index >= 60 && context.index <= 600 && context.index % 60 === 0
        if (!trainingIndex && context.index !== 1_437 && context.index !== 1_450) {
          return null
        }
        return {
          moduleId: this.id,
          direction: 'long',
          reference: context.candle.close,
          stop: context.candle.close - 0.1,
          target: context.candle.close + 0.2,
          expiryCandles: 1,
          bucket: 'walk-forward-test',
          reasons: [],
          confidence: 1,
        }
      },
    }
    const config: EngineConfig = {
      timeframeMinutes: 1,
      mode: 'expiry',
      expiryOverrideCandles: 5,
      session: {
        utcOffsetMinutes: 0,
        openMinute: 0,
        closeMinute: 1_439,
        openingRangeMinutes: 30,
        noEntryAfterOpenMinutes: 0,
        noEntryBeforeCloseMinutes: 0,
        lookbackSessions: 1,
      },
      minTradesPerBucket: 11,
      edgeMargin: 0,
      payoutRatio: 0.85,
      costPerTrade: 0,
      riskPerTradePct: 0.01,
      maxSignalsPerDay: 100,
      cooldownCandlesAfterLoss: 0,
      pauseAfterConsecutiveLosses: 100,
      pauseMinutes: 0,
    }

    const report = runBacktest(candles, config, { modules: [setup] })

    expect(report.shadowTrades).toHaveLength(12)
    expect(report.signals).toHaveLength(0)
    expect(report.blockReasons.some(({ reason }) => reason.includes('amostra insuficiente'))).toBe(true)
  })
})
