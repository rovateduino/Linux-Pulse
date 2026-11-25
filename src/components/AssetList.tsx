import { ArrowDownRight, ArrowUpRight, Check, CircleDot } from 'lucide-react'
import type { AssetAnalysis, AssetDef, Candle, RegimeKind } from '../types/market'
import type { AvailableAsset } from '../types/liveBot'
import { PALETTE } from '../lib/palette'
import { formatPercent, formatPrice } from '../lib/format'
import { phaseLabel, regimeLabel } from '../lib/signalMeta'

interface AssetListProps {
  assets: readonly AssetDef[]
  analyses: Record<string, AssetAnalysis>
  availableAssets: readonly AvailableAsset[]
  selectedSymbol: string
  timeframeLabel: string
  onSelect: (symbol: string) => void
}

interface AssetListRow {
  symbol: string
  asset: AssetDef | undefined
  analysis: AssetAnalysis | undefined
  status: AvailableAsset | undefined
}

interface AnalyzedAvailableAsset {
  symbol: string
  asset: AssetDef
  analysis: AssetAnalysis
  status: AvailableAsset
}

function regimeShort(kind: RegimeKind): string {
  if (kind === 'TENDENCIA') return 'TEND.'
  if (kind === 'LATERAL') return 'LATERAL'
  return 'SEM'
}

function regimeClass(kind: RegimeKind): string {
  if (kind === 'TENDENCIA') return 'border-buy/25 bg-buy/[0.06] text-buy'
  if (kind === 'LATERAL') return 'border-warn/25 bg-warn/[0.06] text-warn'
  return 'border-line bg-white/[0.02] text-muted'
}

function Sparkline({ candles, up }: { candles: readonly Candle[]; up: boolean }) {
  const values = candles.slice(-24).map((candle) => candle.close)
  if (values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 64
      const y = 21 - ((value - min) / span) * 18
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg viewBox="0 0 64 24" className="hidden h-6 w-14 shrink-0 min-[380px]:block" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={up ? PALETTE.buy : PALETTE.sell}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
    </svg>
  )
}

export function AssetList({
  assets,
  analyses,
  availableAssets,
  selectedSymbol,
  timeframeLabel,
  onSelect,
}: AssetListProps) {
  const assetBySymbol = new Map(assets.map((asset) => [asset.symbol, asset]))
  const statusBySymbol = new Map(availableAssets.map((asset) => [asset.symbol, asset]))
  const symbols = [
    ...assets.map((asset) => asset.symbol),
    ...availableAssets
      .map((asset) => asset.symbol)
      .filter((symbol) => !assetBySymbol.has(symbol)),
  ]
  const list: AssetListRow[] = symbols.map((symbol) => ({
    symbol,
    asset: assetBySymbol.get(symbol),
    analysis: analyses[symbol],
    status: statusBySymbol.get(symbol),
  }))
  const openWithAnalysis = list.filter(
    (entry): entry is AnalyzedAvailableAsset =>
      entry.status?.available === true && entry.asset !== undefined && entry.analysis !== undefined,
  )
  const openCount = list.filter((entry) => entry.status?.available === true).length
  const counts = openWithAnalysis.reduce<Record<RegimeKind, number>>(
    (total, entry) => {
      total[entry.analysis.regime.kind] += 1
      return total
    },
    { TENDENCIA: 0, LATERAL: 0, SEM_REGIME: 0 },
  )

  return (
    <section
      aria-labelledby="market-list-heading"
      className="surface flex h-full flex-col p-4 sm:p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Mercado</p>
          <h2 id="market-list-heading" className="mt-1 font-display text-base font-semibold tracking-tight">
            Ativos monitorados
          </h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-[9px] uppercase tracking-[0.1em] text-muted">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-buy" aria-hidden="true" />
          {openCount}/{list.length} abertos · {timeframeLabel}
        </span>
      </header>

      <div className="mt-3.5 space-y-1">
        {list.map(({ symbol, asset, analysis, status }) => {
          const available = status?.available === true
          const local = asset !== undefined && analysis !== undefined
            ? { asset, analysis }
            : undefined
          const selectable = available && local !== undefined
          const selected = symbol === selectedSymbol
          const up = (local?.analysis.changePct ?? 0) >= 0
          const phase = selectable ? local.analysis.signal.phase : null
          const phaseClass =
            phase === 'ENTRAR'
              ? local?.analysis.signal.direction === 'DOWN'
                ? 'text-sell'
                : 'text-buy'
              : phase === 'ATENCAO'
                ? 'text-warn'
                : available
                  ? 'text-muted'
                  : 'text-muted/45'
          const dotClass =
            phase === 'ENTRAR'
              ? local?.analysis.signal.direction === 'DOWN'
                ? 'bg-sell'
                : 'bg-buy'
              : phase === 'ATENCAO'
                ? 'bg-warn'
                : available
                  ? 'bg-muted/50'
                  : 'bg-muted/25'

          return (
            <button
              key={symbol}
              type="button"
              disabled={!selectable}
              aria-current={selected && selectable ? 'true' : undefined}
              aria-disabled={!selectable}
              onClick={() => onSelect(symbol)}
              className={`group relative flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                !selectable
                  ? 'cursor-not-allowed border-transparent text-muted/45'
                  : selected
                  ? 'border-accent/40 bg-accent/[0.08]'
                  : 'border-transparent hover:border-line hover:bg-white/[0.025]'
              }`}
            >
              {selected && selectable && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-2.5 left-0 w-[3px] rounded-full bg-accent"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`font-display text-[12px] font-semibold tracking-[0.04em] ${
                    available ? 'text-content' : 'text-muted/45'
                  }`}>
                    {symbol}
                  </span>
                  {selectable && local !== undefined && (
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.06em] ${regimeClass(
                        local.analysis.regime.kind,
                      )}`}
                      title={regimeLabel(local.analysis.regime.kind)}
                    >
                      {regimeShort(local.analysis.regime.kind)}
                    </span>
                  )}
                  {selected && selectable && (
                    <>
                      <Check className="h-3 w-3 text-accent" aria-hidden="true" />
                      <span className="sr-only">(selecionado)</span>
                    </>
                  )}
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-[9.5px]">
                  {!available ? (
                    <span className="font-medium text-muted/45">Indisponível</span>
                  ) : local !== undefined ? (
                    <>
                      <span className={`h-1 w-1 rounded-full ${dotClass}`} aria-hidden="true" />
                      <span className={`font-medium uppercase tracking-[0.06em] ${phaseClass}`}>
                        {phaseLabel(local.analysis.signal)}
                      </span>
                      <span className="text-muted/60">· {local.asset.name}</span>
                    </>
                  ) : (
                    <span className="font-medium text-muted/45">Disponível · sem sinal local</span>
                  )}
                </p>
              </div>

              {selectable && local !== undefined && (
                <Sparkline candles={local.analysis.closed} up={up} />
              )}

              <div className="shrink-0 text-right">
                {!available ? (
                  <p className="font-mono text-[10px] text-muted/45">Indisponível</p>
                ) : local !== undefined ? (
                  <>
                    <p className="font-mono text-[11px] tnum text-content">
                      {formatPrice(
                        local.analysis.closed[local.analysis.closed.length - 1]?.close ?? 0,
                        local.asset.decimals,
                      )}
                    </p>
                    <p
                      className={`mt-0.5 flex items-center justify-end gap-0.5 font-mono text-[9.5px] tnum ${
                        up ? 'text-buy' : 'text-sell'
                      }`}
                    >
                      {up ? (
                        <ArrowUpRight className="h-2.5 w-2.5" aria-hidden="true" />
                      ) : (
                        <ArrowDownRight className="h-2.5 w-2.5" aria-hidden="true" />
                      )}
                      {formatPercent(local.analysis.changePct)}
                    </p>
                  </>
                ) : (
                  <p className="font-mono text-[10px] text-muted">
                    Payout {status?.payout ?? '—'}%
                  </p>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-auto border-t border-line pt-3.5">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Distribuição de regime</p>
          <span className="font-mono text-[9px] text-muted">{timeframeLabel} · {openWithAnalysis.length} com sinal local</span>
        </div>
        <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
          {openWithAnalysis.length > 0 && counts.TENDENCIA > 0 && (
            <span className="h-full bg-buy/80" style={{ width: `${(counts.TENDENCIA / openWithAnalysis.length) * 100}%` }} />
          )}
          {openWithAnalysis.length > 0 && counts.LATERAL > 0 && (
            <span className="h-full bg-warn/80" style={{ width: `${(counts.LATERAL / openWithAnalysis.length) * 100}%` }} />
          )}
          {openWithAnalysis.length > 0 && counts.SEM_REGIME > 0 && (
            <span
              className="h-full bg-white/20"
              style={{ width: `${(counts.SEM_REGIME / openWithAnalysis.length) * 100}%` }}
            />
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-muted">
          <span className="flex items-center gap-1">
            <CircleDot className="h-2.5 w-2.5 text-buy" aria-hidden="true" />
            Tendência {counts.TENDENCIA}
          </span>
          <span className="flex items-center gap-1">
            <CircleDot className="h-2.5 w-2.5 text-warn" aria-hidden="true" />
            Lateral {counts.LATERAL}
          </span>
          <span className="flex items-center gap-1">
            <CircleDot className="h-2.5 w-2.5 text-muted" aria-hidden="true" />
            Sem regime {counts.SEM_REGIME}
          </span>
        </div>
      </div>
    </section>
  )
}
