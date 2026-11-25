import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_ORDERS_PER_HOUR,
  ORDER_RATE_WINDOW_MS,
  datasetStepError,
  recentOrderTimestamps,
  useLabStore,
} from './labStore'
import type {
  BacktestMetrics,
  BacktestResult,
  LabRunInfo,
} from '../types/lab'
import type { Candle } from '../types/market'

const initialState = useLabStore.getState()
const symbol = initialState.config.symbol
const candles: Candle[] = [
  { time: 300, open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 10 },
  { time: 600, open: 1.05, high: 1.15, low: 1, close: 1.1, volume: 12 },
]

const emptyMetrics: BacktestMetrics = {
  n: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  winRate: 0,
  low: 0,
  high: 0,
  breakeven: 0,
  expectancy: 0,
  pnlUsd: 0,
  maxDrawdown: 0,
  equity: [],
}

const staleResult: BacktestResult = {
  comboId: 'stale-result',
  symbol,
  timeframe: '5m',
  playbook: 'A',
  splits: [],
  train: emptyMetrics,
  validation: emptyMetrics,
  test: emptyMetrics,
  overall: emptyMetrics,
  gate: {
    status: 'INCONCLUSIVO',
    reason: 'test fixture',
    n: 0,
    wins: 0,
    winRate: 0,
    low: 0,
    high: 0,
    breakeven: 0,
  },
  trades: [],
}

const staleRunInfo: LabRunInfo = {
  symbol,
  timeframe: '5m',
  source: 'bot',
  generatedAt: 1,
  trades: 0,
  playbookId: 'A',
  split: [],
  sessionsUsed: [],
  pctCandlesFiltrados: 0,
}

afterEach(() => {
  useLabStore.setState({
    customAssetName: initialState.customAssetName,
    datasets: initialState.datasets,
    phase: initialState.phase,
    progress: initialState.progress,
    results: initialState.results,
    baselines: initialState.baselines,
    runInfo: initialState.runInfo,
    sentOrdersTimestamps: initialState.sentOrdersTimestamps,
    rateLimitBlockedAt: initialState.rateLimitBlockedAt,
  })
})

describe('lab dataset clearing', () => {
  it('uses the declared timeframe to report gaps without rejecting sparse M5 data', () => {
    const sparseCandles: Candle[] = [
      { time: 300, open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 10 },
      { time: 900, open: 1.05, high: 1.15, low: 1, close: 1.1, volume: 12 },
      { time: 1500, open: 1.1, high: 1.2, low: 1.05, close: 1.15, volume: 11 },
      { time: 1800, open: 1.15, high: 1.25, low: 1.1, close: 1.2, volume: 9 },
    ]

    useLabStore.getState().importCsvCandles(symbol, sparseCandles, '5m')

    const datasetState = useLabStore.getState().datasets[symbol]
    expect(datasetState?.status).toBe('ready')
    if (datasetState?.status !== 'ready') throw new Error('CSV não foi importado.')
    expect(datasetState.dataset.timeframe).toBe('5m')
    expect(datasetState.dataset.gaps).toBe(2)
    expect(datasetStepError(sparseCandles, '5m', '5m')).toBeNull()
    expect(datasetStepError(sparseCandles, '1m', '5m')).toContain('declara M5')
  })

  it('clears the imported CSV dataset and prior result metadata', () => {
    useLabStore.getState().importCsvCandles(symbol, candles, '5m')
    useLabStore.setState({ results: [staleResult], runInfo: staleRunInfo })

    useLabStore.getState().clearDataset()

    const state = useLabStore.getState()
    expect(state.datasets[symbol]).toEqual({ status: 'idle' })
    expect(state.results).toEqual([])
    expect(state.runInfo).toBeNull()
  })

  it('is idempotent when the current dataset is already idle', () => {
    useLabStore.setState({ datasets: {} })

    expect(() => {
      useLabStore.getState().clearDataset()
      useLabStore.getState().clearDataset()
    }).not.toThrow()

    expect(useLabStore.getState().datasets[symbol]).toEqual({ status: 'idle' })
  })
})

describe('trava de segurança global de ordens por hora', () => {
  const now = 1_700_000_000_000

  it('descarta apenas os timestamps mais antigos que a janela de 1 hora', () => {
    const expired = now - ORDER_RATE_WINDOW_MS - 1
    const onTheEdge = now - ORDER_RATE_WINDOW_MS + 1
    const fresh = now - 1_000

    expect(recentOrderTimestamps([expired, onTheEdge, fresh], now)).toEqual([
      onTheEdge,
      fresh,
    ])
  })

  it('bloqueia o envio assim que a janela atinge o limite configurado', () => {
    const atLimit = Array.from(
      { length: MAX_ORDERS_PER_HOUR },
      (_, index) => now - index * 1_000,
    )

    expect(recentOrderTimestamps(atLimit, now)).toHaveLength(MAX_ORDERS_PER_HOUR)
    expect(
      recentOrderTimestamps(atLimit, now).length >= MAX_ORDERS_PER_HOUR,
    ).toBe(true)

    const belowLimit = atLimit.slice(1)
    expect(
      recentOrderTimestamps(belowLimit, now).length >= MAX_ORDERS_PER_HOUR,
    ).toBe(false)
  })

  it('registra o novo timestamp preservando a janela móvel no store', () => {
    const expired = now - ORDER_RATE_WINDOW_MS - 1
    useLabStore.setState({ sentOrdersTimestamps: [expired, now - 1_000] })

    const recent = recentOrderTimestamps(useLabStore.getState().sentOrdersTimestamps, now)
    useLabStore.getState().setSentOrdersTimestamps([...recent, now])

    expect(useLabStore.getState().sentOrdersTimestamps).toEqual([now - 1_000, now])
  })
})
