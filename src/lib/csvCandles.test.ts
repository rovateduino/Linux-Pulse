import { describe, expect, it } from 'vitest'
import { parseCandlesCsv } from './csvCandles'

describe('parseCandlesCsv', () => {
  it('reads source coverage metadata and reports missing intervals without filling them', () => {
    const text = [
      'timestamp_utc,open,high,low,close,volume,source,asset,timeframe,period_start_utc,period_end_utc',
      '2026-01-05T00:00:00Z,1.1,1.2,1.0,1.1,10,IQ Option,EURUSD,M5,2026-01-05T00:00:00Z,2026-01-05T00:25:00Z',
      '2026-01-05T00:10:00Z,1.1,1.2,1.0,1.1,10,IQ Option,EURUSD,M5,2026-01-05T00:00:00Z,2026-01-05T00:25:00Z',
      '2026-01-05T00:20:00Z,1.1,1.2,1.0,1.1,10,IQ Option,EURUSD,M5,2026-01-05T00:00:00Z,2026-01-05T00:25:00Z',
      '2026-01-05T00:25:00Z,1.1,1.2,1.0,1.1,10,IQ Option,EURUSD,M5,2026-01-05T00:00:00Z,2026-01-05T00:25:00Z',
    ].join('\n')

    const result = parseCandlesCsv(text)

    expect(result.source).toBe('IQ Option')
    expect(result.asset).toBe('EURUSD')
    expect(result.timeframe).toBe('5m')
    expect(result.periodStartUtc).toBe('2026-01-05T00:00:00Z')
    expect(result.periodEndUtc).toBe('2026-01-05T00:25:00Z')
    expect(result.candles).toHaveLength(4)
    expect(result.gapCount).toBe(2)
    expect(result.missingIntervals).toBe(2)
  })

  it('keeps undeclared provenance explicit for legacy CSV files', () => {
    const text = [
      'timestamp_utc,open,high,low,close,volume',
      '2026-01-05T00:00:00Z,1.1,1.2,1.0,1.1,10',
      '2026-01-05T00:05:00Z,1.1,1.2,1.0,1.1,10',
    ].join('\n')

    const result = parseCandlesCsv(text)

    expect(result.source).toBeNull()
    expect(result.asset).toBeNull()
    expect(result.timeframe).toBeNull()
    expect(result.stepSeconds).toBe(300)
  })

  it('rejects inconsistent source or asset metadata', () => {
    const text = [
      'timestamp_utc,open,high,low,close,volume,source,asset',
      '2026-01-05T00:00:00Z,1.1,1.2,1.0,1.1,10,IQ Option,EURUSD',
      '2026-01-05T00:05:00Z,1.1,1.2,1.0,1.1,10,Other source,EURUSD',
    ].join('\n')

    expect(() => parseCandlesCsv(text)).toThrow('metadado source inconsistente')
  })
})
