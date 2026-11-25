import { useEffect, useState } from 'react'
import { FlaskConical, Info, ShieldCheck, Sparkles } from 'lucide-react'
import { Disclaimer } from '../components/Disclaimer'
import { EquityCurve } from '../components/lab/EquityCurve'
import { GridPreview } from '../components/lab/GridPreview'
import { ImportPanel } from '../components/lab/ImportPanel'
import { MetricsTable } from '../components/lab/MetricsTable'
import { RunPanel } from '../components/lab/RunPanel'
import { LAB_TIMEFRAME_LABEL, labSource } from '../data/assets'
import { EDGE_MIN_SAMPLE } from '../engine/edgeGate'
import { formatSignedUsd, formatUnixDateTime, formatUsd } from '../lib/format'
import { ORIGIN_BADGE, ORIGIN_BADGE_CLASS, ORIGIN_RESULT } from '../lib/labOrigin'
import { useLabStore } from '../stores/labStore'

export function Laboratorio() {
  const symbol = useLabStore((state) => state.config.symbol)
  const ensureDataset = useLabStore((state) => state.ensureDataset)
  const datasets = useLabStore((state) => state.datasets)
  const results = useLabStore((state) => state.results)
  const baselines = useLabStore((state) => state.baselines)
  const runInfo = useLabStore((state) => state.runInfo)
  const liveTrades = useLabStore((state) => state.liveTrades)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    ensureDataset(symbol)
  }, [ensureDataset, symbol])

  const selected = results.find((result) => result.comboId === selectedId) ?? results[0] ?? null
  const validated = results.filter((result) => result.gate.status === 'VALIDADO').length
  const hasResults = selected !== null && results.length > 0
  const datasetState = datasets[symbol]
  const source =
    datasetState?.status === 'ready' ? datasetState.dataset.source : labSource(symbol)
  const resultSource = runInfo?.source ?? source

  return (
    <div>
      <p className="mb-4 flex items-start gap-2 rounded-xl border border-info/30 bg-info/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-info">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Laboratório de análise. Nenhuma ordem é enviada por esta tela. O bot Python separado pode
          exibir eventos de monitoramento, mas não altera os resultados do backtest.
        </span>
      </p>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow flex items-center gap-2">
            <FlaskConical className="h-3.5 w-3.5 text-accentText" aria-hidden="true" />
            Pesquisa · walk-forward
          </p>
          <h1 className="mt-2 font-display text-[26px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[32px]">
            Laboratório de backtest
          </h1>
          <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-muted">
            60 dias de candles (M5 na Binance pública, M1 no simulado e no CSV do bot), divisão
            fixa 60/20/20 e Edge Gate de Wilson 95% decidido apenas no teste fora da amostra.
            Somente análise e paper trading; nenhuma ordem é enviada.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {validated > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-buy/30 bg-buy/[0.07] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-buy">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              {validated} {validated === 1 ? 'setup VALIDADO' : 'setups VALIDADOS'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/30 bg-warn/[0.07] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-warn">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Experimental · sem VALIDADO
            </span>
          )}
          <span className="rounded-full border border-line bg-white/[0.02] px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
            {source === 'bot'
              ? 'CSV do bot · importado'
              : source === 'simulado'
                ? 'Simulado · 60 dias'
                : 'Binance pública · 60 dias'}
          </span>
        </div>
      </header>

      {validated === 0 && (
        <p className="mt-3 rounded-xl border border-warn/20 bg-warn/[0.045] px-3 py-2 text-[10.5px] leading-relaxed text-warn">
          Nenhum setup recebe selo VALIDADO antes de n≥{EDGE_MIN_SAMPLE} no teste e limite inferior
          do IC95% acima do breakeven. INCONCLUSIVO e SEM VANTAGEM são respostas válidas.
        </p>
      )}

      <section
        aria-labelledby="lab-live-trades-heading"
        className="surface mt-4 p-3 sm:p-4"
        aria-live="polite"
      >
        <header className="flex items-center justify-between gap-2">
          <h2 id="lab-live-trades-heading" className="text-[11px] font-semibold text-content">
            Operações ao vivo recebidas do bot
          </h2>
          <span className="font-mono text-[9px] text-muted">
            {liveTrades.length} eventos
          </span>
        </header>
        {liveTrades.length === 0 ? (
          <p className="mt-2 text-[10px] leading-relaxed text-muted">
            Os eventos WebSocket serão exibidos aqui e permanecem separados dos dados do backtest.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {[...liveTrades].reverse().slice(0, 5).map((trade) => (
              <li
                key={trade.id}
                className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[10px]"
              >
                <span className="text-content">
                  {trade.asset} · {trade.direction} · {trade.result ?? 'ABERTA'}
                  {trade.amount !== null ? ` · ${formatUsd(trade.amount)}` : ''}
                </span>
                {trade.pnl !== null && (
                  <span className={trade.pnl >= 0 ? 'text-buy' : 'text-sell'}>
                    {formatSignedUsd(trade.pnl)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-stretch">
        <div className="min-w-0 lg:col-span-7">
          <ImportPanel />
        </div>
        <div className="min-w-0 lg:col-span-5">
          <RunPanel />
        </div>
      </div>

      <div className="mt-4">
        <GridPreview />
      </div>

      {hasResults && selected !== null && (
        <div className="mt-4 space-y-4">
          <div className="surface flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="eyebrow">Resultado do laboratório</p>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] ${ORIGIN_BADGE_CLASS[resultSource]}`}
                >
                  {ORIGIN_BADGE[resultSource]}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-content">
                {results.length} combinações · {runInfo?.trades ?? 0} operações · fonte{' '}
                {ORIGIN_RESULT[resultSource]}
                {runInfo !== null
                  ? ` · ${formatUnixDateTime(Math.floor(runInfo.generatedAt / 1000))}`
                  : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label
                htmlFor="lab-curve-select"
                className="text-[9px] uppercase tracking-[0.1em] text-muted"
              >
                Curva
              </label>
              <select
                id="lab-curve-select"
                value={selected.comboId}
                onChange={(event) => setSelectedId(event.target.value)}
                className="rounded-xl border border-line bg-white/[0.02] px-2.5 py-2 font-mono text-[10px] text-content outline-none transition-colors focus:border-accent/50"
              >
                {results.map((result) => (
                  <option key={result.comboId} value={result.comboId}>
                    Playbook {result.playbook} · {result.symbol} ·{' '}
                    {LAB_TIMEFRAME_LABEL[result.timeframe]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <EquityCurve result={selected} />
          <MetricsTable results={results} baselines={baselines} />
        </div>
      )}

      {!hasResults && (
        <div className="mt-4 rounded-2xl border border-line bg-white/[0.02] px-4 py-5 text-center">
          <p className="text-[12px] font-medium text-content">Sem execução neste navegador</p>
          <p className="mx-auto mt-1 max-w-xl text-[10.5px] leading-relaxed text-muted">
            Carregue os candles, pré-visualize o grid e rode o backtest. O resultado fica em memória
            e o worker é encerrado ao final ou ao cancelar.
          </p>
        </div>
      )}

      <div className="mt-4">
        <Disclaimer />
      </div>

      <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 text-[9px] text-muted/70">
        <p>PULSE SIGNALS · laboratório educacional · sem corretora · sem martingale</p>
        <p className="font-mono uppercase tracking-[0.08em]">UTC interno · exibição local</p>
      </footer>
    </div>
  )
}
