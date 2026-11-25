import { History, Trash2 } from 'lucide-react'
import { useMarketData } from '../hooks/useMarketData'
import { formatPercent, formatPrice, formatUnixDateTime } from '../lib/format'
import { directionLabel, outcomeLabel, outcomeTone } from '../lib/signalMeta'
import { MarketChart } from './MarketChart'
import { SignalSummary } from './SignalSummary'

const OUTCOME_CLASS = {
  buy: 'border-buy/30 bg-buy/[0.08] text-buy',
  sell: 'border-sell/30 bg-sell/[0.08] text-sell',
  warn: 'border-warn/30 bg-warn/[0.08] text-warn',
  idle: 'border-line bg-white/[0.03] text-muted',
} as const

export function Grafico() {
  const data = useMarketData()
  const { selected, asset } = data
  const signal = selected.signal

  const marker =
    (signal.phase === 'ENTRAR' || signal.phase === 'EM_ANDAMENTO') &&
    signal.triggerTime !== null &&
    signal.direction !== null
      ? {
          time: signal.triggerTime,
          direction: signal.direction,
          label: signal.phase === 'ENTRAR' ? 'ENTRAR' : 'EM CURSO',
        }
      : null

  const recent = [...data.assetHistory].slice(-8).reverse()

  return (
    <div>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Gráfico · M5 base</p>
          <h1 className="mt-2 font-display text-[26px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[32px]">
            Estrutura antes do gatilho.
          </h1>
          <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-muted">
            Candles fechados conduzem a leitura; a vela em formação aparece apenas como referência e
            nunca gera entrada. Confirmação vem do M15 fechado.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-white/[0.02] px-3 py-1.5 font-mono text-[10px] text-muted">
          {data.selectedTimeframe.toUpperCase()} · UTC interno
        </span>
      </header>

      <div className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {data.assets.map((item) => {
          const analysis = data.analyses[item.symbol]
          const active = item.symbol === data.selectedSymbol
          const phase = analysis?.signal.phase ?? 'OBSERVANDO'
          const dot =
            phase === 'ENTRAR'
              ? 'bg-buy'
              : phase === 'EM_ANDAMENTO'
                ? 'bg-info'
                : phase === 'ATENCAO'
                  ? 'bg-warn'
                  : phase === 'RESULTADO'
                    ? 'bg-accentText'
                    : 'bg-muted/50'
          return (
            <button
              key={item.symbol}
              type="button"
              onClick={() => data.setSelectedSymbol(item.symbol)}
              aria-pressed={active}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-medium transition-colors ${
                active
                  ? 'border-accent/40 bg-accent/[0.1] text-content'
                  : 'border-line bg-white/[0.02] text-muted hover:text-content'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
              {item.symbol}
            </button>
          )
        })}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-stretch">
        <div className="min-w-0 lg:col-span-8">
          <MarketChart
            tall
            symbol={asset.symbol}
            name={asset.name}
            decimals={asset.decimals}
            timeframe={data.selectedTimeframe}
            onTimeframeChange={data.setSelectedTimeframe}
            closed={data.chart.closed}
            marker={marker}
          />
        </div>
        <div className="min-w-0 lg:col-span-4">
          <SignalSummary analysis={selected} asset={asset} />
        </div>
      </div>

      <section aria-labelledby="recent-heading" className="surface mt-4 p-4 sm:p-5">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="eyebrow">Histórico do ativo</p>
            <h2
              id="recent-heading"
              className="mt-1 flex items-center gap-1.5 font-display text-base font-semibold tracking-tight"
            >
              <History className="h-4 w-4 text-muted" aria-hidden="true" />
              Operações detectadas
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              {data.assetHistory.length} registros no histórico retido
            </span>
            <button
              type="button"
              onClick={data.clearAssetHistory}
              disabled={data.assetHistory.length === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-white/[0.02] px-2 py-1 text-[8.5px] font-medium uppercase tracking-[0.06em] text-muted transition-colors hover:border-sell/30 hover:text-sell disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              Limpar Histórico
            </button>
          </div>
        </header>

        {recent.length === 0 ? (
          <p className="mt-3 rounded-xl border border-line bg-white/[0.02] px-3 py-4 text-[10.5px] leading-relaxed text-muted">
            Nenhum gatilho fechado para {asset.symbol} no histórico carregado. O motor segue
            observando regime, pullback e confirmação.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {recent.map((record) => {
              const change =
                record.exitPrice === null
                  ? null
                  : ((record.exitPrice - record.entryPrice) / record.entryPrice) * 100
              return (
                <li key={record.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-content">
                      <span className="font-mono text-[10px] text-muted">
                        {formatUnixDateTime(record.triggerTime)}
                      </span>
                      <span className="text-muted/60">·</span>
                      <span className="font-medium">
                        {record.direction === 'UP' ? 'Compra' : 'Venda'}
                      </span>
                      <span className="text-muted/60">·</span>
                      <span className="text-muted">Playbook {record.playbook}</span>
                    </p>
                    <p className="mt-0.5 font-mono text-[9.5px] tnum text-muted">
                      entrada {formatPrice(record.entryPrice, asset.decimals)}
                      {record.exitPrice !== null && (
                        <> · saída {formatPrice(record.exitPrice, asset.decimals)}</>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.08em] ${OUTCOME_CLASS[outcomeTone(record.outcome)]}`}
                    >
                      {outcomeLabel(record.outcome)}
                    </span>
                    {change !== null && (
                      <span
                        className={`font-mono text-[9.5px] tnum ${
                          change >= 0 ? 'text-buy' : 'text-sell'
                        }`}
                      >
                        {formatPercent(change)}
                      </span>
                    )}
                    <span className="sr-only">Direção {directionLabel(record.direction)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
