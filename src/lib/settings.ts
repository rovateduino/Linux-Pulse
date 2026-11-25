import type { StrategyConfig } from '../engine/strategy'
import type { EngineConfig } from '../engine/next'
import type { AppSettings } from '../types/trading'

export function strategyConfigFromSettings(settings: AppSettings): StrategyConfig {
  return {
    expiryCandles: settings.expiryCandles,
    spacingCandles: settings.spacingCandles,
    pauseAfterLosses: settings.pauseAfterLosses,
    pauseMinutes: settings.pauseMinutes,
  }
}

export function nextEngineConfigFromSettings(
  settings: AppSettings,
  timeframeMinutes = 1,
): EngineConfig {
  return {
    timeframeMinutes,
    mode: 'expiry',
    expiryOverrideCandles: 1,
    expiryDrawPolicy: settings.tieRefund ? 'refund' : 'loss',
    session: {
      utcOffsetMinutes: settings.utcOffsetMinutes,
      openMinute: settings.sessionOpenMinute,
      closeMinute: settings.sessionCloseMinute,
      openingRangeMinutes: settings.openingRangeMinutes,
      noEntryAfterOpenMinutes: settings.noEntryAfterOpenMinutes,
      noEntryBeforeCloseMinutes: settings.noEntryBeforeCloseMinutes,
      lookbackSessions: settings.lookbackSessions,
    },
    minTradesPerBucket: settings.minTradesPerBucket,
    edgeMargin: settings.edgeMargin,
    payoutRatio: settings.payout,
    costPerTrade: settings.costPerTrade,
    riskPerTradePct: 0.01,
    maxSignalsPerDay: settings.maxSignalsPerDay,
    cooldownCandlesAfterLoss: settings.spacingCandles,
    pauseAfterConsecutiveLosses: settings.pauseAfterLosses,
    pauseMinutes: settings.pauseMinutes,
  }
}
