import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Candle } from '../types/market'
import type { PlaybookSignal } from '../engine/playbooks/types'
import type { PlaybookDLiveTrade } from '../engine/playbooks/liveD'
import { usePlaybookDStore } from './playbookDStore'

const mocks = vi.hoisted(() => ({ evaluateD: vi.fn() }))
vi.mock('../engine/playbooks', () => ({ PLAYBOOKS: { D: mocks.evaluateD } }))

const TF = 900
const T0 = Date.UTC(2026, 0, 5, 8, 0, 0)

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 1 }
}

function series(count: number, closeAt: (k: number) => number): Candle[] {
  return Array.from({ length: count }, (_, k) => {
    const close = closeAt(k)
    return candle(T0 + k * TF, close, close + 0.0001, close - 0.0001, close)
  })
}

function signal(direction: 'UP' | 'DOWN'): PlaybookSignal {
  return {
    playbook: 'D',
    direction,
    conditions: [],
    exits: { takeProfitAtr: 0.8, stopLossAtr: 0.8 },
  }
}

function portfolio(trades: readonly PlaybookDLiveTrade[]) {
  const settled = trades.filter((trade) => trade.outcome !== undefined)
  return {
    n: settled.length,
    wins: settled.filter((trade) => trade.outcome === 'WIN').length,
  }
}

function reset() {
  usePlaybookDStore.setState({ trades: [], evaluatedSignalTime: {}, hydrated: false })
  mocks.evaluateD.mockReset()
}

describe('playbookDStore · shadow ao vivo', () => {
  beforeEach(reset)

  it('abre trade shadow no candle fechado e liquida no M15 seguinte', () => {
    const candles = series(3, (k) => 1.1 + k * 0.001)
    // Sinal apenas no candle k=1; k=2 não gera novo setup.
    mocks.evaluateD.mockImplementation((_c: Candle[], index: number) =>
      index === 1 ? signal('UP') : null,
    )

    // k=1 acabou de fechar (nowSec = seu fechamento).
    usePlaybookDStore.getState().ingest('EURUSD-OTC', candles.slice(0, 2), T0 + 2 * TF)
    let trades = usePlaybookDStore.getState().trades
    expect(trades).toHaveLength(1)
    expect(trades[0].outcome).toBeUndefined()
    expect(trades[0].entryPrice).toBe(candles[1].close)

    // k=2 fecha: liquida com o close do candle seguinte (k=2).
    usePlaybookDStore.getState().ingest('EURUSD-OTC', candles, T0 + 3 * TF)
    trades = usePlaybookDStore.getState().trades
    expect(trades).toHaveLength(1)
    expect(trades[0].outcome).toBe('WIN') // close subiu → UP ganha
    expect(trades[0].exitPrice).toBe(candles[2].close)
    expect(portfolio(trades)).toEqual({ n: 1, wins: 1 })
  })

  it('agrega o portfólio somando trades de todos os ativos', () => {
    mocks.evaluateD.mockReturnValue(signal('UP'))
    const up = series(3, (k) => 1.1 + k * 0.001)
    const down = series(3, (k) => 1.1 - k * 0.001)

    usePlaybookDStore.getState().ingest('EURUSD-OTC', up.slice(0, 2), T0 + 2 * TF)
    usePlaybookDStore.getState().ingest('GBPUSD-OTC', down.slice(0, 2), T0 + 2 * TF)
    usePlaybookDStore.getState().ingest('EURUSD-OTC', up, T0 + 3 * TF)
    usePlaybookDStore.getState().ingest('GBPUSD-OTC', down, T0 + 3 * TF)

    const stats = portfolio(usePlaybookDStore.getState().trades)
    expect(stats).toEqual({ n: 2, wins: 1 }) // EURUSD WIN, GBPUSD LOSS
  })

  it('não duplica sinal ao reprocessar o mesmo candle', () => {
    const candles = series(2, () => 1.1)
    mocks.evaluateD.mockReturnValue(signal('DOWN'))
    const store = usePlaybookDStore.getState()
    store.ingest('EURUSD-OTC', candles, T0 + 2 * TF)
    store.ingest('EURUSD-OTC', candles, T0 + 2 * TF + 30)
    expect(usePlaybookDStore.getState().trades).toHaveLength(1)
  })

  it('não abre trade quando evaluateD retorna null', () => {
    mocks.evaluateD.mockReturnValue(null)
    const candles = series(2, () => 1.1)
    usePlaybookDStore.getState().ingest('EURUSD-OTC', candles, T0 + 2 * TF)
    expect(usePlaybookDStore.getState().trades).toHaveLength(0)
    expect(mocks.evaluateD).toHaveBeenCalledTimes(1)
  })

  it('ignora o candle em formação (sem look-ahead)', () => {
    const candles = series(2, () => 1.1)
    mocks.evaluateD.mockReturnValue(null)
    // k=1 ainda está em formação (fecha em T0+2*TF); só k=0 é elegível.
    usePlaybookDStore.getState().ingest('EURUSD-OTC', candles, T0 + TF + 100)
    expect(mocks.evaluateD).toHaveBeenCalledTimes(1)
    expect(mocks.evaluateD.mock.calls[0][1]).toBe(0)
  })

  it('não gera sinal zumbi quando o último fechado é antigo', () => {
    const candles = series(2, () => 1.1)
    mocks.evaluateD.mockReturnValue(signal('UP'))
    // nowSec muito depois do fechamento de k=1 (> 1 vela de defasagem).
    usePlaybookDStore.getState().ingest('EURUSD-OTC', candles, T0 + 10 * TF)
    expect(mocks.evaluateD).not.toHaveBeenCalled()
  })
})
