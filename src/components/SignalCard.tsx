import type { CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  LoaderCircle,
  Minus,
  ShieldCheck,
  Sparkles,
  Timer,
} from 'lucide-react'
import type { AssetAnalysis, AssetDef, Candle } from '../types/market'
import { withAlpha } from '../lib/palette'
import { formatPercent, formatPrice, formatUnixDateTime } from '../lib/format'
import {
  directionLabel,
  phaseLabel,
  playbookLabel,
  regimeLabel,
  signalTone,
  verdictLabel,
} from '../lib/signalMeta'
import { useJournalStore } from '../store/journalStore'
import { useLabStore } from '../stores/labStore'
import { EDGE_STATUS_LABEL } from '../lib/edgeBadge'
import { EDGE_MIN_SAMPLE } from '../engine/edgeGate'
import { SIGNAL_TONES } from './ui/tones'

interface SignalCardProps {
  analysis: AssetAnalysis
  asset: AssetDef
  forming: Candle | null
  progress: number
  secondsLeft: number
  ringLabel: string
  timeframeLabel: string
  radarCount: number
  awaitingHistory: boolean
  devForcedSignal: boolean
}

export function SignalCard({
  analysis,
  asset,
  forming,
  progress,
  secondsLeft,
  ringLabel,
  timeframeLabel,
  radarCount,
  awaitingHistory,
  devForcedSignal,
}: SignalCardProps) {
  const settings = useJournalStore((state) => state.settings)
  const labResults = useLabStore((state) => state.results)
  const { signal, regime } = analysis
  const labResult = labResults.find(
    (result) => result.symbol === asset.symbol && result.timeframe === '5m',
  )
  const labValidated = labResult?.gate.status === 'VALIDADO'
  const tone = SIGNAL_TONES[signalTone(signal)]
  const isEntry = signal.phase === 'ENTRAR'
  const isLive = isEntry || signal.phase === 'EM_ANDAMENTO'
  const record = signal.active ?? (signal.phase === 'RESULTADO' ? signal.lastResult : null)
  const lastClosed = analysis.closed[analysis.closed.length - 1]
  const price = forming?.close ?? lastClosed?.close ?? 0
  const referenceIndex = Math.max(0, analysis.closed.length - 1 - analysis.changeWindow)
  const reference = analysis.closed[referenceIndex]?.close ?? price
  const changePct = reference > 0 ? ((price - reference) / reference) * 100 : 0
  const changeUp = changePct >= 0
  const metConditions = signal.conditions.filter((condition) => condition.met).length
  const closedSamples = analysis.records.filter((item) => item.outcome !== null).length
  const confidenceSample = labResult !== undefined ? labResult.gate.n : closedSamples
  const confidenceLabel =
    labResult !== undefined ? EDGE_STATUS_LABEL[labResult.gate.status] : 'N/D'

  const radius = 47
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - Math.min(1, Math.max(0, progress)))

  const glowStyle: CSSProperties & Record<'--signal-glow' | '--signal-border', string> = {
    '--signal-glow': tone.glow,
    '--signal-border': withAlpha(tone.stroke, 0.38),
  }

  const regimeClass =
    regime.kind === 'TENDENCIA'
      ? 'border-buy/25 bg-buy/[0.06] text-buy'
      : regime.kind === 'LATERAL'
        ? 'border-warn/25 bg-warn/[0.06] text-warn'
        : 'border-line bg-white/[0.02] text-muted'

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      data-active={isLive}
      style={glowStyle}
      aria-labelledby="signal-heading"
      className="surface signal-card relative flex h-full flex-col overflow-hidden p-5 [container-type:inline-size] sm:p-6"
    >
      {isLive && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full opacity-70 blur-3xl"
            style={{ backgroundColor: tone.glow }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
          />
        </>
      )}

      <div className="relative z-10 flex h-full flex-col">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow flex flex-wrap items-center gap-2">
              <span>Sinal · ativo em foco</span>
              <motion.span
                key={analysis.lastClosedTime ?? 0}
                initial={{ scale: 1.7, opacity: 0.35 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="h-1.5 w-1.5 rounded-full bg-buy"
                aria-hidden="true"
              />
              <span className="font-mono text-[9px] normal-case tracking-normal text-muted/80">{timeframeLabel}</span>
              <span className="text-[9px] normal-case tracking-normal text-muted/60">
                Radar ativo: analisando {radarCount} ativos
              </span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <h2 id="signal-heading" className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                {asset.symbol}
              </h2>
              <span className="text-[11px] text-muted">{asset.name}</span>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${regimeClass}`}
              >
                {regimeLabel(regime.kind)}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              title={labResult?.gate.reason}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] ${
                labValidated
                  ? 'border-buy/30 bg-buy/[0.08] text-buy'
                  : 'border-warn/30 bg-warn/[0.08] text-warn'
              }`}
            >
              {labValidated ? (
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Sparkles className="h-3 w-3" aria-hidden="true" />
              )}
              {labValidated ? 'Validado no teste' : 'Experimental'}
            </span>
            {signal.pausedUntil !== null && (
              <span className="inline-flex items-center gap-1 rounded-full border border-line bg-white/[0.03] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-muted">
                Pausado
              </span>
            )}
          </div>
        </header>

        {awaitingHistory && (
          <p
            role="status"
            className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-white/[0.02] px-2.5 py-2 text-[10px] leading-relaxed text-muted"
          >
            <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" aria-hidden="true" />
            Carregando dados... aguardando o histórico de candles da corretora.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <p className="font-mono text-xl font-medium tnum text-content">
            {formatPrice(price, asset.decimals)}
          </p>
          <p
            className={`flex items-center gap-1.5 font-mono text-[11px] tnum ${
              changeUp ? 'text-buy' : 'text-sell'
            }`}
          >
            {changeUp ? (
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
            )}
            {formatPercent(changePct)}
            <span className="text-muted">· {analysis.changeWindow} velas</span>
          </p>
        </div>

        <div className="mt-5 flex items-center gap-3 sm:gap-5">
          <div className="relative h-[88px] w-[88px] shrink-0 sm:h-[116px] sm:w-[116px]">
            <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90" aria-hidden="true">
              <circle cx="56" cy="56" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
              <circle
                cx="56"
                cy="56"
                r={radius}
                fill="none"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{ stroke: tone.stroke }}
                className="transition-[stroke-dashoffset] duration-200 ease-linear"
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center">
              <div className="text-center">
                <p className="font-mono text-2xl font-semibold leading-none tnum">
                  {secondsLeft}
                  <span className="ml-0.5 text-[10px] font-normal text-muted">s</span>
                </p>
                <p className="mt-1.5 flex items-center justify-center gap-1 text-[8px] uppercase tracking-[0.14em] text-muted">
                  <Timer className="h-2.5 w-2.5" aria-hidden="true" />
                  {ringLabel}
                </p>
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${tone.chip}`}
              >
                {signal.direction !== null ? (
                  signal.direction === 'UP' ? (
                    <ArrowUpRight className="h-2.5 w-2.5" aria-hidden="true" />
                  ) : (
                    <ArrowDownRight className="h-2.5 w-2.5" aria-hidden="true" />
                  )
                ) : (
                  <CircleAlert className="h-2.5 w-2.5" aria-hidden="true" />
                )}
                {phaseLabel(signal)}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                {directionLabel(signal.direction)}
              </span>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={`${signal.phase}-${signal.direction ?? 'none'}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className={`mt-1 font-display text-[clamp(1.35rem,7.5vw,3.5rem)] font-bold leading-[0.94] tracking-[-0.04em] lg:text-[2.25rem] xl:text-[3.5rem] ${tone.text}`}
              >
                {verdictLabel(signal)}
              </motion.p>
            </AnimatePresence>

            {!awaitingHistory && (
              <p className="mt-2 max-w-sm text-[11px] leading-relaxed text-muted">{signal.note}</p>
            )}
          </div>
        </div>

        {record !== null && (
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-line bg-white/[0.02] px-3 py-2.5">
            <div>
              <p className="text-[8px] uppercase tracking-[0.1em] text-muted">Entrada</p>
              <p className="mt-0.5 font-mono text-[10px] tnum text-content">
                {formatPrice(record.entryPrice, asset.decimals)}
              </p>
              <p className="mt-0.5 font-mono text-[8.5px] tnum text-muted/80">
                {formatUnixDateTime(record.entryTime)}
              </p>
            </div>
            <div>
              <p className="text-[8px] uppercase tracking-[0.1em] text-muted">Expira</p>
              <p className="mt-0.5 font-mono text-[10px] tnum text-content">
                {record.outcome === null ? 'em aberto' : 'apurado'}
              </p>
              <p className="mt-0.5 font-mono text-[8.5px] tnum text-muted/80">
                {formatUnixDateTime(record.expiresAt)}
              </p>
            </div>
            <div>
              <p className="text-[8px] uppercase tracking-[0.1em] text-muted">Saída</p>
              <p
                className={`mt-0.5 font-mono text-[10px] tnum ${
                  record.exitPrice === null
                    ? 'text-muted'
                    : record.exitPrice >= record.entryPrice
                      ? 'text-buy'
                      : 'text-sell'
                }`}
              >
                {record.exitPrice === null ? '—' : formatPrice(record.exitPrice, asset.decimals)}
              </p>
              {record.exitPrice !== null && (
                <p className="mt-0.5 font-mono text-[8.5px] tnum text-muted/80">
                  {formatPercent(((record.exitPrice - record.entryPrice) / record.entryPrice) * 100)}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-3 rounded-2xl border border-line bg-white/[0.02] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">Leitura do setup</p>
            <span className="text-right font-mono text-[9px] text-muted">
              {metConditions}/{signal.conditions.length} ·{' '}
              {devForcedSignal ? 'Sinal Free · teste' : playbookLabel(signal.playbook)}
            </span>
          </div>
          <ul className="mt-2.5 grid grid-cols-1 gap-x-3 gap-y-1.5 min-[360px]:grid-cols-2 min-[360px]:gap-y-2">
            {signal.conditions.map((condition) => (
              <li key={condition.label} className="flex items-start gap-1.5 text-[10.5px] leading-snug">
                <span
                  className={`mt-px grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full ${
                    condition.met ? 'bg-buy/10 text-buy' : 'bg-white/[0.04] text-muted/60'
                  }`}
                >
                  {condition.met ? (
                    <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
                  ) : (
                    <Minus className="h-2.5 w-2.5" aria-hidden="true" />
                  )}
                </span>
                <span className={condition.met ? 'text-content/80' : 'text-muted'}>{condition.label}</span>
              </li>
            ))}
          </ul>
          {signal.blockedBy.length > 0 && (
            <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-warn/20 bg-warn/[0.05] px-2.5 py-2 text-[10px] leading-relaxed text-warn">
              <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {signal.blockedBy[0]}
            </p>
          )}
        </div>

        <div className="mt-3 rounded-2xl border border-line bg-white/[0.02] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">Confiança estatística</p>
            <span className="font-mono text-[11px] text-content">
              {confidenceLabel}{' '}
              <span className="text-muted">
                · amostra {confidenceSample}/{EDGE_MIN_SAMPLE}
              </span>
            </span>
          </div>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-warn/80"
              style={{
                width: `${Math.max(2, Math.min(100, (confidenceSample / EDGE_MIN_SAMPLE) * 100))}%`,
              }}
            />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted">
            {labResult !== undefined
              ? `Backtest fora da amostra: ${EDGE_STATUS_LABEL[labResult.gate.status]} com n=${labResult.gate.n}. O selo VALIDADO exige n≥${EDGE_MIN_SAMPLE} e IC95% acima do breakeven.`
              : `Nenhum setup recebe selo VALIDADO antes do Edge Gate com n≥${EDGE_MIN_SAMPLE} fora da amostra.`}
          </p>
        </div>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
          <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-muted">
            <ShieldCheck className="h-3 w-3 text-buy/80" aria-hidden="true" />
            Resultado informativo do sinal · envio externo exige Auto-Trade
          </p>
          <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted/70">
            stake {settings.stake.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })} ·
            payout {(settings.payout * 100).toFixed(0)}% · sem slippage
          </p>
        </footer>
      </div>
    </motion.article>
  )
}
