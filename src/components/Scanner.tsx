import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronRight, Radar } from 'lucide-react'
import { useMarketData, useScannerAnalyses } from '../hooks/useMarketData'
import { formatPercent, formatPrice } from '../lib/format'
import {
  outcomeLabel,
  outcomeTone,
  phaseLabel,
  regimeLabel,
  signalTone,
} from '../lib/signalMeta'
import type { AssetAnalysis } from '../types/market'
import { SIGNAL_TONES } from './ui/tones'

interface ScannerProps {
  openChart: (symbol: string) => void
}

type SortMode = 'fase' | 'variacao' | 'ativo'

const PHASE_ORDER = {
  ENTRAR: 0,
  EM_ANDAMENTO: 1,
  ATENCAO: 2,
  RESULTADO: 3,
  OBSERVANDO: 4,
} as const

const OUTCOME_CLASS = {
  buy: 'border-buy/30 bg-buy/[0.08] text-buy',
  sell: 'border-sell/30 bg-sell/[0.08] text-sell',
  warn: 'border-warn/30 bg-warn/[0.08] text-warn',
  idle: 'border-line bg-white/[0.03] text-muted',
} as const

const SORTS: { id: SortMode; label: string }[] = [
  { id: 'fase', label: 'Fase' },
  { id: 'variacao', label: 'Variação' },
  { id: 'ativo', label: 'Ativo' },
]

export function Scanner({ openChart }: ScannerProps) {
  const data = useMarketData()
  const scannerAnalyses = useScannerAnalyses()
  const [sort, setSort] = useState<SortMode>('fase')

  const rows = useMemo(() => {
    const list = data.assets
      .map((asset) => scannerAnalyses[asset.symbol])
      .filter((analysis): analysis is AssetAnalysis => analysis !== undefined)

    return [...list].sort((a, b) => {
      if (sort === 'ativo') return a.symbol.localeCompare(b.symbol)
      if (sort === 'variacao') return b.changePct - a.changePct
      return (
        PHASE_ORDER[a.signal.phase] - PHASE_ORDER[b.signal.phase] ||
        b.changePct - a.changePct
      )
    })
  }, [data.assets, scannerAnalyses, sort])

  const entries = rows.filter(
    (analysis) =>
      analysis.signal.phase === 'ENTRAR' || analysis.signal.phase === 'EM_ANDAMENTO',
  ).length
  const attention = rows.filter((analysis) => analysis.signal.phase === 'ATENCAO').length

  return (
    <div>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Scanner · M1 · confirmação M5</p>
          <h1 className="mt-2 font-display text-[26px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[32px]">
            O radar de setups.
          </h1>
          <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-muted">
            Todos os ativos ranqueados por fase do ciclo. Um clique abre o gráfico com a leitura
            completa. Usa candles M1 e confirmação M5 fechados; é informativo e não altera o Auto-Trade.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-buy/25 bg-buy/[0.06] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-buy">
            {entries} com gatilho
          </span>
          <span className="rounded-full border border-warn/25 bg-warn/[0.06] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-warn">
            {attention} em atenção
          </span>
        </div>
      </header>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Ordenar scanner"
          className="flex rounded-lg border border-line bg-white/[0.02] p-0.5"
        >
          {SORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSort(option.id)}
              aria-pressed={sort === option.id}
              className={`rounded-md px-2.5 py-1 text-[9px] font-medium uppercase tracking-[0.06em] transition-colors ${
                sort === option.id
                  ? 'bg-white/[0.07] text-content'
                  : 'text-muted hover:text-content'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-1.5 text-[9px] text-muted">
          <Radar className="h-3 w-3" aria-hidden="true" />
          atualizado a cada candle fechado
        </span>
      </div>

      <ul className="mt-3 space-y-2">
        {rows.map((analysis) => {
          const asset = data.assets.find((item) => item.symbol === analysis.symbol)
          if (asset === undefined) return null
          const signal = analysis.signal
          const tone = SIGNAL_TONES[signalTone(signal)]
          const up = analysis.changePct >= 0
          const last = analysis.records[analysis.records.length - 1] ?? null
          const price = analysis.closed[analysis.closed.length - 1]?.close ?? 0

          return (
            <li key={analysis.symbol}>
              <button
                type="button"
                onClick={() => openChart(analysis.symbol)}
                aria-label={`Abrir gráfico de ${asset.symbol}`}
                className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-line bg-white/[0.015] px-3.5 py-3 text-left transition-colors hover:border-accent/30 hover:bg-white/[0.03] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_auto] sm:px-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-display text-[13px] font-semibold tracking-[0.03em]">
                      {asset.symbol}
                    </span>
                    <span className="text-[9.5px] text-muted">{asset.name}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] ${tone.chip}`}
                    >
                      {phaseLabel(signal)}
                    </span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9.5px] text-muted">
                    <span>{regimeLabel(analysis.regime.kind)}</span>
                    <span className="text-muted/50">·</span>
                    <span>
                      {signal.playbook === null ? 'sem playbook' : `Playbook ${signal.playbook}`}
                    </span>
                    {last !== null && (
                      <>
                        <span className="text-muted/50">·</span>
                        <span>último: {last.direction === 'UP' ? 'compra' : 'venda'}</span>
                      </>
                    )}
                    {analysis.engineError !== undefined &&
                      analysis.engineError !== null && (
                        <>
                          <span className="text-muted/50">·</span>
                          <span title={analysis.engineError}>aguardando feed M1/M5</span>
                        </>
                      )}
                  </p>
                </div>

                <div className="hidden min-w-0 sm:block">
                  <p className="font-mono text-[11px] tnum text-content">
                    {formatPrice(price, asset.decimals)}
                  </p>
                  <p
                    className={`mt-0.5 flex items-center gap-0.5 font-mono text-[9.5px] tnum ${
                      up ? 'text-buy' : 'text-sell'
                    }`}
                  >
                    {up ? (
                      <ArrowUpRight className="h-2.5 w-2.5" aria-hidden="true" />
                    ) : (
                      <ArrowDownRight className="h-2.5 w-2.5" aria-hidden="true" />
                    )}
                    {formatPercent(analysis.changePct)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <p className="font-mono text-[10px] tnum text-content sm:hidden">
                      {formatPrice(price, asset.decimals)}
                    </p>
                    {last !== null && (
                      <span
                        className={`mt-0.5 inline-block rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.06em] ${OUTCOME_CLASS[outcomeTone(last.outcome)]}`}
                      >
                        {outcomeLabel(last.outcome)}
                      </span>
                    )}
                  </div>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                    aria-hidden="true"
                  />
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      <p className="mt-4 text-[9.5px] leading-relaxed text-muted/80">
        Fases: ENTRAR (gatilho confirmado), EM ANDAMENTO (operação aberta), ATENÇÃO (falta 1
        condição), RESULTADO (apuração no fechamento), OBSERVANDO (sem setup).
      </p>
    </div>
  )
}
