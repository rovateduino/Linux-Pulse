import { ArrowDownRight, ArrowUpRight, Download, FileDown } from 'lucide-react'
import { labTradesCsv } from '../../engine/backtest'
import { LAB_TIMEFRAME_LABEL } from '../../data/assets'
import { EDGE_MIN_SAMPLE } from '../../engine/edgeGate'
import { formatSignedUsd, formatUsd } from '../../lib/format'
import type { BacktestResult, BaselineResult } from '../../types/lab'
import { EdgeBadge } from './EdgeBadge'

const pctFormat = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

function pct(value: number): string {
  return `${pctFormat.format(value * 100)}%`
}

function signedUnit(value: number): string {
  const text = Math.abs(value).toFixed(3).replace('.', ',')
  if (value > 0) return `+${text}`
  if (value < 0) return `-${text}`
  return text
}

function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const TH_CLASS =
  'whitespace-nowrap px-2 py-2 text-[8.5px] font-medium uppercase tracking-[0.08em] text-muted'
const TD_CLASS = 'whitespace-nowrap px-2 py-3 font-mono text-[10px] tnum text-content/90'

export function MetricsTable({
  results,
  baselines,
}: {
  results: BacktestResult[]
  baselines: BaselineResult[]
}) {
  if (results.length === 0) return null

  const allTrades = results.flatMap((result) => result.trades)

  return (
    <section aria-labelledby="lab-metrics-heading" className="surface p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Resultados</p>
          <h2
            id="lab-metrics-heading"
            className="mt-1 font-display text-base font-semibold tracking-tight"
          >
            Métricas por combinação
          </h2>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-muted">
            n, acertos, IC95% de Wilson, breakeven, expectativa por US$ 1 e drawdown usam apenas o
            teste fora da amostra (últimos 20%). Treino e validação aparecem como referência.
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv('pulse-lab-trades.csv', labTradesCsv(allTrades))}
          disabled={allTrades.length === 0}
          aria-label="Exportar todos os trades em CSV"
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-accent/30 bg-accent/[0.1] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-accentText transition-colors hover:bg-accent/[0.16] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
          Exportar tudo
        </button>
      </header>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[1020px] border-collapse text-left">
          <caption className="sr-only">
            Métricas do teste fora da amostra por playbook, ativo e timeframe, com Edge Gate e
            exportação CSV.
          </caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={TH_CLASS}>
                Combinação
              </th>
              <th scope="col" className={`${TH_CLASS} text-right`}>
                n OOS
              </th>
              <th scope="col" className={`${TH_CLASS} text-right`}>
                Faltam p/{EDGE_MIN_SAMPLE}
              </th>
              <th scope="col" className={`${TH_CLASS} text-right`}>
                Acertos
              </th>
              <th scope="col" className={`${TH_CLASS} text-right`}>
                IC95% inf.
              </th>
              <th scope="col" className={`${TH_CLASS} text-right`}>
                IC95% sup.
              </th>
              <th scope="col" className={`${TH_CLASS} text-right`}>
                Breakeven
              </th>
              <th scope="col" className={`${TH_CLASS} text-right`}>
                Expect. / US$
              </th>
              <th scope="col" className={`${TH_CLASS} text-right`}>
                PnL
              </th>
              <th scope="col" className={`${TH_CLASS} text-right`}>
                DD máx
              </th>
              <th scope="col" className={TH_CLASS}>
                Edge Gate
              </th>
              <th scope="col" className={TH_CLASS}>
                <span className="sr-only">Exportar CSV da combinação</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {results.map((result) => {
              const metrics = result.test
              const up = metrics.expectancy >= 0
              return (
                <tr key={result.comboId} className="align-top">
                  <th scope="row" className="whitespace-nowrap px-2 py-3 text-left font-normal">
                    <span className="block text-[11px] font-medium text-content">
                      Playbook {result.playbook}
                    </span>
                    <span className="mt-0.5 block font-mono text-[9px] text-muted">
                      {result.symbol} · {LAB_TIMEFRAME_LABEL[result.timeframe]}
                    </span>
                    <span className="mt-0.5 block font-mono text-[8px] text-muted/70">
                      treino {result.train.n} · validação {result.validation.n}
                    </span>
                  </th>
                  <td className={`${TD_CLASS} text-right`}>{metrics.n}</td>
                  <td className={`${TD_CLASS} text-right`}>
                    {Math.max(0, EDGE_MIN_SAMPLE - metrics.n)}
                  </td>
                  <td className={`${TD_CLASS} text-right`}>{pct(metrics.winRate)}</td>
                  <td className={`${TD_CLASS} text-right`}>{pct(metrics.low)}</td>
                  <td className={`${TD_CLASS} text-right`}>{pct(metrics.high)}</td>
                  <td className={`${TD_CLASS} text-right text-muted`}>{pct(metrics.breakeven)}</td>
                  <td
                    className={`${TD_CLASS} text-right ${up ? 'text-buy' : 'text-sell'}`}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {up ? (
                        <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
                      )}
                      {signedUnit(metrics.expectancy)}
                    </span>
                  </td>
                  <td className={`${TD_CLASS} text-right`}>{formatSignedUsd(metrics.pnlUsd)}</td>
                  <td className={`${TD_CLASS} text-right text-muted`}>
                    {formatUsd(metrics.maxDrawdown)}
                  </td>
                  <td className="px-2 py-3">
                    <EdgeBadge gate={result.gate} />
                  </td>
                  <td className="px-2 py-3">
                    <button
                      type="button"
                      onClick={() =>
                        downloadCsv(
                          `pulse-lab-${result.comboId}.csv`,
                          labTradesCsv(result.trades),
                        )
                      }
                      aria-label={`Exportar CSV de ${result.comboId}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-line bg-white/[0.02] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.06em] text-muted transition-colors hover:border-white/15 hover:text-content"
                    >
                      <Download className="h-3 w-3" aria-hidden="true" />
                      CSV
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {baselines.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-[13px] font-semibold text-content">
              Baselines · mesma amostra de teste
            </h3>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted">
              mesmas entradas e saídas
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-muted">
            A direção muda, mas os pontos de entrada e saída são os mesmos do teste real. Servem de
            régua: se o playbook não superar o sorteio e as regras simples, não há vantagem
            demonstrada.
          </p>

          <div className="mt-2.5 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <caption className="sr-only">
                Baselines avaliadas na mesma amostra de teste: direção aleatória, sempre CALL e
                repetir a última vela.
              </caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={TH_CLASS}>
                    Estratégia
                  </th>
                  <th scope="col" className={`${TH_CLASS} text-right`}>
                    n
                  </th>
                  <th scope="col" className={`${TH_CLASS} text-right`}>
                    Acertos
                  </th>
                  <th scope="col" className={`${TH_CLASS} text-right`}>
                    IC95% inf.
                  </th>
                  <th scope="col" className={`${TH_CLASS} text-right`}>
                    IC95% sup.
                  </th>
                  <th scope="col" className={`${TH_CLASS} text-right`}>
                    Expect. / US$
                  </th>
                  <th scope="col" className={`${TH_CLASS} text-right`}>
                    PnL
                  </th>
                  <th scope="col" className={TH_CLASS}>
                    Edge Gate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {baselines.map((baseline) => (
                  <tr key={baseline.kind}>
                    <th
                      scope="row"
                      className="whitespace-nowrap px-2 py-2.5 text-left text-[10.5px] font-medium text-content"
                    >
                      {baseline.label}
                    </th>
                    <td className={`${TD_CLASS} py-2.5 text-right`}>{baseline.metrics.n}</td>
                    <td className={`${TD_CLASS} py-2.5 text-right`}>
                      {pct(baseline.metrics.winRate)}
                    </td>
                    <td className={`${TD_CLASS} py-2.5 text-right`}>{pct(baseline.metrics.low)}</td>
                    <td className={`${TD_CLASS} py-2.5 text-right`}>{pct(baseline.metrics.high)}</td>
                    <td
                      className={`${TD_CLASS} py-2.5 text-right ${
                        baseline.metrics.expectancy >= 0 ? 'text-buy' : 'text-sell'
                      }`}
                    >
                      {signedUnit(baseline.metrics.expectancy)}
                    </td>
                    <td className={`${TD_CLASS} py-2.5 text-right`}>
                      {formatSignedUsd(baseline.metrics.pnlUsd)}
                    </td>
                    <td className="px-2 py-2.5">
                      <EdgeBadge gate={baseline.gate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-3 text-[9.5px] leading-relaxed text-muted">
        VALIDADO exige n≥{EDGE_MIN_SAMPLE} no teste e limite inferior do IC95% acima do breakeven.
        INCONCLUSIVO e SEM VANTAGEM são respostas válidas e aparecem com a mesma naturalidade.
      </p>
    </section>
  )
}
