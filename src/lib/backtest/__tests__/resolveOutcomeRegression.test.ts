import { describe, expect, it } from 'vitest'
import { findAsset } from '../../../data/assets'
import type { CandleDirection } from '../../../types/market'
import { DEFAULT_TIE_TOLERANCE, resolveOutcome } from '../resolveOutcome'

/**
 * Regressão de integração do `resolveOutcome`.
 *
 * Reprocessa os 6 `pulse-lab-trades_*.csv` (fixtures do repositório) sem acionar
 * o engine de sinais: para cada trade, reaplica a resolução sobre `entrada`/`saida`
 * e confere os totais. Ficou isolado das regras de indicadores/playbook, que podem
 * mudar sem afetar a matemática de liquidação.
 */

const REFERENCE_CSVS = import.meta.glob('/pulse-lab-trades_*.csv', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

interface ReferenceTrade {
  symbol: string
  direction: CandleDirection
  entry: number
  exit: number
  legacy: string
  payout: number
}

function parseDecimal(raw: string): number {
  return Number(raw.trim().replace(',', '.'))
}

function loadReferenceTrades(): ReferenceTrade[] {
  const trades: ReferenceTrade[] = []
  for (const text of Object.values(REFERENCE_CSVS)) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '')
    for (let index = 1; index < lines.length; index += 1) {
      const cells = lines[index].split(';')
      trades.push({
        symbol: cells[1].trim(),
        direction: cells[4].trim() === 'COMPRA' ? 'UP' : 'DOWN',
        entry: parseDecimal(cells[5]),
        exit: parseDecimal(cells[6]),
        legacy: cells[7].trim(),
        payout: parseDecimal(cells[8]),
      })
    }
  }
  return trades
}

describe('resolveOutcome · regressão dos CSVs de referência', () => {
  const trades = loadReferenceTrades()

  it('reprocessa os 6 CSVs e confere os totais consolidados', () => {
    expect(Object.keys(REFERENCE_CSVS)).toHaveLength(6)
    expect(trades).toHaveLength(364)

    const legacyWins = trades.filter((trade) => trade.legacy === 'ACERTO').length
    expect(legacyWins).toBe(154)

    let wins = 0
    let flips = 0

    for (const trade of trades) {
      const tickSize = findAsset(trade.symbol).tickSize
      const withinTolerance =
        Math.abs(trade.exit - trade.entry) <= tickSize * DEFAULT_TIE_TOLERANCE
      const { result, pnl } = resolveOutcome(
        trade.entry,
        trade.exit,
        trade.direction,
        trade.payout,
        { tickSize },
      )

      if (withinTolerance) {
        expect(result).toBe('TIE')
        expect(pnl).toBe(0)
      }
      if (result === 'WIN') wins += 1
      if (withinTolerance && trade.legacy === 'ACERTO') flips += 1
    }

    // Trades que eram ACERTO e agora viram EMPATE — inflavam o win rate antigo.
    // 17 por igualdade exata + 1 GBPJPY (218,145 -> 218,1445, dentro do tick).
    expect(flips).toBe(18)

    // Snapshot agregado: win rate cai de 42,31% para 37,36%.
    expect((legacyWins / trades.length) * 100).toBeCloseTo(42.31, 1)
    expect((wins / trades.length) * 100).toBeCloseTo(37.36, 1)
  })
})
