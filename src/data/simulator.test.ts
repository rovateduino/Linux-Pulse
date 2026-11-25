import { describe, expect, it } from 'vitest'
import {
  PREFILL_M1,
  RETENTION_M1,
  advanceSimFeed,
  aggregateCandles,
  chartCandles,
  createSimFeed,
  currentFormingCandle,
  generateM1,
  simNowSeconds,
  timeframeProgress,
} from './simulator'
import {
  ASSETS,
  BINANCE_ASSETS,
  DEFAULT_SYMBOL,
  IQ_OPTION_ASSETS,
  LAB_DEFAULT_SYMBOL,
  LAB_SYMBOLS,
  SIMULATED_SYMBOL,
} from './assets'
import type { Candle } from '../types/market'

function sampleCandle(index: number): Candle {
  const open = 10 + index
  const close = open + (index % 2 === 0 ? 0.5 : -0.5)
  return {
    time: index * 60,
    open,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    close,
    volume: 1,
  }
}

describe('generateM1', () => {
  it('usa os trinta e dois símbolos IQ Option configurados como ativos do terminal', () => {
    const symbols = [
      'EURUSD-OTC',
      'GBPUSD-OTC',
      'USDJPY-OTC',
      'AUDUSD-OTC',
      'USDCAD-OTC',
      'NZDUSD-OTC',
      'EURGBP-OTC',
      'AUDCAD-OTC',
      'EURUSD',
      'GBPUSD',
      'USDJPY',
      'AUDUSD',
      'USDCAD',
      'NZDUSD',
      'EURGBP',
      'AUDCAD',
      'USDCHF',
      'EURJPY',
      'GBPJPY',
      'EURAUD',
      'EURCAD',
      'EURCHF',
      'GBPAUD',
      'GBPCAD',
      'GBPCHF',
      'AUDJPY',
      'AUDCHF',
      'CADJPY',
      'CADCHF',
      'CHFJPY',
      'NZDJPY',
      'NZDCAD',
    ]

    expect(ASSETS.map((asset) => asset.symbol)).toEqual(symbols)
    expect(new Set(ASSETS.map((asset) => asset.symbol)).size).toBe(32)
    expect(DEFAULT_SYMBOL).toBe('EURUSD')
    expect(IQ_OPTION_ASSETS.find((asset) => asset.symbol === 'EURUSD')).toBeDefined()
    expect(IQ_OPTION_ASSETS.find((asset) => asset.symbol === 'EURUSD-OTC')).toBeDefined()
  })

  it('mantém o universo Binance e o ativo inicial do Laboratório', () => {
    expect(LAB_SYMBOLS).toEqual([
      ...BINANCE_ASSETS.map((asset) => asset.symbol),
      SIMULATED_SYMBOL,
    ])
    expect(LAB_DEFAULT_SYMBOL).toBe('BTCUSDT')
  })

  it('é determinístico para a mesma semente e janela', () => {
    const first = generateM1(ASSETS[0], 2_000_000, 50)
    const second = generateM1(ASSETS[0], 2_000_000, 50)
    expect(first).toEqual(second)
  })

  it('gera candles coerentes e alinhados ao minuto UTC', () => {
    const candles = generateM1(ASSETS[1], 1_000_000, 120)
    for (const candle of candles) {
      expect(candle.time % 60).toBe(0)
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close))
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close))
      expect(candle.low).toBeGreaterThan(0)
      expect(candle.volume).toBeGreaterThan(0)
    }
    expect(candles[1].time - candles[0].time).toBe(60)
  })

  it('arredonda OHLC segundo a precisão configurada para cada ativo', () => {
    for (const asset of ASSETS) {
      const candles = generateM1(asset, 1_000_000, 120)
      for (const candle of candles) {
        expect(candle.open).toBe(Number(candle.open.toFixed(asset.decimals)))
        expect(candle.high).toBe(Number(candle.high.toFixed(asset.decimals)))
        expect(candle.low).toBe(Number(candle.low.toFixed(asset.decimals)))
        expect(candle.close).toBe(Number(candle.close.toFixed(asset.decimals)))
      }
    }
  })
})

describe('aggregateCandles', () => {
  it('agrega OHLC e volume por bucket', () => {
    const candles = Array.from({ length: 15 }, (_, index) => sampleCandle(index))
    const aggregated = aggregateCandles(candles, 300)

    expect(aggregated).toHaveLength(3)
    expect(aggregated[0].time).toBe(0)
    expect(aggregated[1].time).toBe(300)
    expect(aggregated[0].open).toBe(candles[0].open)
    expect(aggregated[0].close).toBe(candles[4].close)
    expect(aggregated[0].high).toBe(Math.max(...candles.slice(0, 5).map((item) => item.high)))
    expect(aggregated[0].low).toBe(Math.min(...candles.slice(0, 5).map((item) => item.low)))
    expect(aggregated[0].volume).toBe(5)
  })

  it('não publica bucket incompleto como candle fechado', () => {
    const candles = Array.from({ length: 13 }, (_, index) => sampleCandle(index))
    const aggregated = aggregateCandles(candles, 300)
    expect(aggregated).toHaveLength(2)
    expect(aggregated[aggregated.length - 1].time).toBe(300)
  })
})

describe('feed simulado', () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 30)

  it('pré-carrega o histórico e fecha velas conforme o relógio acelera', () => {
    const feed = createSimFeed(now, [ASSETS[0]])
    expect(feed.series[ASSETS[0].symbol]).toHaveLength(PREFILL_M1)

    const simNow = simNowSeconds(feed, now + 2_000)
    const advanced = advanceSimFeed(feed, simNow, [ASSETS[0]])
    expect(advanced.lastClosedMinute).toBe(feed.lastClosedMinute + 1)
    expect(advanced.series[ASSETS[0].symbol]).toHaveLength(PREFILL_M1 + 1)

    const idempotent = advanceSimFeed(advanced, simNow, [ASSETS[0]])
    expect(idempotent).toBe(advanced)
  })

  it('limita o histórico retido sem quebrar a continuidade', () => {
    const feed = createSimFeed(now, [ASSETS[0]])
    const far = feed.anchorSec + 6_000 * 60
    const advanced = advanceSimFeed(feed, far, [ASSETS[0]])
    const series = advanced.series[ASSETS[0].symbol]

    expect(series).toHaveLength(RETENTION_M1)
    expect(series[series.length - 1].time).toBe((feed.lastClosedMinute + 1 + 5_999) * 60)
  })

  it('mantém a janela retida e o candle em formação coerente', () => {
    const feed = createSimFeed(now, [ASSETS[2]])
    const simNow = simNowSeconds(feed, now + 5_000)
    const advanced = advanceSimFeed(feed, simNow, [ASSETS[2]])
    const forming = currentFormingCandle(ASSETS[2], advanced.series[ASSETS[2].symbol], '5m', simNow)

    expect(forming).not.toBeNull()
    expect(forming!.time % 300).toBe(0)
    expect(forming!.high).toBeGreaterThanOrEqual(Math.max(forming!.open, forming!.close))
    expect(forming!.low).toBeLessThanOrEqual(Math.min(forming!.open, forming!.close))

    const chart = chartCandles(ASSETS[2], advanced, '5m', simNow)
    expect(chart.closed.length).toBeGreaterThan(0)
    expect(chart.forming).not.toBeNull()
    expect(chart.closed[chart.closed.length - 1].time).toBeLessThan(chart.forming!.time)
  })
})

describe('timeframeProgress', () => {
  it('calcula progresso e segundos restantes até o fechamento', () => {
    expect(timeframeProgress(450, '5m')).toEqual({ progress: 0.5, secondsLeft: 150 })
    expect(timeframeProgress(299, '5m')).toEqual({ progress: 299 / 300, secondsLeft: 1 })
    expect(timeframeProgress(900, '15m')).toEqual({ progress: 0, secondsLeft: 900 })
  })
})
