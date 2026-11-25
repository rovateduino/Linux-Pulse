import { describe, expect, it } from 'vitest'
import { parseCandlesCsv } from '../../lib/csvCandles'
import type { SignalPlaybook } from '../../types/market'
import { runBacktest } from '../backtest'
import { evaluateEdge } from '../edgeGate'

/**
 * Harness de aceitação do PR 4 (tuning): roda os 6 CSVs históricos (M5,
 * IQ Option) com o Playbook D v2 em M15 + filtro EMA200 H1, sessão
 * DEFAULT_SESSIONS, payout 0.85 e expirações de 1, 2 e 3 velas M15.
 * Imprime, por expiração, o veredito do dual gate por ativo e do
 * PORTFÓLIO agregado (soma de N e wins de todos os ativos).
 */

const CSV_MODULES = import.meta.glob<string>(
  '../../../candles_historico_*.csv',
  { query: '?raw', import: 'default', eager: true },
)

const PAYOUT = 0.85
const PLAYBOOKS: readonly SignalPlaybook[] = ['D']
const EXPIRIES = [1, 2, 3] as const

interface Row {
  symbol: string
  playbook: SignalPlaybook
  expiry: number
  n: number
  wins: number
  winRate: number
  verdict: string
}

describe('playbook D v2 · backtest M15 nos 6 CSVs históricos', () => {
  it(
    'produz N, win% e veredito do dual gate por ativo e por portfólio',
    { timeout: 300_000 },
    () => {
      const rows: Row[] = []
      const datasets = Object.entries(CSV_MODULES)
        .sort()
        .map(([path, text]) => {
          const match = /candles_historico_([A-Z]+)_M5\.csv$/.exec(path)
          return match === null ? null : { symbol: match[1], candles: parseCandlesCsv(text).candles }
        })
        .filter((entry): entry is { symbol: string; candles: NonNullable<ReturnType<typeof parseCandlesCsv>['candles']> } => entry !== null)

      for (const expiryCandles of EXPIRIES) {
        let totalN = 0
        let totalWins = 0

        for (const dataset of datasets) {
          for (const playbook of PLAYBOOKS) {
            const output = runBacktest({
              symbol: dataset.symbol,
              timeframe: '15m',
              confirmation: '30m',
              payout: PAYOUT,
              expiryCandles,
              m5Candles: dataset.candles,
              playbooks: [playbook],
            })
            const result = output.results[0]
            const test = result?.test
            const n = test?.n ?? 0
            const wins = test?.wins ?? 0
            const verdict = evaluateEdge({ n, wins }, PAYOUT)
            rows.push({
              symbol: dataset.symbol,
              playbook,
              expiry: expiryCandles,
              n,
              wins,
              winRate: test?.winRate ?? 0,
              verdict: verdict.kind,
            })
            totalN += n
            totalWins += wins
          }
        }

        const portfolio = evaluateEdge({ n: totalN, wins: totalWins }, PAYOUT)
        console.log(`\n=== PR4 · Playbook D v2 · M15 · expiry ${expiryCandles} vela(s) · 6 CSVs ===`)
        console.log('Ativo    | PB | N teste | WR     | Veredito')
        for (const row of rows.filter((r) => r.expiry === expiryCandles)) {
          console.log(
            `${row.symbol.padEnd(8)} | ${row.playbook}  | ${String(row.n).padStart(7)} | ${(
              row.winRate * 100
            )
              .toFixed(1)
              .padStart(5)}% | ${row.verdict}`,
          )
        }
        console.log(`PORTFÓLIO |    | ${String(totalN).padStart(7)} | ${((totalWins / Math.max(1, totalN)) * 100).toFixed(1).padStart(5)}% | ${portfolio.kind} (${portfolio.reason})`)
        console.log('================================================================\n')
      }

      expect(rows.length).toBe(EXPIRIES.length * PLAYBOOKS.length * datasets.length)
    },
  )
})
