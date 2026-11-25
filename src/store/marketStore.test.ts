import { afterEach, describe, expect, it } from 'vitest'
import { parseMessage } from '../hooks/useLiveBot'
import { realChartCandles, useMarketStore } from './marketStore'
import { DEFAULT_SETTINGS } from '../types/trading'

const initialMarketState = useMarketStore.getState()

describe('market asset history', () => {
  afterEach(() => {
    useMarketStore.setState({
      selectedSymbol: initialMarketState.selectedSymbol,
      selectedTimeframe: initialMarketState.selectedTimeframe,
      simNowSec: initialMarketState.simNowSec,
      assetHistoryClearedAt: initialMarketState.assetHistoryClearedAt,
      devForcedSignal: initialMarketState.devForcedSignal,
      strategyEngine: initialMarketState.strategyEngine,
      sweepReclaimOnly: initialMarketState.sweepReclaimOnly,
      nextEngineConfig: initialMarketState.nextEngineConfig,
      costCalibrated: initialMarketState.costCalibrated,
    })
  })

  describe('candles reais fechados', () => {
    it('exclui do sinal e do gráfico o candle M1 ainda em formação no payload', () => {
      const symbol = 'EURUSD'
      const count = 300
      const firstTime = Math.floor(Date.now() / 60_000) * 60 - (count - 1) * 60
      const candles = Array.from({ length: count }, (_, index) => {
        const time = firstTime + index * 60
        return index === count - 1
          ? { time, open: 1, high: 1, low: 0.88, close: 0.9, volume: 0.01 }
          : { time, open: 1, high: 1, low: 1, close: 1, volume: 1 }
      })
      const formingTime = candles[count - 1].time
      const timestamp = formingTime + 30
      const message = parseMessage({
        type: 'real_candles',
        asset: symbol,
        timeframe: 'M1',
        candles,
        timestamp,
      })
      expect(message?.type).toBe('real_candles')
      if (message?.type !== 'real_candles') throw new Error('Payload real de candles não reconhecido.')

      const previous = useMarketStore.getState()
      try {
        useMarketStore.setState({
          realSeries: {},
          realClock: null,
          simNowSec: timestamp,
          strategyEngine: 'legacy',
          devForcedSignal: false,
        })
        useMarketStore.getState().applyRealCandles(
          message.asset,
          message.timeframe,
          message.candles,
          message.timestamp,
        )

        const analysis = useMarketStore.getState().analyses[symbol]
        const chartCandles = realChartCandles(
          useMarketStore.getState().realSeries,
          symbol,
          '1m',
          timestamp,
        )

        expect(analysis.closed[analysis.closed.length - 1]?.time).not.toBe(formingTime)
        expect(analysis.lastClosedTime).not.toBe(formingTime)
        expect(analysis.signal.triggerTime).not.toBe(formingTime)
        expect(chartCandles?.closed).toHaveLength(count - 1)
        expect(chartCandles?.forming?.time).toBe(formingTime)

        const analysisCandles = useMarketStore.getState().analyses[symbol].closed
        expect(analysisCandles.length).toBeLessThan(count - 1)
        expect(
          analysisCandles[analysisCandles.length - 1].time -
            analysisCandles[analysisCandles.length - 2].time,
        ).toBe(300)
      } finally {
        useMarketStore.setState({
          realSeries: previous.realSeries,
          realClock: previous.realClock,
          simNowSec: previous.simNowSec,
          strategyEngine: previous.strategyEngine,
          devForcedSignal: previous.devForcedSignal,
          analyses: previous.analyses,
        })
      }
    })
  })

  it('clears history for the selected asset at the current simulated time', () => {
    useMarketStore.setState({
      selectedSymbol: 'EURUSD-OTC',
      simNowSec: 123_456,
    })

    useMarketStore.getState().clearAssetHistory()

    expect(useMarketStore.getState().assetHistoryClearedAt).toEqual({
      'EURUSD-OTC': 123_456,
    })
  })

  it('forces one signal from the selected timeframe only when the test flag is enabled', () => {
    const previous = useMarketStore.getState()
    const candles = Array.from({ length: 5 }, (_, index) => ({
      time: 300 + index * 60,
      open: 1,
      high: 1.1,
      low: 0.99,
      close: 1.1,
      volume: 1,
    }))

    try {
      useMarketStore.setState({
        selectedSymbol: 'EURUSD',
        selectedTimeframe: '5m',
        devForcedSignal: false,
        simNowSec: 900,
        realClock: null,
        realSeries: {
          EURUSD: { M1: candles },
          GBPUSD: { M1: candles.map((candle) => ({ ...candle, time: candle.time + 300 })) },
        },
      })
      useMarketStore.getState().setDevForcedSignal(true)

      expect(useMarketStore.getState().analyses.EURUSD.signal).toMatchObject({
        phase: 'ENTRAR',
        direction: 'UP',
        triggerTime: 300,
      })

      useMarketStore.getState().setSelectedSymbol('GBPUSD')
      expect(useMarketStore.getState().analyses.GBPUSD.signal).toMatchObject({
        phase: 'ENTRAR',
        direction: 'UP',
        triggerTime: 600,
      })

      useMarketStore.getState().setDevForcedSignal(false)

      expect(useMarketStore.getState().analyses.EURUSD.signal.phase).not.toBe('ENTRAR')
    } finally {
      useMarketStore.setState({
        selectedSymbol: previous.selectedSymbol,
        selectedTimeframe: previous.selectedTimeframe,
        devForcedSignal: previous.devForcedSignal,
        simNowSec: previous.simNowSec,
        realClock: previous.realClock,
        realSeries: previous.realSeries,
        analyses: previous.analyses,
      })
    }
  })

  it('isolates Sweep & Reclaim and restores the existing engine unchanged when disabled', () => {
    const previous = useMarketStore.getState()
    const candles = Array.from({ length: 81 }, (_, index) => {
      const time = (index + 1) * 60
      return index < 80
        ? { time, open: 100, high: 101, low: 99, close: 100, volume: 1 }
        : { time, open: 99.8, high: 100.1, low: 98.5, close: 100.05, volume: 1 }
    })
    try {
      useMarketStore.setState({
        selectedSymbol: 'EURUSD',
        simNowSec: 82 * 60,
        realClock: null,
        realSeries: { EURUSD: { M1: candles } },
        strategyEngine: 'next',
        sweepReclaimOnly: false,
        devForcedSignal: false,
      })
      const engineSettings = {
        ...DEFAULT_SETTINGS,
        strategyEngine: 'next' as const,
      }

      useMarketStore.getState().setEngineSettings({
        ...engineSettings,
        sweepReclaimOnly: false,
      })
      const existingAnalysis = useMarketStore.getState().analyses.EURUSD
      const existingEngineConfig = useMarketStore.getState().nextEngineConfig
      const existingStrategyConfig = useMarketStore.getState().strategyConfig
      expect(existingAnalysis.nextEvaluation).not.toBeNull()

      useMarketStore.getState().setEngineSettings({
        ...engineSettings,
        sweepReclaimOnly: true,
      })
      const isolated = useMarketStore.getState().analyses.EURUSD
      expect(isolated.signal).toMatchObject({
        phase: 'ENTRAR',
        direction: 'UP',
        triggerTime: 81 * 60,
      })
      expect(isolated.nextEvaluation).toBeNull()
      expect(isolated.records).toEqual([])
      expect(useMarketStore.getState().nextEngineConfig).toEqual(existingEngineConfig)
      expect(useMarketStore.getState().strategyConfig).toEqual(existingStrategyConfig)

      useMarketStore.getState().setEngineSettings({
        ...engineSettings,
        sweepReclaimOnly: false,
      })
      expect(useMarketStore.getState().analyses.EURUSD.signal).toEqual(
        existingAnalysis.signal,
      )
      expect(useMarketStore.getState().analyses.EURUSD.nextEvaluation).toEqual(
        existingAnalysis.nextEvaluation,
      )
    } finally {
      useMarketStore.setState(previous)
    }
  })
})
