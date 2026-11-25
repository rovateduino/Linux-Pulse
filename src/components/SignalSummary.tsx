import { CircleAlert, ShieldCheck, Timer } from 'lucide-react'
import type { AssetAnalysis, AssetDef, IndicatorSnapshot } from '../types/market'
import { formatPercent, formatPrice, formatUnixDateTime } from '../lib/format'
import {
  directionLabel,
  outcomeLabel,
  outcomeTone,
  phaseLabel,
  playbookLabel,
  signalTone,
  verdictLabel,
} from '../lib/signalMeta'
import { SIGNAL_TONES } from './ui/tones'

interface SignalSummaryProps {
  analysis: AssetAnalysis
  asset: AssetDef
}

const OUTCOME_CHIP = {
  buy: 'border-buy/30 bg-buy/[0.08] text-buy',
  sell: 'border-sell/30 bg-sell/[0.08] text-sell',
  warn: 'border-warn/30 bg-warn/[0.08] text-warn',
  idle: 'border-line bg-white/[0.03] text-muted',
} as const

function indicatorRows(values: IndicatorSnapshot, decimals: number) {
  const money = (value: number | null) => (value === null ? '—' : formatPrice(value, decimals))
  const number = (value: number | null, digits = 1) =>
    value === null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: digits })
  return [
    { label: 'EMA20', value: money(values.ema20) },
    { label: 'EMA50', value: money(values.ema50) },
    { label: 'EMA200', value: money(values.ema200) },
    { label: 'ATR14', value: money(values.atr) },
    { label: 'ADX14', value: number(values.adx) },
    { label: 'RSI14', value: number(values.rsi) },
    { label: 'Banda %il', value: values.bandwidthPct === null ? '—' : `${number(values.bandwidthPct, 0)}%` },
    { label: 'Slope/ATR', value: number(values.slope, 2) },
  ]
}

export function SignalSummary({ analysis, asset }: SignalSummaryProps) {
  const { signal, regime } = analysis
  const tone = SIGNAL_TONES[signalTone(signal)]
  const record = signal.active ?? (signal.phase === 'RESULTADO' ? signal.lastResult : null)
  const rows = indicatorRows(analysis.indicators, asset.decimals)

  return (
    <section aria-labelledby="signal-summary-heading" className="surface flex h-full flex-col p-4 sm:p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Leitura do sinal</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <h2
              id="signal-summary-heading"
              className="font-display text-base font-semibold tracking-tight"
            >
              {asset.symbol}
            </h2>
            <span className="text-[10px] text-muted">{asset.name}</span>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] ${tone.chip}`}
        >
          {phaseLabel(signal)}
        </span>
      </header>

      <p className={`mt-3 font-display text-2xl font-bold tracking-[-0.03em] ${tone.text}`}>
        {verdictLabel(signal)}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">{signal.note}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5 text-[10px]">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted">Direção</dt>
          <dd className="font-medium text-content">{directionLabel(signal.direction)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted">Regime</dt>
          <dd className="font-medium text-content">
            {regime.kind === 'TENDENCIA' ? 'Tendência' : regime.kind === 'LATERAL' ? 'Lateral' : 'Sem regime'}
          </dd>
        </div>
        <div className="col-span-2 flex items-center justify-between gap-2 border-t border-line pt-2">
          <dt className="text-muted">Playbook</dt>
          <dd className="text-right font-medium text-content">{playbookLabel(signal.playbook)}</dd>
        </div>
      </dl>

      {record !== null && (
        <div className="mt-3 rounded-xl border border-line bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">Resultado do sinal</p>
            {record.outcome !== null ? (
              <span
                className={`rounded-full border px-2 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.08em] ${OUTCOME_CHIP[outcomeTone(record.outcome)]}`}
              >
                {outcomeLabel(record.outcome)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[9px] text-muted">
                <Timer className="h-2.5 w-2.5" aria-hidden="true" />
                aguardando fechamento
              </span>
            )}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10px] tnum">
            <div>
              <dt className="text-[8px] uppercase tracking-[0.1em] text-muted">Entrada</dt>
              <dd className="mt-0.5 text-content">
                {formatPrice(record.entryPrice, asset.decimals)}
                <span className="ml-1 text-[8.5px] text-muted">{formatUnixDateTime(record.entryTime)}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[8px] uppercase tracking-[0.1em] text-muted">Expira</dt>
              <dd className="mt-0.5 text-content">{formatUnixDateTime(record.expiresAt)}</dd>
            </div>
            {record.exitPrice !== null && (
              <div className="col-span-2 border-t border-line pt-2">
                <dt className="text-[8px] uppercase tracking-[0.1em] text-muted">Saída</dt>
                <dd className="mt-0.5 text-content">
                  {formatPrice(record.exitPrice, asset.decimals)}
                  <span
                    className={`ml-2 ${
                      record.exitPrice >= record.entryPrice ? 'text-buy' : 'text-sell'
                    }`}
                  >
                    {formatPercent(((record.exitPrice - record.entryPrice) / record.entryPrice) * 100)}
                  </span>
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {signal.pausedUntil !== null && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-warn/25 bg-warn/[0.05] px-2.5 py-2 text-[10px] leading-relaxed text-warn">
          <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          Pausa pós-perdas ativa até {formatUnixDateTime(signal.pausedUntil)}.
        </p>
      )}

      <div className="mt-3">
        <p className="eyebrow">Indicadores no candle fechado</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[9.5px] tnum">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-2">
              <dt className="text-muted">{row.label}</dt>
              <dd className="text-content">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-3">
        <p className="eyebrow">Condições do setup</p>
        <ul className="mt-2 space-y-1">
          {signal.conditions.map((condition) => (
            <li key={condition.label} className="flex items-center gap-2 text-[10px]">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  condition.met ? 'bg-buy' : 'bg-white/20'
                }`}
                aria-hidden="true"
              />
              <span className={condition.met ? 'text-content/85' : 'text-muted'}>
                {condition.label}
              </span>
              <span className="sr-only">{condition.met ? 'atendida' : 'pendente'}</span>
            </li>
          ))}
        </ul>
      </div>

      <footer className="mt-auto flex items-center gap-1.5 border-t border-line pt-3 text-[9px] text-muted">
        <ShieldCheck className="h-3 w-3 text-buy/80" aria-hidden="true" />
        Sinal local apenas em candle fechado · não representa uma ordem executada
      </footer>
    </section>
  )
}
