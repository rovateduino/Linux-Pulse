import { DEFAULT_SESSIONS } from '../../config/sessions'
import { isInSession } from '../../lib/backtest/sessionFilter'
import type { AssetDef, Candle, CandleDirection, SetupCondition } from '../../types/market'
import type { SessionWindow } from '../../types/lab'
import { BB_MULTIPLIER, bandsFor, h1Ema200At, indicatorsFor } from './shared'
import type { PlaybookSignal } from './types'

export const RSI_FADE_BUY_MAX = 35
export const RSI_FADE_SELL_MIN = 65
export const TAKE_PROFIT_ATR = 0.8
export const STOP_LOSS_ATR = 0.8

/** Parâmetros opcionais de tuning do Playbook D (v2). */
export interface PlaybookDTuning {
  /** Multiplicador das Bandas de Bollinger. Default 1.8. */
  bbMultiplier?: number
  /** RSI máximo para compra (estrito). Default 35. */
  rsiBuyMax?: number
  /** RSI mínimo para venda (estrito). Default 65. */
  rsiSellMin?: number
}

/**
 * Playbook D — Mean Reversion em Extremos (fade) com filtro de tendência.
 *
 * Compra: fechamento ACIMA da EMA(200) (tendência macro de alta), preço
 * toca a Banda de Bollinger(20, 1.8) inferior, RSI(14) < 35 e o candle do
 * toque fecha em alta. Venda simétrica: fechamento ABAIXO da EMA(200),
 * toque na banda superior, RSI > 65 e candle de baixa. Só emite dentro
 * das janelas de sessão (London/NY por padrão).
 */
export function evaluateD(
  candles: readonly Candle[],
  index: number,
  _cfg: AssetDef,
  sessions: readonly SessionWindow[] = DEFAULT_SESSIONS,
  tuning: PlaybookDTuning = {},
): PlaybookSignal | null {
  const current = candles[index]
  if (current === undefined) return null

  const bbMultiplier = tuning.bbMultiplier ?? BB_MULTIPLIER
  const rsiBuyMax = tuning.rsiBuyMax ?? RSI_FADE_BUY_MAX
  const rsiSellMin = tuning.rsiSellMin ?? RSI_FADE_SELL_MIN

  const { atr, rsi } = indicatorsFor(candles)
  const { lower, upper } = bandsFor(candles, bbMultiplier)
  const lowerNow = lower[index]
  const upperNow = upper[index]
  const rsiValue = rsi[index]
  const atrValue = atr[index]
  // Filtro de tendência macro: EMA200 calculada sobre candles H1 fechados.
  const emaNow = h1Ema200At(candles, index)
  if (
    lowerNow === null ||
    upperNow === null ||
    rsiValue === null ||
    atrValue === null ||
    emaNow === null
  ) {
    return null
  }

  const touchesLower = current.low <= lowerNow
  const touchesUpper = current.high >= upperNow
  const direction: CandleDirection | null = touchesLower && !touchesUpper
    ? 'UP'
    : touchesUpper && !touchesLower
      ? 'DOWN'
      : null

  const withTrend =
    direction === 'UP'
      ? current.close > emaNow
      : direction === 'DOWN'
        ? current.close < emaNow
        : false
  const rsiOk =
    direction === 'UP'
      ? rsiValue < rsiBuyMax
      : direction === 'DOWN'
        ? rsiValue > rsiSellMin
        : false
  const reversal =
    direction === 'UP'
      ? current.close > current.open
      : direction === 'DOWN'
        ? current.close < current.open
        : false
  const inSession = isInSession(current.time, [...sessions])

  const conditions: SetupCondition[] = [
    { label: 'Preço na banda extrema', met: direction !== null },
    { label: 'RSI em zona de exaustão', met: rsiOk },
    { label: 'Candle de reversão', met: reversal },
    { label: 'Tendência macro (EMA200 H1)', met: withTrend },
    { label: 'Sessão de negociação', met: inSession },
  ]

  if (direction === null || !conditions.every((condition) => condition.met)) return null

  return {
    playbook: 'D',
    direction,
    conditions,
    exits: { takeProfitAtr: TAKE_PROFIT_ATR, stopLossAtr: STOP_LOSS_ATR },
  }
}
