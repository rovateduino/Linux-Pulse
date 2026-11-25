import { describe, expect, it } from 'vitest'
import { aggregateCandles, createSimFeed } from '../data/simulator'
import { ASSETS } from '../data/assets'
import {
  BASE_STRATEGY,
  WARMUP_INDEX,
  buildSignalAnalysis,
  evaluateSetup,
  prepareConfirmation,
  prepareMarket,
  regimeAt,
  type PreparedMarket,
} from './strategy'
import type { Candle } from '../types/market'

const now = Date.UTC(2026, 0, 15, 12, 0, 0)
const asset = ASSETS[0]
const feed = createSimFeed(now, [asset])
const m5 = aggregateCandles(feed.series[asset.symbol], 300)
const m15 = aggregateCandles(feed.series[asset.symbol], 900)
const M1_M5_TIMING = { candleSeconds: 60, confirmationSeconds: 300 }
const prepared = prepareMarket(m5)
const confirmation = prepareConfirmation(m15)

const forming: Candle = {
  time: m5[m5.length - 1].time + 300,
  open: m5[m5.length - 1].close,
  high: m5[m5.length - 1].close,
  low: m5[m5.length - 1].close,
  close: m5[m5.length - 1].close,
  volume: 0,
}

describe('prepareMarket', () => {
  it('aquece os indicadores de forma causal', () => {
    expect(prepared.closes).toHaveLength(m5.length)
    expect(prepared.ema20[18]).toBeNull()
    expect(prepared.ema20[19]).not.toBeNull()
    expect(prepared.ema200[WARMUP_INDEX]).not.toBeNull()
    expect(prepared.bandwidthPct[WARMUP_INDEX]).not.toBeNull()
    expect(prepared.atrPct[WARMUP_INDEX]).not.toBeNull()
  })

  it('não conhece candles futuros ao preparar um prefixo', () => {
    const cut = Math.floor(m5.length * 0.75)
    const prefix = prepareMarket(m5.slice(0, cut + 1))
    const full = prepareMarket(m5)

    expect(prefix.ema20[cut]).toBeCloseTo(full.ema20[cut]!, 8)
    expect(prefix.ema50[cut]).toBeCloseTo(full.ema50[cut]!, 8)
    expect(prefix.ema200[cut]).toBeCloseTo(full.ema200[cut]!, 8)
    expect(prefix.atr[cut]).toBeCloseTo(full.atr[cut]!, 8)
    expect(prefix.rsi[cut]).toBeCloseTo(full.rsi[cut]!, 8)
    expect(prefix.slope[cut]).toBeCloseTo(full.slope[cut]!, 8)
    expect(regimeAt(prefix, cut)).toEqual(regimeAt(full, cut))
  })
})

describe('evaluateSetup', () => {
  it('mantém invariantes de fase, direção e playbook', () => {
    for (let index = WARMUP_INDEX; index < m5.length; index += 1) {
      const evaluation = evaluateSetup(prepared, confirmation, index)
      const missing = evaluation.conditions
        .slice(0, -1)
        .filter((condition) => !condition.met).length

      if (evaluation.phase === 'ENTRAR') {
        expect(evaluation.ready).toBe(true)
        expect(evaluation.playbook).not.toBeNull()
        expect(evaluation.direction).not.toBeNull()
        expect(evaluation.blockedBy).toHaveLength(0)
        expect(missing).toBe(0)
        expect(evaluation.conditions.every((condition) => condition.met)).toBe(true)
        expect(evaluation.triggerTime).toBe(m5[index].time)
      }

      if (evaluation.phase === 'ATENCAO') {
        expect(evaluation.playbook).not.toBeNull()
        expect(evaluation.direction).not.toBeNull()
        expect(evaluation.blockedBy).toHaveLength(0)
        expect(missing).toBe(1)
      }

      if (evaluation.phase === 'OBSERVANDO') {
        expect(evaluation.direction).toBeNull()
        expect(evaluation.triggerTime).toBeNull()
      }
    }
  })
})

describe('buildSignalAnalysis', () => {
  const analysis = buildSignalAnalysis(asset.symbol, m5, m15, forming, BASE_STRATEGY)

  it('produz registros determinísticos', () => {
    const again = buildSignalAnalysis(asset.symbol, m5, m15, forming, BASE_STRATEGY)
    expect(again.records).toEqual(analysis.records)
    expect(again.view).toEqual(analysis.view)
  })

  it('gera um ciclo coerente de operações', () => {
    expect(analysis.records.length).toBeGreaterThan(4)

    const ids = new Set<string>()
    let previousTriggerIndex = -Infinity
    for (const record of analysis.records) {
      expect(ids.has(record.id)).toBe(false)
      ids.add(record.id)

      expect(record.triggerIndex - previousTriggerIndex).toBeGreaterThanOrEqual(
        BASE_STRATEGY.spacingCandles,
      )
      previousTriggerIndex = record.triggerIndex

      const trigger = m5[record.triggerIndex]
      const entry = m5[record.triggerIndex + 1]
      const exit = m5[record.triggerIndex + BASE_STRATEGY.expiryCandles]

      expect(record.triggerTime).toBe(trigger.time)
      expect(record.entryTime).toBe(entry.time)
      expect(record.entryPrice).toBe(entry.open)
      expect(record.expiresAt).toBe(
        entry.time + BASE_STRATEGY.expiryCandles * 300,
      )
      expect(record.outcome).not.toBeNull()
      expect(record.exitPrice).toBe(exit.close)

      const up = exit.close > record.entryPrice
      const expected =
        exit.close === record.entryPrice ? 'TIE' : (record.direction === 'UP') === up ? 'WIN' : 'LOSS'
      expect(record.outcome).toBe(expected)
      expect(record.conditions.every((condition) => condition.met)).toBe(true)
    }
  })

  it('não reescreve o passado quando candles futuros chegam', () => {
    const cut = Math.floor(m5.length * 0.8)
    const prefix = buildSignalAnalysis(
      asset.symbol,
      m5.slice(0, cut + 1),
      m15,
      null,
      BASE_STRATEGY,
    )
    const pastPrefix = prefix.records.filter((record) => record.triggerIndex < cut)
    const pastFull = analysis.records.filter((record) => record.triggerIndex < cut)

    expect(pastPrefix).toEqual(pastFull)
    expect(prefix.lastEvaluation).toEqual(evaluateSetup(prepared, confirmation, cut))
  })

  it('apenas antecipa ENTRAR com o candle em formação', () => {
    const view = analysis.view
    if (view.phase === 'ENTRAR') {
      expect(view.active).not.toBeNull()
      expect(view.active!.entryTime).toBe(forming.time)
      expect(view.active!.entryPrice).toBe(forming.open)
      expect(view.active!.outcome).toBeNull()
      expect(view.triggerTime).toBe(m5[m5.length - 1].time)
    } else {
      expect(view.phase === 'EM_ANDAMENTO' || view.phase === 'RESULTADO' || view.phase === 'ATENCAO' || view.phase === 'OBSERVANDO').toBe(true)
    }
  })
})

describe('Scanner M1 with M5 confirmation', () => {
  it('uses the closed M5 candle for an M1 setup and ignores an unfinished M5 candle', () => {
    const index = WARMUP_INDEX + 65
    const candles: Candle[] = Array.from({ length: index + 1 }, (_, cursor) => {
      const open = 100 + cursor * 0.01
      return {
        time: cursor * 60,
        open,
        high: open + 0.02,
        low: open - 0.02,
        close: open + 0.005,
        volume: 1,
      }
    })
    candles[index - 1] = {
      time: (index - 1) * 60,
      open: 102.9,
      high: 103.5,
      low: 102.4,
      close: 103.1,
      volume: 1,
    }
    candles[index] = {
      time: index * 60,
      open: 102.8,
      high: 104.2,
      low: 102.5,
      close: 104,
      volume: 1,
    }
    const series = (value: number | null = null) =>
      new Array<number | null>(index + 1).fill(value)
    const ema20 = series()
    const ema50 = series()
    const ema200 = series()
    const atr = series()
    const adx = series()
    const rsi = series()
    const bandwidthPct = series()
    const slope = series()
    const atrPct = series()
    ema20[index] = 103.2
    ema50[index] = 102.4
    ema200[index] = 101.5
    atr[index] = 1
    adx[index] = 30
    bandwidthPct[index] = 50
    slope[index] = 0.5
    atrPct[index] = 50
    for (let cursor = index - 4; cursor <= index; cursor += 1) rsi[cursor] = 45
    const scannerMarket: PreparedMarket = {
      candles,
      closes: candles.map((candle) => candle.close),
      ema20,
      ema50,
      ema200,
      atr,
      adx,
      rsi,
      bands: {
        middle: series(),
        upper: series(),
        lower: series(),
        bandwidth: series(),
      },
      bandwidthPct,
      slope,
      atrPct,
    }
    const confirmationM5: Candle[] = Array.from({ length: 55 }, (_, cursor) => ({
      time: cursor * 300,
      open: 100 + cursor * 0.1,
      high: 100.2 + cursor * 0.1,
      low: 99.9 + cursor * 0.1,
      close: 100.1 + cursor * 0.1,
      volume: 1,
    }))
    const formingM5: Candle = {
      time: 55 * 300,
      open: 105.5,
      high: 105.6,
      low: 90,
      close: 90,
      volume: 1,
    }

    const closedEvaluation = evaluateSetup(
      scannerMarket,
      prepareConfirmation(confirmationM5),
      index,
      M1_M5_TIMING,
    )
    const withFormingEvaluation = evaluateSetup(
      scannerMarket,
      prepareConfirmation([...confirmationM5, formingM5]),
      index,
      M1_M5_TIMING,
    )

    expect(closedEvaluation.playbook).toBe('A')
    expect(closedEvaluation.conditions).toContainEqual({
      label: 'Confirmação M5',
      met: true,
    })
    expect(closedEvaluation.triggerTime).toBe(index * 60)
    expect(withFormingEvaluation).toEqual(closedEvaluation)
  })
})

describe('evaluateSetup · Playbook B', () => {
  const length = WARMUP_INDEX + 2
  const index = length - 1

  function withLast(current: number, previous: number): (number | null)[] {
    const series = new Array<number | null>(length).fill(null)
    series[index - 1] = previous
    series[index] = current
    return series
  }

  function lateralMarket(atrPct: number): PreparedMarket {
    const candles: Candle[] = Array.from({ length }, (_, cursor) => ({
      time: cursor * 300,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    }))
    candles[index - 1] = {
      time: (index - 1) * 300,
      open: 99,
      high: 100,
      low: 95,
      close: 96,
      volume: 1,
    }
    candles[index] = {
      time: index * 300,
      open: 101,
      high: 101.2,
      low: 99.4,
      close: 100.2,
      volume: 1,
    }

    return {
      candles,
      closes: candles.map((candle) => candle.close),
      ema20: withLast(100, 99.5),
      ema50: withLast(99, 98.8),
      ema200: withLast(98, 97.5),
      atr: withLast(10, 10),
      adx: withLast(12, 12),
      rsi: withLast(25, 28),
      bands: {
        middle: withLast(102, 101.5),
        upper: withLast(105, 104),
        lower: withLast(99, 97),
        bandwidth: withLast(0.03, 0.03),
      },
      bandwidthPct: withLast(20, 22),
      slope: withLast(0.05, 0.04),
      atrPct: withLast(atrPct, 48),
    }
  }

  it('confirma reversão em lateral com todas as condições', () => {
    const evaluation = evaluateSetup(
      lateralMarket(50),
      { candles: [], ema50: [] },
      index,
    )
    expect(evaluation.regime).toBe('LATERAL')
    expect(evaluation.playbook).toBe('B')
    expect(evaluation.direction).toBe('UP')
    expect(evaluation.phase).toBe('ENTRAR')
    expect(evaluation.ready).toBe(true)
    expect(evaluation.blockedBy).toHaveLength(0)
    expect(evaluation.conditions.every((condition) => condition.met)).toBe(true)
    expect(evaluation.triggerTime).toBe(index * 300)
  })

  it('bloqueia por volatilidade morta mesmo com o padrão completo', () => {
    const evaluation = evaluateSetup(lateralMarket(10), { candles: [], ema50: [] }, index)
    expect(evaluation.blockedBy.length).toBeGreaterThan(0)
    expect(evaluation.ready).toBe(false)
    expect(evaluation.phase).toBe('OBSERVANDO')
  })
})

describe('pausa pós-perdas', () => {
  it('bloqueia novos gatilhos após uma perda com pausa ativa', () => {
    const base = buildSignalAnalysis(asset.symbol, m5, m15, forming, BASE_STRATEGY)
    const first = base.records[0]
    expect(first).toBeDefined()

    const exitIndex = first.triggerIndex + 1
    const forcedExit =
      first.direction === 'UP' ? first.entryPrice - 1 : first.entryPrice + 1
    const altered = m5.map((candle, cursor) =>
      cursor === exitIndex
        ? {
            ...candle,
            close: forcedExit,
            high: Math.max(candle.high, forcedExit),
            low: Math.min(candle.low, forcedExit),
          }
        : candle,
    )

    const paused = buildSignalAnalysis(asset.symbol, altered, m15, null, {
      ...BASE_STRATEGY,
      pauseAfterLosses: 1,
      pauseMinutes: 10_000,
    })

    expect(paused.records).toHaveLength(1)
    expect(paused.records[0].outcome).toBe('LOSS')
    expect(paused.view.pausedUntil).not.toBeNull()
    expect(paused.view.pausedUntil!).toBeGreaterThan(paused.records[0].expiresAt)
  })
})
