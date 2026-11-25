import { DEFAULT_SESSIONS } from '../../config/sessions'
import { isInSession } from '../../lib/backtest/sessionFilter'
import type { AssetDef, Candle, CandleDirection, SetupCondition } from '../../types/market'
import type { SessionWindow } from '../../types/lab'
import { indicatorsFor } from './shared'
import type { PlaybookSignal } from './types'

export const BREAKOUT_LOOKBACK = 12
export const MIN_BODY_RATIO = 0.6
export const RSI_MOMENTUM_LOW = 50
export const RSI_MOMENTUM_HIGH = 70
export const TAKE_PROFIT_ATR = 1.0
export const STOP_LOSS_ATR = 0.7

/**
 * Playbook C — Momentum de Sessão (breakout).
 *
 * Compra: o candle rompe o topo das 12 velas anteriores, corpo > 60% do
 * range, ATR(14) acima da sua média de 50 e RSI(14) entre 50 e 70.
 * Venda simétrica (fundo das 12 velas, corpo de baixa, RSI entre 30 e 50).
 * Só emite dentro das janelas de sessão (London/NY por padrão).
 */
export function evaluateC(
  candles: readonly Candle[],
  index: number,
  _cfg: AssetDef,
  sessions: readonly SessionWindow[] = DEFAULT_SESSIONS,
): PlaybookSignal | null {
  const current = candles[index]
  if (current === undefined || index < BREAKOUT_LOOKBACK) return null

  const range = current.high - current.low
  const body = Math.abs(current.close - current.open)
  const bodyRatio = range > 0 ? body / range : 0

  const { atr, atrSma, rsi } = indicatorsFor(candles)
  const atrValue = atr[index]
  const atrAverage = atrSma[index]
  const rsiValue = rsi[index]
  if (atrValue === null || atrAverage === null || rsiValue === null) return null

  let highest = -Infinity
  let lowest = Infinity
  for (let cursor = index - BREAKOUT_LOOKBACK; cursor < index; cursor += 1) {
    const candle = candles[cursor]
    if (candle.high > highest) highest = candle.high
    if (candle.low < lowest) lowest = candle.low
  }

  const bullish = current.close > highest
  const bearish = current.close < lowest
  const direction: CandleDirection | null = bullish && !bearish
    ? 'UP'
    : bearish && !bullish
      ? 'DOWN'
      : null

  const bodyOk =
    bodyRatio > MIN_BODY_RATIO &&
    (direction === 'UP'
      ? current.close > current.open
      : direction === 'DOWN'
        ? current.close < current.open
        : false)
  const rsiOk =
    direction === 'UP'
      ? rsiValue >= RSI_MOMENTUM_LOW && rsiValue <= RSI_MOMENTUM_HIGH
      : direction === 'DOWN'
        ? rsiValue >= 100 - RSI_MOMENTUM_HIGH && rsiValue <= 100 - RSI_MOMENTUM_LOW
        : false
  const inSession = isInSession(current.time, [...sessions])

  const conditions: SetupCondition[] = [
    { label: `Rompe as ${BREAKOUT_LOOKBACK} velas anteriores`, met: direction !== null },
    { label: 'Corpo > 60% do range', met: bodyOk },
    { label: 'ATR acima da média (50)', met: atrValue > atrAverage },
    { label: 'RSI na faixa de impulso', met: rsiOk },
    { label: 'Sessão de negociação', met: inSession },
  ]

  if (direction === null || !conditions.every((condition) => condition.met)) return null

  return {
    playbook: 'C',
    direction,
    conditions,
    exits: { takeProfitAtr: TAKE_PROFIT_ATR, stopLossAtr: STOP_LOSS_ATR },
  }
}
