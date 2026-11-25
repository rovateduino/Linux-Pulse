import type { Candle, CandleDirection, TradeOutcome } from '../../types/market'
import { resolveOutcome } from '../../lib/backtest/resolveOutcome'

/** Timeframe base validado do Playbook D (M15) e expiração de 1 vela. */
export const PLAYBOOK_D_TF_SECONDS = 900
export const PLAYBOOK_D_EXPIRY_CANDLES = 1

/**
 * Trade shadow do Playbook D acumulado no Modo Sombra ao Vivo.
 * Entrada no fechamento do candle M15 de sinal; saída no fechamento do
 * próximo candle M15 (expiry = 1 vela), liquidado por `resolveOutcome`.
 */
export interface PlaybookDLiveTrade {
  id: string
  symbol: string
  direction: CandleDirection
  /** `time` (abertura) do candle M15 que gerou o sinal. */
  signalTime: number
  entryPrice: number
  payout: number
  createdAt: number
  exitPrice?: number
  /** Instante de fechamento do candle de saída (segundos Unix). */
  exitTime?: number
  outcome?: TradeOutcome
  settledAt?: number
}

export function playbookDTradeId(
  symbol: string,
  signalTime: number,
  direction: CandleDirection,
): string {
  return `${symbol}:${signalTime}:${direction}`
}

/** Liquida um trade shadow com o candle de saída (fechamento do M15 seguinte). */
export function settlePlaybookDTrade(
  trade: PlaybookDLiveTrade,
  exitCandle: Candle,
  tickSize: number,
): PlaybookDLiveTrade {
  const { result } = resolveOutcome(trade.entryPrice, exitCandle.close, trade.direction, trade.payout, {
    tickSize,
  })
  return {
    ...trade,
    exitPrice: exitCandle.close,
    exitTime: exitCandle.time + PLAYBOOK_D_TF_SECONDS,
    outcome: result,
    settledAt: Date.now(),
  }
}

function csvCell(value: string | number): string {
  const text = String(value)
  return text.includes(',') || text.includes('"') || text.includes('\n')
    ? `"${text.replace(/"/g, '""')}"`
    : text
}

/**
 * Exporta os trades shadow do Playbook D em CSV.
 * Colunas: symbol, signalTime, direction, entry, exit, result, pnl.
 * `pnl` usa a stake informada e o payout gravado em cada trade
 * (WIN → stake×payout, LOSS → −stake, TIE → 0, aberto → vazio).
 */
export function playbookDTradesCsv(
  trades: readonly PlaybookDLiveTrade[],
  stake: number,
): string {
  const header = 'symbol,signalTime,direction,entry,exit,result,pnl'
  const rows = [...trades]
    .sort((a, b) => a.signalTime - b.signalTime)
    .map((trade) => {
      const pnl =
        trade.outcome === 'WIN'
          ? stake * trade.payout
          : trade.outcome === 'LOSS'
            ? -stake
            : trade.outcome === 'TIE'
              ? 0
              : ''
      return [
        csvCell(trade.symbol),
        csvCell(new Date(trade.signalTime * 1000).toISOString()),
        csvCell(trade.direction),
        csvCell(trade.entryPrice),
        csvCell(trade.exitPrice ?? ''),
        csvCell(trade.outcome ?? 'OPEN'),
        csvCell(pnl),
      ].join(',')
    })
  return [header, ...rows].join('\n')
}
