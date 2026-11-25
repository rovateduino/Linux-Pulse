import { useId } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { LAB_TIMEFRAME_LABEL } from '../../data/assets'
import { PALETTE } from '../../lib/palette'
import { formatSignedUsd, formatUnixDateTime, formatUsd } from '../../lib/format'
import type { BacktestResult } from '../../types/lab'

const WIDTH = 640
const HEIGHT = 200
const PAD_X = 10
const PAD_Y = 16

export function EquityCurve({ result }: { result: BacktestResult }) {
  const gradientId = `equity-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const points = result.test.equity
  const label = `Playbook ${result.playbook} · ${result.symbol} · ${LAB_TIMEFRAME_LABEL[result.timeframe]}`
  const finalValue = points.length > 0 ? points[points.length - 1].value : 0
  const positive = finalValue >= 0
  const lineColor = positive ? PALETTE.buy : PALETTE.sell

  const values = points.map((point) => point.value)
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const span = max - min || 1
  const x = (index: number) =>
    PAD_X + (points.length <= 1 ? 0 : (index / (points.length - 1)) * (WIDTH - PAD_X * 2))
  const y = (value: number) =>
    PAD_Y + (1 - (value - min) / span) * (HEIGHT - PAD_Y * 2)

  const line =
    points.length > 1
      ? points
          .map(
            (point, index) =>
              `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`,
          )
          .join(' ')
      : ''
  const area =
    points.length > 1
      ? `${line} L${x(points.length - 1).toFixed(2)},${y(0).toFixed(2)} L${x(0).toFixed(2)},${y(0).toFixed(2)} Z`
      : ''
  const firstTime = points.length > 0 ? points[0].time : null
  const lastTime = points.length > 0 ? points[points.length - 1].time : null

  return (
    <section aria-labelledby="lab-equity-heading" className="surface p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="eyebrow">Curva de capital</p>
          <h2
            id="lab-equity-heading"
            className="mt-1 font-display text-base font-semibold tracking-tight"
          >
            {label}
          </h2>
          <p className="mt-0.5 text-[9.5px] text-muted">
            Teste fora da amostra · {result.test.n} operações · stake fixo
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 font-mono text-[10px] tnum ${
              positive
                ? 'border-buy/30 bg-buy/[0.07] text-buy'
                : 'border-sell/30 bg-sell/[0.07] text-sell'
            }`}
          >
            {positive ? (
              <TrendingUp className="h-3 w-3" aria-hidden="true" />
            ) : (
              <TrendingDown className="h-3 w-3" aria-hidden="true" />
            )}
            {formatSignedUsd(finalValue)}
          </span>
          <span className="rounded-full border border-line bg-white/[0.02] px-2 py-1 font-mono text-[9px] text-muted">
            DD máx {formatUsd(result.test.maxDrawdown)}
          </span>
        </div>
      </header>

      {points.length > 1 ? (
        <div className="mt-3">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`Curva de capital de ${label} no teste fora da amostra, resultado ${formatSignedUsd(finalValue)} em ${result.test.n} operações.`}
            className="h-[190px] w-full"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity="0.22" />
                <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
              </linearGradient>
            </defs>
            <line
              x1={PAD_X}
              x2={WIDTH - PAD_X}
              y1={y(0)}
              y2={y(0)}
              stroke="rgba(255,255,255,0.14)"
              strokeDasharray="3 4"
            />
            <path d={area} fill={`url(#${gradientId})`} />
            <path
              d={line}
              fill="none"
              stroke={lineColor}
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          <div className="mt-1 flex justify-between gap-2 font-mono text-[8.5px] tnum text-muted/80">
            <span>{firstTime !== null ? formatUnixDateTime(firstTime) : '—'}</span>
            <span className="uppercase tracking-[0.08em]">PnL acumulado · US$</span>
            <span>{lastTime !== null ? formatUnixDateTime(lastTime) : '—'}</span>
          </div>
        </div>
      ) : (
        <p className="mt-3 rounded-xl border border-line bg-white/[0.02] px-3 py-4 text-center text-[10.5px] text-muted">
          Amostra de teste insuficiente para desenhar a curva. O Edge Gate continua usando n e IC95%.
        </p>
      )}

      <p className="mt-2 text-[9.5px] leading-relaxed text-muted">
        Resultado acumulado por operação encerrada, sem juros compostos. A curva é apenas descritiva;
        o Edge Gate decide com n, IC95% de Wilson e breakeven.
      </p>
    </section>
  )
}
