import { useEffect, useMemo } from 'react'
import { ASSETS, TIMEFRAME_SECONDS, findAsset } from '../data/assets'
import {
  TICK_MS,
  aggregateCandles,
  currentFormingCandle,
  timeframeProgress,
} from '../data/simulator'
import { CHANGE_WINDOW, analyzeAsset, computeSessionStats } from '../engine/analysis'
import type { SetupTiming } from '../engine/strategy'
import { realChartCandles, useMarketStore } from '../store/marketStore'
import type { AssetAnalysis, Candle } from '../types/market'

const SCANNER_SETUP_TIMING: SetupTiming = {
  candleSeconds: TIMEFRAME_SECONDS['1m'],
  confirmationSeconds: TIMEFRAME_SECONDS['5m'],
}

export function useMarketClock(): void {
  const tick = useMarketStore((state) => state.tick)

  useEffect(() => {
    const interval = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(interval)
  }, [tick])
}

export function useScannerAnalyses(): Record<string, AssetAnalysis> {
  const feed = useMarketStore((state) => state.feed)
  const realSeries = useMarketStore((state) => state.realSeries)
  const simNowSec = useMarketStore((state) => state.simNowSec)
  const strategyConfig = useMarketStore((state) => state.strategyConfig)

  return useMemo(() => {
    const analyses: Record<string, AssetAnalysis> = {}

    for (const asset of ASSETS) {
      const realM1 = realChartCandles(realSeries, asset.symbol, '1m', simNowSec)
      const realM5 = realChartCandles(realSeries, asset.symbol, '5m', simNowSec)
      const hasRealSeries = realSeries[asset.symbol] !== undefined
      const simulated = feed.series[asset.symbol] ?? []
      const closedM1 = hasRealSeries
        ? (realM1?.closed ?? [])
        : aggregateCandles(simulated, TIMEFRAME_SECONDS['1m'])
      const closedM5 = hasRealSeries
        ? (realM5?.closed ?? [])
        : aggregateCandles(simulated, TIMEFRAME_SECONDS['5m'])
      const analysis = analyzeAsset(
        asset.symbol,
        closedM1,
        closedM5,
        null,
        strategyConfig,
        CHANGE_WINDOW,
        SCANNER_SETUP_TIMING,
      )

      analyses[asset.symbol] =
        hasRealSeries && (closedM1.length === 0 || closedM5.length === 0)
          ? {
              ...analysis,
              engineError: 'Aguardando candles fechados M1 e confirmação M5 do feed real.',
            }
          : analysis
    }

    return analyses
  }, [feed.series, realSeries, simNowSec, strategyConfig])
}

export function useMarketData() {
  const feed = useMarketStore((state) => state.feed)
  const simNowSec = useMarketStore((state) => state.simNowSec)
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol)
  const selectedTimeframe = useMarketStore((state) => state.selectedTimeframe)
  const analyses = useMarketStore((state) => state.analyses)
  const realSeries = useMarketStore((state) => state.realSeries)
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol)
  const clearAssetHistory = useMarketStore((state) => state.clearAssetHistory)
  const assetHistoryClearedAt = useMarketStore(
    (state) => state.assetHistoryClearedAt[selectedSymbol] ?? null,
  )
  const setSelectedTimeframe = useMarketStore((state) => state.setSelectedTimeframe)
  const devForcedSignal = useMarketStore((state) => state.devForcedSignal)
  const setDevForcedSignal = useMarketStore((state) => state.setDevForcedSignal)
  const strategyEngine = useMarketStore((state) => state.strategyEngine)

  const selected = analyses[selectedSymbol] ?? analyses[ASSETS[0].symbol]
  const assetHistory = selected.records.filter(
    (record) => assetHistoryClearedAt === null || record.entryTime > assetHistoryClearedAt,
  )
  const asset = findAsset(selectedSymbol)
  const timeframeSec = TIMEFRAME_SECONDS[selectedTimeframe]

  const closedChart = useMemo<Candle[]>(() => {
    const real = realChartCandles(realSeries, asset.symbol, selectedTimeframe, simNowSec)
    if (real !== null) return real.closed
    return aggregateCandles(feed.series[asset.symbol] ?? [], timeframeSec)
  }, [realSeries, asset.symbol, selectedTimeframe, simNowSec, feed, timeframeSec])

  const formingSignal = useMemo<Candle | null>(() => {
    const real = realChartCandles(realSeries, asset.symbol, '1m', simNowSec)
    if (real !== null) return real.forming
    return currentFormingCandle(asset, feed.series[asset.symbol] ?? [], '1m', simNowSec)
  }, [realSeries, asset, feed, simNowSec])

  const progress = timeframeProgress(simNowSec, selectedTimeframe)
  const sessionStats = useMemo(
    () => computeSessionStats(analyses, simNowSec - feed.anchorSec),
    [analyses, simNowSec, feed.anchorSec],
  )

  return {
    assets: ASSETS,
    analyses,
    realSeries,
    selected,
    assetHistory,
    asset,
    selectedSymbol,
    setSelectedSymbol,
    clearAssetHistory,
    selectedTimeframe,
    setSelectedTimeframe,
    devForcedSignal,
    setDevForcedSignal,
    strategyEngine,
    chart: { closed: closedChart, progress },
    formingSignal,
    progress,
    simNowSec,
    sessionStart: feed.anchorSec,
    sessionStats,
  }
}
