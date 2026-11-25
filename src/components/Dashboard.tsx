import { useEffect, useMemo, useRef, useState } from 'react'
import { Flame, Pause, RefreshCw, ShieldAlert } from 'lucide-react'
import { useMarketData } from '../hooks/useMarketData'
import { sendStrategyEvaluation, sendTradeCommand } from '../hooks/useLiveBot'
import { useJournalStore } from '../store/journalStore'
import {
  MAX_ORDERS_PER_HOUR,
  recentOrderTimestamps,
  useLabStore,
} from '../stores/labStore'
import { TIMEFRAME_LABEL } from '../data/assets'
import type { AssetAnalysis, Timeframe } from '../types/market'
import type { RealSeries } from '../store/marketStore'
import type { LiveAutoOrder, LiveBotSession } from '../types/liveBot'
import { formatSignedUsd } from '../lib/format'
import { AssetList } from './AssetList'
import { Disclaimer } from './Disclaimer'
import { LiveBotStatus } from './LiveBotStatus'
import { SignalCard } from './SignalCard'
import { EdgeGateCard } from './EdgeGateCard'

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m']
const RADAR_CYCLE_MS = 60_000
const MANUAL_PAUSE_MS = 5 * 60_000
const RADAR_MIN_CANDLES = 200

function radarScore(analysis: AssetAnalysis | undefined): number {
  if (analysis === undefined) return -1
  const phase = analysis.signal.phase
  const rank = phase === 'ENTRAR' ? 2 : phase === 'ATENCAO' ? 1 : 0
  const met = analysis.signal.conditions.filter((condition) => condition.met).length
  return rank * 100 + met
}

function hasRadarHistory(realSeries: RealSeries, symbol: string): boolean {
  return (realSeries[symbol]?.M1?.length ?? 0) >= RADAR_MIN_CANDLES
}

function randomOtherSymbol(symbols: readonly string[], current: string): string | null {
  const options = symbols.filter((symbol) => symbol !== current)
  if (options.length === 0) return symbols[0] ?? null
  return options[Math.floor(Math.random() * options.length)]
}

function nextRadarSymbol(symbols: readonly string[], current: string): string | null {
  if (symbols.length === 0) return null
  const index = symbols.indexOf(current)
  return symbols[(index + 1 + symbols.length) % symbols.length] ?? null
}

// [DEBUG RADAR] remover depois de diagnosticar a rotação.
function logRadarFocus(
  symbols: readonly string[],
  analyses: Record<string, AssetAnalysis>,
  realSeries: RealSeries,
  ready: readonly string[],
  current: string,
  next: string | null,
): void {
  console.log('[Radar] pickRadarFocus', {
    radarSymbols: symbols,
    radarCount: symbols.length,
    readySymbols: ready,
    readyCount: ready.length,
    m1Lengths: Object.fromEntries(
      symbols.map((symbol) => [symbol, realSeries[symbol]?.M1?.length ?? 0]),
    ),
    scores: Object.fromEntries(ready.map((symbol) => [symbol, radarScore(analyses[symbol])])),
    current,
    currentScore: radarScore(analyses[current]),
    next,
    changed: next !== current,
  })
}

function pickRadarFocus(
  symbols: readonly string[],
  analyses: Record<string, AssetAnalysis>,
  realSeries: RealSeries,
  current: string,
): string | null {
  const ready = symbols.filter((symbol) => hasRadarHistory(realSeries, symbol))

  // Sem nenhum ativo com histórico, o radar não pode congelar no último foco:
  // rotaciona aleatoriamente entre os ativos disponíveis a cada ciclo.
  if (ready.length === 0) {
    const fallback = randomOtherSymbol(symbols, current)
    console.log('[Radar] sem ativos prontos (M1 < 200) — fallback aleatório')
    logRadarFocus(symbols, analyses, realSeries, ready, current, fallback)
    return fallback
  }

  const scores = new Map(
    ready.map((symbol) => [symbol, radarScore(analyses[symbol])] as const),
  )
  const maxScore = Math.max(...ready.map((symbol) => scores.get(symbol) ?? 0))
  const bestCandidates = ready.filter((symbol) => scores.get(symbol) === maxScore)

  console.log('[Radar] maxScore', maxScore)
  console.log('[Radar] bestCandidates', bestCandidates)

  let next: string | null
  if (maxScore === 0) {
    // Todos OBSERVANDO: força a rotação a cada 60s, mesmo sem empate técnico.
    next = randomOtherSymbol(ready, current)
  } else if (bestCandidates.length === 1) {
    next = bestCandidates[0]
  } else {
    // Empate na pontuação máxima: escolhe aleatoriamente entre os melhores
    // em vez de manter o ativo atual indefinidamente.
    next = bestCandidates[Math.floor(Math.random() * bestCandidates.length)]
  }

  console.log('[Radar] next', next)
  logRadarFocus(symbols, analyses, realSeries, ready, current, next)
  return next
}

export function Dashboard({ liveBot }: { liveBot: LiveBotSession }) {
  const data = useMarketData()
  const {
    selected,
    asset,
    setSelectedSymbol,
    setSelectedTimeframe,
    selectedTimeframe,
    analyses,
    realSeries,
    devForcedSignal,
    setDevForcedSignal,
    strategyEngine,
  } = data
  const timeframeLabel = TIMEFRAME_LABEL[selectedTimeframe]
  const signal = selected.signal
  const autoTrade = useLabStore((state) => state.isAutoTradeEnabled)
  const sweepReclaimOnly = useJournalStore((state) => state.settings.sweepReclaimOnly)
  const updateSettings = useJournalStore((state) => state.updateSettings)
  const setIsAutoTradeEnabled = useLabStore((state) => state.setIsAutoTradeEnabled)
  const sentOrdersTimestamps = useLabStore((state) => state.sentOrdersTimestamps)
  const setSentOrdersTimestamps = useLabStore((state) => state.setSentOrdersTimestamps)
  const rateLimitBlockedAt = useLabStore((state) => state.rateLimitBlockedAt)
  const setRateLimitBlockedAt = useLabStore((state) => state.setRateLimitBlockedAt)
  const stake = useLabStore((state) => state.botStake)
  const availableAssets = useLabStore((state) => state.availableAssets)
  const radarSymbols = useMemo(
    () =>
      availableAssets.length > 0
        ? availableAssets.filter((item) => item.available).map((item) => item.symbol)
        : data.assets.map((item) => item.symbol),
    [availableAssets, data.assets],
  )
  const readySymbols = useMemo(
    () => radarSymbols.filter((symbol) => hasRadarHistory(realSeries, symbol)),
    [radarSymbols, realSeries],
  )
  const radarCount = readySymbols.length
  const { setTradeNotice, setLastAutoOrder } = liveBot
  const previousSignal = useRef({ symbol: asset.symbol, phase: signal.phase })
  const lastProcessedCandleTime = useRef(new Map<string, number>())
  const radarSymbolsRef = useRef(radarSymbols)
  const analysesRef = useRef(analyses)
  const realSeriesRef = useRef(realSeries)
  const selectedSymbolRef = useRef(data.selectedSymbol)
  const [autoPaused, setAutoPaused] = useState(false)
  const autoPausedRef = useRef(autoPaused)
  // Recalculado a cada tick do mercado (simNowSec) para o contador expirar sozinho.
  const ordersLastHour = recentOrderTimestamps(
    sentOrdersTimestamps,
    data.simNowSec * 1000,
  ).length
  const rateLimitReached = ordersLastHour >= MAX_ORDERS_PER_HOUR
  const resumeTimer = useRef<number | null>(null)
  const signalId = signal.active?.id ?? (
    signal.triggerTime === null ? null : `${asset.symbol}-${signal.triggerTime}`
  )
  const forceLiveBlocked =
    devForcedSignal &&
    liveBot.liveModeEnabled &&
    liveBot.accountType !== 'PRACTICE'

  useEffect(() => {
    const isNewCandle =
      signal.triggerTime !== null &&
      signal.triggerTime >
        (lastProcessedCandleTime.current.get(asset.symbol) ?? Number.NEGATIVE_INFINITY)
    const enteredNow =
      signal.phase === 'ENTRAR' &&
      isNewCandle &&
      (devForcedSignal ||
        (previousSignal.current.symbol === asset.symbol &&
          previousSignal.current.phase !== 'ENTRAR'))
    previousSignal.current = { symbol: asset.symbol, phase: signal.phase }

    if (
      !enteredNow ||
      !autoTrade ||
      liveBot.status !== 'connected' ||
      forceLiveBlocked ||
      !availableAssets.some(
        (availableAsset) => availableAsset.symbol === asset.symbol && availableAsset.available,
      ) ||
      signal.direction === null ||
      signalId === null
    ) {
      return
    }

    const direction =
      signal.direction === 'UP' ? 'CALL' : signal.direction === 'DOWN' ? 'PUT' : null
    if (direction === null) return

    if (signal.triggerTime === null) return

    const now = Date.now()
    // Trava rígida global: independente do ativo ou dos filtros da estratégia.
    const recentOrders = recentOrderTimestamps(sentOrdersTimestamps, now)
    if (recentOrders.length >= MAX_ORDERS_PER_HOUR) {
      lastProcessedCandleTime.current.set(asset.symbol, signal.triggerTime)
      setIsAutoTradeEnabled(false)
      setRateLimitBlockedAt(now)
      setTradeNotice(
        `🛑 BLOQUEIO DE SEGURANÇA: Limite de ${MAX_ORDERS_PER_HOUR} ordens/hora atingido. O Auto-Trade foi desligado para evitar bloqueio na corretora.`,
      )
      return
    }
    setSentOrdersTimestamps([...recentOrders, now])
    lastProcessedCandleTime.current.set(asset.symbol, signal.triggerTime)

    const sentAtSec = Math.floor(Date.now() / 1000)
    const order: LiveAutoOrder = {
      signalId,
      asset: asset.symbol,
      direction,
      stage: 'sent',
      sentAtSec,
    }
    setLastAutoOrder(order)
    try {
      sendTradeCommand(asset.symbol, direction, stake)
      setTradeNotice('Ordem enviada para o Bot')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Erro inesperado ao enviar a ordem.'
      setLastAutoOrder({ ...order, stage: 'error', errorReason: reason })
      setTradeNotice(`Falha ao enviar: ${reason}`)
    }
  }, [
    asset.symbol,
    autoTrade,
    availableAssets,
    setLastAutoOrder,
    liveBot.status,
    liveBot.accountType,
    liveBot.liveModeEnabled,
    forceLiveBlocked,
    setTradeNotice,
    setIsAutoTradeEnabled,
    sentOrdersTimestamps,
    setSentOrdersTimestamps,
    setRateLimitBlockedAt,
    stake,
    signal.direction,
    signal.phase,
    signal.triggerTime,
    signalId,
    devForcedSignal,
  ])

  useEffect(() => {
    radarSymbolsRef.current = radarSymbols
    analysesRef.current = analyses
    realSeriesRef.current = realSeries
    selectedSymbolRef.current = data.selectedSymbol
  }, [radarSymbols, analyses, realSeries, data.selectedSymbol])

  useEffect(() => {
    for (const analysis of Object.values(analyses)) {
      for (const evaluation of analysis.strategyEvaluations ?? []) {
        sendStrategyEvaluation(evaluation)
      }
    }
  }, [analyses])

  useEffect(() => {
    autoPausedRef.current = autoPaused
  }, [autoPaused])

  useEffect(() => {
    if (
      !devForcedSignal &&
      !autoPaused &&
      analyses[data.selectedSymbol]?.signal.phase !== 'ENTRAR'
    ) {
      const entry = readySymbols.find((symbol) => analyses[symbol]?.signal.phase === 'ENTRAR')
      if (entry !== undefined) setSelectedSymbol(entry)
    }
  }, [
    analyses,
    autoPaused,
    devForcedSignal,
    data.selectedSymbol,
    readySymbols,
    setSelectedSymbol,
  ])

  useEffect(() => {
    const timer = window.setInterval(() => {
      console.log('[Radar] Timer de 60s disparado')
      if (!devForcedSignal && autoPausedRef.current) {
        console.log('[Radar] radar pausado (seleção manual) — ciclo ignorado')
        return
      }
      const next = devForcedSignal
        ? nextRadarSymbol(radarSymbolsRef.current, selectedSymbolRef.current)
        : pickRadarFocus(
            radarSymbolsRef.current,
            analysesRef.current,
            realSeriesRef.current,
            selectedSymbolRef.current,
          )
      if (next !== null && next !== selectedSymbolRef.current) setSelectedSymbol(next)
    }, RADAR_CYCLE_MS)
    return () => window.clearInterval(timer)
  }, [devForcedSignal, setSelectedSymbol])

  useEffect(
    () => () => {
      if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current)
    },
    [],
  )

  const handleManualSelect = (symbol: string) => {
    setSelectedSymbol(symbol)
    setAutoPaused(true)
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current)
    resumeTimer.current = window.setTimeout(() => setAutoPaused(false), MANUAL_PAUSE_MS)
  }

  const resumeAutoCycle = () => {
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current)
    resumeTimer.current = null
    setAutoPaused(false)
  }

  const baseProgress = data.progress
  const active = signal.phase === 'EM_ANDAMENTO' ? signal.active : null
  const expiryWindow = active === null ? 0 : Math.max(1, active.expiresAt - active.entryTime)
  const expiryLeft = active === null ? 0 : Math.max(0, active.expiresAt - data.simNowSec)
  const countdown =
    active !== null
      ? {
          progress: 1 - expiryLeft / expiryWindow,
          secondsLeft: Math.ceil(expiryLeft),
          ringLabel: 'EXP',
        }
      : {
          progress: baseProgress.progress,
          secondsLeft: baseProgress.secondsLeft,
          ringLabel: timeframeLabel,
        }

  return (
    <div>
      <LiveBotStatus
        status={liveBot.status}
        isLive={liveBot.isLive}
        accountBalance={liveBot.accountBalance}
        accountCurrency={liveBot.accountCurrency}
        accountType={liveBot.accountType}
        liveModeEnabled={liveBot.liveModeEnabled}
      />
      {liveBot.lastAutoOrder !== null && (
        <section
          aria-live="polite"
          aria-label="Última ordem enviada"
          className="mb-4 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-[10px]"
        >
          <span className="font-semibold text-muted">Última Ordem Enviada: </span>
          <span className="font-mono text-content">
            {liveBot.lastAutoOrder.direction} {liveBot.lastAutoOrder.asset}
            {liveBot.lastAutoOrder.stage === 'result' &&
            liveBot.lastAutoOrder.result !== undefined &&
            liveBot.lastAutoOrder.pnl !== undefined
              ? liveBot.lastAutoOrder.result === 'SKIPPED'
                ? ` (não enviada: ${liveBot.lastAutoOrder.errorReason ?? 'ativo indisponível'})`
                : ` (${liveBot.lastAutoOrder.result} ${formatSignedUsd(liveBot.lastAutoOrder.pnl)})`
              : liveBot.lastAutoOrder.stage === 'open'
                ? ' (operação aberta)'
                : liveBot.lastAutoOrder.stage === 'error'
                  ? ` (ordem recusada: ${liveBot.lastAutoOrder.errorReason ?? 'motivo não informado'})`
                  : ' (aguardando confirmação)'}
          </span>
        </section>
      )}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow flex items-center gap-2">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-buy" aria-hidden="true" />
            Sinais IQ Option
          </p>
          <h1 className="mt-2 font-display text-[26px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[32px]">
            O sinal, sem o ruído.
          </h1>
          <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-muted">
            {sweepReclaimOnly
              ? 'Modo isolado Sweep & Reclaim: avalia somente candles M1 fechados, sem sinais de outras estratégias.'
              : strategyEngine === 'next'
              ? 'Motor next em shadow: usa somente candles M1 fechados, mede candidatos e bloqueia a execução.'
              : `Motor legado M5 com confirmação M15 concluída. A vela em formação não participa da decisão.`}{' '}
            As cotações e sinais exibidos vêm do feed local, não da corretora.
          </p>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">Timeframe</span>
          <div
            role="group"
            aria-label="Selecionar timeframe"
            className="flex items-center gap-0.5 rounded-full border border-line bg-white/[0.02] p-0.5"
          >
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setSelectedTimeframe(tf)}
                aria-pressed={tf === selectedTimeframe}
                className={`rounded-full px-2.5 py-1 font-mono text-[10px] transition-colors ${
                  tf === selectedTimeframe
                    ? 'bg-accent/15 text-content'
                    : 'text-muted hover:text-content'
                }`}
              >
                {TIMEFRAME_LABEL[tf]}
              </button>
            ))}
          </div>

          {import.meta.env.DEV && (
            <button
              type="button"
              onClick={() => setDevForcedSignal(!devForcedSignal)}
              aria-pressed={devForcedSignal}
              aria-label="Sinal Free para teste de desenvolvimento"
              title="Bypass apenas em desenvolvimento; usa uma vela fechada."
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                devForcedSignal
                  ? 'border-warn/60 bg-warn/20 text-warn'
                  : 'border-line text-muted hover:border-warn/40 hover:text-warn'
              }`}
            >
              <Flame className="h-2.5 w-2.5" aria-hidden="true" />
              {devForcedSignal ? 'Sinal Free ON' : 'Sinal Free'}
            </button>
          )}
          <label
            title="Analisa somente candles fechados pela estratégia Sweep & Reclaim."
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[9px] text-muted transition-colors hover:text-content"
          >
            <input
              type="checkbox"
              checked={sweepReclaimOnly}
              onChange={(event) =>
                updateSettings({ sweepReclaimOnly: event.target.checked })
              }
              className="h-3 w-3 accent-accent"
            />
            Usar somente Sweep &amp; Reclaim
          </label>
          {sweepReclaimOnly && (
            <span
              role="status"
              className="rounded-full border border-warn/30 bg-warn/[0.06] px-2 py-1 text-[9px] uppercase tracking-[0.08em] text-warn"
            >
              Modo isolado ativo
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.1em] ${
              rateLimitReached
                ? 'border-sell/50 bg-sell/15 text-sell'
                : 'border-line text-muted'
            }`}
            title={`Trava de segurança global: máximo de ${MAX_ORDERS_PER_HOUR} ordens por hora.`}
          >
            <ShieldAlert className="h-2.5 w-2.5" aria-hidden="true" />
            Ordens na última hora: {ordersLastHour}/{MAX_ORDERS_PER_HOUR}
          </span>
          {!devForcedSignal && autoPaused ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/25 bg-warn/[0.06] px-2 py-1 text-[9px] uppercase tracking-[0.1em] text-warn">
                <Pause className="h-2.5 w-2.5" aria-hidden="true" />
                Auto-Cycle pausado
              </span>
              <button
                type="button"
                onClick={resumeAutoCycle}
                className="rounded-full border border-line px-2.5 py-1 text-[9px] uppercase tracking-[0.1em] text-muted transition-colors hover:text-content"
              >
                Voltar ao Auto-Cycle
              </button>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-[9px] uppercase tracking-[0.1em] text-muted">
              <RefreshCw className="h-2.5 w-2.5" aria-hidden="true" />
              Auto-Cycle · 60s
            </span>
          )}
        </div>
      </div>

      {rateLimitBlockedAt !== null && !autoTrade && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-sell/50 bg-sell/[0.08] px-3 py-2 text-[10px] leading-relaxed text-sell"
        >
          <p className="flex items-start gap-1.5 font-semibold">
            <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            BLOQUEIO DE SEGURANÇA: {MAX_ORDERS_PER_HOUR} ordens na última hora.
          </p>
          <p className="mt-1 pl-[18px]">
            O Auto-Trade foi desligado automaticamente para evitar bloqueio da corretora.
            Aguarde a janela de 1 hora liberar vagas antes de religar.
          </p>
        </div>
      )}

      {import.meta.env.DEV && devForcedSignal && (
        <div
          role="status"
          className="mt-3 rounded-lg border border-warn/35 bg-warn/[0.08] px-3 py-2 text-[10px] leading-relaxed text-warn"
        >
          <p>
            Modo de teste ativo: ignora os filtros da estratégia e pode enviar até 1 ordem por candle
            fechado ({timeframeLabel}) no ativo em foco. Requer Auto-Trade ligado; em LIVE, somente a
            conta PRACTICE é permitida. Desative o modo para voltar aos sinais normais.
          </p>
          {forceLiveBlocked && (
            <p className="mt-1 font-semibold">
              Envio bloqueado: conta LIVE não confirmada como PRACTICE
              {liveBot.accountType === 'REAL' ? ' (conta REAL)' : ''}.
            </p>
          )}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-stretch">
        <div className="min-w-0 lg:col-span-7">
          <SignalCard
            analysis={selected}
            asset={asset}
            forming={data.formingSignal}
            progress={countdown.progress}
            secondsLeft={countdown.secondsLeft}
            ringLabel={countdown.ringLabel}
            timeframeLabel={timeframeLabel}
            radarCount={radarCount}
            awaitingHistory={!hasRadarHistory(realSeries, data.selectedSymbol)}
            devForcedSignal={devForcedSignal}
          />
        </div>

        <div className="min-w-0 lg:col-span-5">
          <AssetList
            assets={data.assets}
            analyses={data.analyses}
            availableAssets={availableAssets}
            selectedSymbol={data.selectedSymbol}
            timeframeLabel={timeframeLabel}
            onSelect={handleManualSelect}
          />
        </div>
      </div>

      <div className="mt-4">
        <EdgeGateCard analysis={selected} />
      </div>

      <div className="mt-4">
        <Disclaimer />
      </div>

      <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 text-[9px] text-muted/70">
        <p>PULSE SIGNALS · conector IQ Option</p>
        <p className="font-mono uppercase tracking-[0.08em]">sinais informativos · verifique na corretora</p>
      </footer>
    </div>
  )
}
