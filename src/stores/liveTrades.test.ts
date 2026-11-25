import { describe, expect, it } from 'vitest'
import { useLabStore } from './labStore'
import { useJournalStore } from '../store/journalStore'
import { useMarketStore } from '../store/marketStore'
import type { AssetAnalysis, SignalRecord } from '../types/market'

function analysisWithRecord(record: SignalRecord): AssetAnalysis {
  const indicators = {
    ema20: null,
    ema50: null,
    ema200: null,
    atr: null,
    adx: null,
    rsi: null,
    bandwidthPct: null,
    slope: null,
  }
  return {
    symbol: record.symbol,
    closed: [],
    regime: {
      kind: 'SEM_REGIME',
      direction: null,
      adx: null,
      slope: null,
      bandwidthPct: null,
      emaAligned: false,
      ema20: null,
      ema50: null,
      ema200: null,
    },
    signal: {
      phase: 'RESULTADO',
      direction: null,
      playbook: null,
      conditions: [],
      blockedBy: [],
      note: '',
      triggerTime: null,
      active: null,
      lastResult: record,
      pausedUntil: null,
    },
    indicators,
    records: [record],
    changePct: 0,
    changeWindow: 1,
    lastClosedTime: null,
  }
}

describe('live bot trade state', () => {
  it('updates an opened trade with its matching result', () => {
    const store = useLabStore.getState()
    const tradeId = `store-test-${Date.now()}`

    store.addLiveTrade({
      type: 'trade_open',
      trade_id: tradeId,
      asset: 'EURUSD',
      direction: 'CALL',
      amount: 10,
      entry_price: 1.12,
      expiration: 1,
      timestamp: '2026-11-11T10:00:00Z',
    })
    useLabStore.getState().addLiveTrade({
      type: 'trade_result',
      trade_id: tradeId,
      asset: 'EURUSD',
      direction: 'CALL',
      result: 'WIN',
      pnl: 8.5,
      timestamp: '2026-11-11T10:01:00Z',
    })

    const trade = useLabStore.getState().liveTrades.find((item) => item.id === tradeId)
    expect(trade).toMatchObject({
      id: tradeId,
      asset: 'EURUSD',
      direction: 'CALL',
      amount: 10,
      entryPrice: 1.12,
      result: 'WIN',
      pnl: 8.5,
      openedAt: '2026-11-11T10:00:00Z',
      closedAt: '2026-11-11T10:01:00Z',
    })
  })

  it('stores a result even when the open event was missed', () => {
    const tradeId = `result-only-test-${Date.now()}`
    useLabStore.getState().addLiveTrade({
      type: 'trade_result',
      trade_id: tradeId,
      asset: 'EURUSD-OTC',
      direction: 'PUT',
      result: 'LOSS',
      pnl: -10,
      timestamp: '2026-11-11T10:01:00Z',
    })

    const trade = useLabStore.getState().liveTrades.find((item) => item.id === tradeId)
    expect(trade).toMatchObject({
      asset: 'EURUSD-OTC',
      direction: 'PUT',
      result: 'LOSS',
      pnl: -10,
      openedAt: null,
    })
  })

  it('does not create paper trades from signal records', () => {
    const journal = useJournalStore.getState()
    const record: SignalRecord = {
      id: `no-paper-sync-${Date.now()}`,
      symbol: 'EURUSD',
      playbook: 'A',
      direction: 'UP',
      triggerTime: 1,
      triggerIndex: 0,
      entryTime: 2,
      entryPrice: 1.1,
      expiresAt: 62,
      outcome: null,
      exitPrice: null,
      conditions: [],
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
    }

    useJournalStore.setState({
      settings: { ...journal.settings, autoPaper: true },
      trades: [],
      clearedRecordIds: [],
    })
    useJournalStore.getState().sync(
      { EURUSD: analysisWithRecord(record) },
      0,
    )

    expect(useJournalStore.getState().trades).toEqual([])
    useJournalStore.setState({
      settings: journal.settings,
      trades: journal.trades,
      clearedRecordIds: journal.clearedRecordIds,
    })
  })

  it('clears both paper and bot trades from the diary', () => {
    useJournalStore.setState({
      trades: [
        {
          id: 'paper-clear-test',
          symbol: 'EURUSD',
          playbook: 'A',
          direction: 'UP',
          openedAt: 1,
          entryPrice: 1.1,
          stake: 1,
          payout: 0.85,
          tieRefund: true,
          expiryCandles: 1,
          expiresAt: 2,
          closedAt: 2,
          exitPrice: 1.11,
          outcome: 'WIN',
          pnl: 0.85,
          dayKey: '2026-11-11',
          conditions: [],
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
        },
      ],
    })
    useLabStore.setState({
      liveTrades: [
        {
          id: 'bot-clear-test',
          asset: 'EURUSD',
          direction: 'CALL',
          amount: 1,
          entryPrice: 1.1,
          expiration: 1,
          result: 'WIN',
          pnl: 0.85,
          openedAt: '2026-11-11T10:00:00Z',
          closedAt: '2026-11-11T10:01:00Z',
        },
      ],
    })

    useLabStore.getState().clearDiaryHistory()

    expect(useJournalStore.getState().trades).toEqual([])
    expect(useLabStore.getState().liveTrades).toEqual([])

    const previousAnalyses = useMarketStore.getState().analyses
    const clearedAt = useMarketStore.getState().simNowSec
    const oldRecord: SignalRecord = {
      id: 'paper-cleared-record',
      symbol: 'EURUSD',
      playbook: 'A',
      direction: 'UP',
      triggerTime: clearedAt,
      triggerIndex: 1,
      entryTime: clearedAt + 60,
      entryPrice: 1.1,
      expiresAt: clearedAt + 300,
      outcome: null,
      exitPrice: null,
      conditions: [],
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
    }
    useMarketStore.setState({
      analyses: { ...previousAnalyses, EURUSD: analysisWithRecord(oldRecord) },
    })
    useLabStore.getState().clearDiaryHistory()
    useJournalStore.getState().sync(
      { EURUSD: analysisWithRecord(oldRecord) },
      clearedAt,
    )
    expect(useJournalStore.getState().trades).toEqual([])
    expect(useJournalStore.getState().clearedRecordIds).toContain(oldRecord.id)
    useMarketStore.setState({ analyses: previousAnalyses })
    useJournalStore.getState().reset([])
  })

  it('uses safe defaults and validates the bot stake', () => {
    const store = useLabStore.getState()
    expect(store.botStake).toBe(1)
    expect(store.isAutoTradeEnabled).toBe(false)
    expect(store.accountBalance).toBeNull()
    expect(store.accountCurrency).toBe('USD')
    expect(store.accountType).toBeNull()

    store.setBotStake(5)
    store.setBotStake(11)
    expect(useLabStore.getState().botStake).toBe(5)
    useLabStore.getState().setBotStake(1)
  })

  it('stores the latest account balance and currency globally', () => {
    useLabStore.getState().setAccountBalance(163647.86, 'USD', 'PRACTICE')

    expect(useLabStore.getState()).toMatchObject({
      accountBalance: 163647.86,
      accountCurrency: 'USD',
      accountType: 'PRACTICE',
    })

    useLabStore.getState().setAccountBalance(-1, 'USD', 'REAL')
    expect(useLabStore.getState().accountBalance).toBe(163647.86)
    useLabStore.getState().setAccountBalance(0, '', 'REAL')
    expect(useLabStore.getState().accountCurrency).toBe('USD')
    useLabStore.setState({ accountBalance: null, accountCurrency: 'USD', accountType: null })
  })
})
