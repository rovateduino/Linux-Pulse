import { FlaskConical } from 'lucide-react'
import { DEFAULT_CONFIRM_N, DEFAULT_KILL_N, breakevenFor, evaluateEdge } from '../engine/edgeGate'
import { VERDICT_LABEL } from '../lib/edgeVerdict'
import { useLabStore } from '../stores/labStore'
import type { EdgeVerdictRecord, GateVerdict, GateVerdictKind } from '../types/edge'
import type { AssetAnalysis } from '../types/market'
import { GateVerdictBadge } from './lab/GateVerdictBadge'
import { useJournalStore } from '../store/journalStore'
import { usePlaybookDStore } from '../store/playbookDStore'
import { playbookDTradesCsv } from '../engine/playbooks/liveD'

const pctFormat = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

function pct(value: number): string {
  return `${pctFormat.format(value * 100)}%`
}

const VERDICT_DESCRIPTION: Record<GateVerdictKind, string> = {
  KILL: `Sem vantagem: a taxa de acerto fora da amostra ficou abaixo de p* - 2·SE com n≥${DEFAULT_KILL_N}. Estratégia eliminada pelo fail-fast.`,
  INCONCLUSIVE: `Veredito não emitido: a amostra ou a significância ainda não separam vantagem de ruído. KILL exige n≥${DEFAULT_KILL_N}; CONFIRM exige n≥${DEFAULT_CONFIRM_N} com acerto acima de p* + 3·SE.`,
  CONFIRM: `Edge confirmado: a taxa de acerto fora da amostra superou p* + 3·SE com n≥${DEFAULT_CONFIRM_N}.`,
}

/** Veredito representativo do painel: o de maior amostra (n) entre os resultados. */
function pickRepresentativeVerdict(
  verdicts: readonly EdgeVerdictRecord[],
): GateVerdict | null {
  if (verdicts.length === 0) return null
  const best = verdicts.reduce((current, candidate) =>
    candidate.n > current.n ? candidate : current,
  )
  return { kind: best.kind, reason: best.reason, n: best.n, winRate: best.winRate }
}

export function EdgeGateCard({ analysis }: { analysis?: AssetAnalysis }) {
  const results = useLabStore((state) => state.results)
  const verdicts = useLabStore((state) => state.verdicts)
  const payout = useLabStore((state) => state.config.payout)
  const minTrades = useJournalStore((state) => state.settings.minTradesPerBucket)
  const playbookDTrades = usePlaybookDStore((state) => state.trades)
  const stakeUsd = useJournalStore((state) => state.settings.stake)

  const tested = results.length > 0
  const maxN = tested ? Math.max(...results.map((result) => result.test.n)) : 0
  const verdict = pickRepresentativeVerdict(verdicts)
  const bestLow = tested ? Math.max(...results.map((result) => result.gate.low)) : null
  const breakeven = breakevenFor(payout)

  const description =
    verdict === null
      ? `Nenhum veredito emitido. O Edge Gate decide KILL com n≥${DEFAULT_KILL_N} e CONFIRM com n≥${DEFAULT_CONFIRM_N}.`
      : VERDICT_DESCRIPTION[verdict.kind]

  // Portfólio shadow do Playbook D (M15 + EMA200 H1) acumulado ao vivo.
  const settledD = playbookDTrades.filter((trade) => trade.outcome !== undefined)
  const dN = settledD.length
  const dWins = settledD.filter((trade) => trade.outcome === 'WIN').length
  const dWinRate = dN > 0 ? dWins / dN : 0
  const dVerdict = evaluateEdge({ n: dN, wins: dWins }, payout)
  const dBySymbol = new Map<string, { n: number; wins: number }>()
  for (const trade of settledD) {
    const entry = dBySymbol.get(trade.symbol) ?? { n: 0, wins: 0 }
    entry.n += 1
    if (trade.outcome === 'WIN') entry.wins += 1
    dBySymbol.set(trade.symbol, entry)
  }
  const dSymbols = [...dBySymbol.entries()].sort((a, b) => b[1].n - a[1].n)

  const exportPlaybookDTrades = () => {
    const csv = playbookDTradesCsv(playbookDTrades, stakeUsd)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `pulse-playbookD-shadow-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const openLab = () => {
    window.location.hash = '/laboratorio'
  }

  return (
    <section aria-labelledby="edge-gate-heading" className="surface relative overflow-hidden p-4 sm:p-5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-warn/[0.06] blur-2xl"
      />
      <header className="relative flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Validação</p>
          <h2
            id="edge-gate-heading"
            className="mt-1 flex items-center gap-1.5 font-display text-base font-semibold tracking-tight"
          >
            <FlaskConical className="h-4 w-4 text-warn" aria-hidden="true" />
            Edge Gate
          </h2>
        </div>
        {verdict !== null ? (
          <GateVerdictBadge verdict={verdict} payout={payout} />
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn/[0.07] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-warn">
            <FlaskConical className="h-3 w-3" aria-hidden="true" />
            Pendente
          </span>
        )}
      </header>

      <p className="relative mt-3 text-[12px] font-medium text-content">
        {verdict === null
          ? 'Sem validação estatística'
          : `${VERDICT_LABEL[verdict.kind]} no laboratório`}
      </p>
      <p className="relative mt-1 text-[10.5px] leading-relaxed text-muted">{description}</p>

      <div className="relative mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-line bg-white/[0.02] px-2.5 py-2">
          <p className="text-[8px] uppercase tracking-[0.1em] text-muted">Amostra OOS</p>
          <p className="mt-1 font-mono text-[13px] tnum text-content">
            {tested ? maxN : '0'}
            <span className="text-[9px] text-muted">/{DEFAULT_CONFIRM_N}</span>
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white/[0.02] px-2.5 py-2">
          <p className="text-[8px] uppercase tracking-[0.1em] text-muted">Breakeven</p>
          <p className="mt-1 font-mono text-[13px] tnum text-content">{pct(breakeven)}</p>
        </div>
        <div className="rounded-xl border border-line bg-white/[0.02] px-2.5 py-2">
          <p className="text-[8px] uppercase tracking-[0.1em] text-muted">Melhor IC inf.</p>
          <p className="mt-1 font-mono text-[13px] tnum text-muted">
            {bestLow !== null ? pct(bestLow) : '—'}
          </p>
        </div>
      </div>

      <div className="relative mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full ${tested ? 'bg-accent/80' : 'bg-warn/80'}`}
          style={{
            width: `${Math.max(2, Math.min(100, (maxN / DEFAULT_CONFIRM_N) * 100))}%`,
          }}
        />
      </div>

      {analysis?.engineError && (
        <p
          className="relative mt-3 rounded-lg border border-sell/30 bg-sell/[0.06] px-2.5 py-2 text-[10px] leading-relaxed text-sell"
          role="alert"
        >
          Análise interrompida: {analysis.engineError}
        </p>
      )}

      <div className="relative mt-4 border-t border-line pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-content">
            Playbook D · shadow M15 · portfólio
          </p>
          <GateVerdictBadge verdict={dVerdict} payout={payout} />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-line bg-white/[0.02] px-2.5 py-2">
            <p className="text-[8px] uppercase tracking-[0.1em] text-muted">Trades</p>
            <p className="mt-1 font-mono text-[13px] tnum text-content">
              {dN}
              <span className="text-[9px] text-muted">/{DEFAULT_CONFIRM_N}</span>
            </p>
          </div>
          <div className="rounded-xl border border-line bg-white/[0.02] px-2.5 py-2">
            <p className="text-[8px] uppercase tracking-[0.1em] text-muted">Win rate</p>
            <p className="mt-1 font-mono text-[13px] tnum text-content">
              {dN > 0 ? pct(dWinRate) : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-white/[0.02] px-2.5 py-2">
            <p className="text-[8px] uppercase tracking-[0.1em] text-muted">Veredito</p>
            <p className="mt-1 font-mono text-[11px] font-semibold tnum text-content">
              {VERDICT_LABEL[dVerdict.kind]}
            </p>
          </div>
        </div>
        <div className="relative mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-buy/80"
            style={{ width: `${Math.max(2, Math.min(100, (dN / DEFAULT_CONFIRM_N) * 100))}%` }}
          />
        </div>
        {dSymbols.length > 0 && (
          <ul className="mt-2 space-y-1">
            {dSymbols.map(([symbol, stats]) => (
              <li
                key={symbol}
                className="flex items-center justify-between rounded-lg border border-line bg-white/[0.02] px-2.5 py-1.5 text-[10px]"
              >
                <span className="font-semibold text-content">{symbol}</span>
                <span className="font-mono text-muted">
                  n {stats.n} · WR {stats.n > 0 ? pct(stats.wins / stats.n) : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-[9px] leading-relaxed text-muted">
            Trades shadow do Playbook D (M15, EMA200 H1, sessão London/NY) acumulados ao
            vivo em todos os ativos alimentados pela corretora. Nenhuma ordem é enviada.
          </p>
          <button
            type="button"
            onClick={exportPlaybookDTrades}
            disabled={playbookDTrades.length === 0}
            className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-content transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Exportar CSV
          </button>
        </div>
      </div>

      {analysis?.nextEvaluation && (
        <div className="relative mt-4 border-t border-line pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-content">
              Candidatos shadow · {analysis.symbol} · M{analysis.nextEvaluation.context.timeframeMinutes}
            </p>
            <p className="font-mono text-[9px] text-muted">
              sessão {analysis.nextEvaluation.context.sessionId}
            </p>
          </div>
          <p className="mt-1 text-[9px] leading-relaxed text-warn">
            Somente validação: estes resultados não alimentam o Auto-Trade. O custo está marcado como
            não calibrado por padrão e mantém o gate bloqueado.
          </p>
          {analysis.nextEvaluation.candidates.length === 0 ? (
            <p className="mt-2 text-[10px] text-muted">
              Nenhum setup candidato neste candle fechado. Isso não é uma aprovação de edge.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {analysis.nextEvaluation.candidates.map(
                ({ candidate, decision, statisticalAllowed }) => (
                <li
                  key={`${candidate.moduleId}:${candidate.bucket}`}
                  className="rounded-lg border border-line bg-white/[0.02] px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold text-content">
                      {candidate.moduleId} · {candidate.direction === 'long' ? 'CALL' : 'PUT'}
                    </span>
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase ${
                        statisticalAllowed
                          ? 'border-buy/25 bg-buy/[0.06] text-buy'
                          : 'border-warn/25 bg-warn/[0.06] text-warn'
                      }`}
                    >
                      {statisticalAllowed
                        ? 'Gate estatístico aprova · execução bloqueada'
                        : 'Gate bloqueado'}
                    </span>
                  </div>
                  <p className="mt-1 break-all font-mono text-[8px] text-muted">
                    bucket {candidate.bucket}
                  </p>
                  <div className="mt-1 grid grid-cols-4 gap-1 text-[8px] text-muted">
                    <span>Acerto {pct(decision.probability)}</span>
                    <span>EV/stake {pct(decision.expectancyR)}</span>
                    <span>n {decision.sampleSize}/{minTrades}</span>
                    <span>BE {pct(decision.breakeven)}</span>
                  </div>
                  {decision.reasons.length > 0 && (
                    <p className="mt-1 text-[9px] leading-relaxed text-muted">
                      {decision.reasons.join(' · ')}
                    </p>
                  )}
                </li>
                ),
              )}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={openLab}
        className="relative mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-accent/30 bg-accent/[0.1] px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-accentText transition-colors hover:bg-accent/[0.16]"
      >
        <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
        {tested ? 'Ver resultados no Laboratório' : 'Abrir Laboratório'}
      </button>
    </section>
  )
}
