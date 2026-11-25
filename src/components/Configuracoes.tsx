import { useEffect, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  BellRing,
  Database,
  FlaskConical,
  RotateCcw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Volume2,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { playAlertTone, requestNotificationPermission } from '../lib/alerts'
import { formatUsd } from '../lib/format'
import { EDGE_MIN_SAMPLE } from '../engine/edgeGate'
import { useJournalStore } from '../store/journalStore'
import { useLabStore } from '../stores/labStore'
import { sendTradeCommand } from '../hooks/useLiveBot'
import type { LiveBotMessage, LiveBotSession } from '../types/liveBot'
import { DEFAULT_SETTINGS, type AppSettings } from '../types/trading'
import { Disclaimer } from './Disclaimer'

interface FormState {
  strategyEngine: AppSettings['strategyEngine']
  payout: string
  costPerTrade: string
  costCalibrated: boolean
  minTradesPerBucket: string
  edgeMargin: string
  maxSignalsPerDay: string
  utcOffsetMinutes: string
  sessionOpenMinute: string
  sessionCloseMinute: string
  openingRangeMinutes: string
  noEntryAfterOpenMinutes: string
  noEntryBeforeCloseMinutes: string
  lookbackSessions: string
  expiryCandles: string
  pauseAfterLosses: string
  pauseMinutes: string
  spacingCandles: string
  soundEnabled: boolean
  notificationsEnabled: boolean
}

function toForm(settings: AppSettings): FormState {
  return {
    strategyEngine: settings.strategyEngine,
    payout: String(settings.payout),
    costPerTrade: String(settings.costPerTrade),
    costCalibrated: settings.costCalibrated,
    minTradesPerBucket: String(settings.minTradesPerBucket),
    edgeMargin: String(settings.edgeMargin),
    maxSignalsPerDay: String(settings.maxSignalsPerDay),
    utcOffsetMinutes: String(settings.utcOffsetMinutes),
    sessionOpenMinute: String(settings.sessionOpenMinute),
    sessionCloseMinute: String(settings.sessionCloseMinute),
    openingRangeMinutes: String(settings.openingRangeMinutes),
    noEntryAfterOpenMinutes: String(settings.noEntryAfterOpenMinutes),
    noEntryBeforeCloseMinutes: String(settings.noEntryBeforeCloseMinutes),
    lookbackSessions: String(settings.lookbackSessions),
    expiryCandles: String(settings.expiryCandles),
    pauseAfterLosses: String(settings.pauseAfterLosses),
    pauseMinutes: String(settings.pauseMinutes),
    spacingCandles: String(settings.spacingCandles),
    soundEnabled: settings.soundEnabled,
    notificationsEnabled: settings.notificationsEnabled,
  }
}

function toSettings(form: FormState, current: AppSettings): AppSettings {
  const num = (value: string, fallback: number) => {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : fallback
  }
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
  const sessionOpenMinute = Math.round(
    clamp(num(form.sessionOpenMinute, current.sessionOpenMinute), 0, 1438),
  )
  const requestedCloseMinute = Math.round(
    clamp(num(form.sessionCloseMinute, current.sessionCloseMinute), 1, 1439),
  )
  return {
    ...current,
    autoPaper: false,
    strategyEngine: form.strategyEngine,
    payout: clamp(num(form.payout, current.payout), 0.01, 1),
    costPerTrade: clamp(num(form.costPerTrade, current.costPerTrade), 0, 1000),
    costCalibrated: form.costCalibrated,
    minTradesPerBucket: Math.round(
      clamp(num(form.minTradesPerBucket, current.minTradesPerBucket), 10, 100_000),
    ),
    edgeMargin: clamp(num(form.edgeMargin, current.edgeMargin), 0, 0.5),
    maxSignalsPerDay: Math.round(
      clamp(num(form.maxSignalsPerDay, current.maxSignalsPerDay), 1, 100),
    ),
    utcOffsetMinutes: Math.round(
      clamp(num(form.utcOffsetMinutes, current.utcOffsetMinutes), -720, 840),
    ),
    sessionOpenMinute,
    sessionCloseMinute:
      requestedCloseMinute > sessionOpenMinute
        ? requestedCloseMinute
        : Math.min(1439, sessionOpenMinute + 1),
    openingRangeMinutes: Math.round(
      clamp(num(form.openingRangeMinutes, current.openingRangeMinutes), 1, 180),
    ),
    noEntryAfterOpenMinutes: Math.round(
      clamp(num(form.noEntryAfterOpenMinutes, current.noEntryAfterOpenMinutes), 0, 180),
    ),
    noEntryBeforeCloseMinutes: Math.round(
      clamp(num(form.noEntryBeforeCloseMinutes, current.noEntryBeforeCloseMinutes), 0, 180),
    ),
    lookbackSessions: Math.round(
      clamp(num(form.lookbackSessions, current.lookbackSessions), 1, 30),
    ),
    expiryCandles: Math.round(clamp(num(form.expiryCandles, current.expiryCandles), 1, 3)),
    pauseAfterLosses: Math.round(
      clamp(num(form.pauseAfterLosses, current.pauseAfterLosses), 1, 10),
    ),
    pauseMinutes: Math.round(clamp(num(form.pauseMinutes, current.pauseMinutes), 0, 240)),
    spacingCandles: Math.round(clamp(num(form.spacingCandles, current.spacingCandles), 1, 50)),
    soundEnabled: form.soundEnabled,
    notificationsEnabled: form.notificationsEnabled,
  }
}

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  id: string
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-[10px] font-medium text-content">{label}</span>
      <span className="mt-1 flex items-center rounded-lg border border-line bg-white/[0.025] focus-within:border-accent/50">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(event.target.value)}
          className="w-full min-w-0 bg-transparent px-2.5 py-2 font-mono text-[11px] tnum text-content outline-none"
        />
        {suffix !== undefined && (
          <span className="shrink-0 border-l border-line px-2 font-mono text-[9px] uppercase tracking-[0.06em] text-muted">
            {suffix}
          </span>
        )}
      </span>
      {hint !== undefined && <span className="mt-1 block text-[9px] leading-tight text-muted">{hint}</span>}
    </label>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-[10.5px] font-medium text-content">{label}</span>
        <span className="mt-0.5 block text-[9px] leading-tight text-muted">{hint}</span>
      </span>
      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={`block h-5 w-9 rounded-full border transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
            checked ? 'border-accent/50 bg-accent/30' : 'border-line bg-white/[0.04]'
          }`}
        />
        <span
          aria-hidden="true"
          className={`absolute top-0.5 h-4 w-4 rounded-full transition-transform ${
            checked ? 'translate-x-[18px] bg-accentText' : 'translate-x-0.5 bg-muted'
          }`}
        />
      </span>
    </label>
  )
}

const STRATEGY_RULES = [
  'Next: ORB com volume relativo, tendência ancorada em VWAP e reversão em ADX baixo',
  'Também avalia sweep de liquidez com reclaim e momentum de fechamento',
  'Contexto: ATR/percentil, ADX, VWAP, RVOL, fase da sessão e níveis anteriores',
  'Blitz: gate por probabilidade e EV na expiração fixa de 60s (M1)',
  'Wilson inferior, payout, margem e amostra mínima configurável por bucket',
  'Todos os resultados do laboratório alimentam o EdgeBook em walk-forward e shadow',
  'O motor legado A/B permanece selecionável como controle, em M5/M15',
  'O caminho next não produz sinais executáveis nem altera o envio de ordens',
]

export function Configuracoes({ liveBot }: { liveBot: LiveBotSession }) {
  const settings = useJournalStore((state) => state.settings)
  const updateSettings = useJournalStore((state) => state.updateSettings)
  const botStake = useLabStore((state) => state.botStake)
  const isAutoTradeEnabled = useLabStore((state) => state.isAutoTradeEnabled)
  const availableAssets = useLabStore((state) => state.availableAssets)
  const setBotStake = useLabStore((state) => state.setBotStake)
  const setIsAutoTradeEnabled = useLabStore((state) => state.setIsAutoTradeEnabled)
  const [form, setForm] = useState<FormState>(() => toForm(settings))
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedTestAsset, setSelectedTestAsset] = useState('')
  const [sessionTokenDraft, setSessionTokenDraft] = useState(liveBot.sessionToken)
  const [testStage, setTestStage] = useState<
    'idle' | 'sending' | 'accepted' | 'rejected' | 'timeout'
  >('idle')
  const [testRejectReason, setTestRejectReason] = useState<string | null>(null)
  const [handledMessage, setHandledMessage] = useState<LiveBotMessage | null>(liveBot.lastMessage)
  const openTestAssets = availableAssets.filter((asset) => asset.available)
  const testAsset = openTestAssets.some((asset) => asset.symbol === selectedTestAsset)
    ? selectedTestAsset
    : openTestAssets[0]?.symbol ?? ''

  // Reage à confirmação real do bot quando uma nova mensagem chega durante o teste.
  if (liveBot.lastMessage !== handledMessage) {
    setHandledMessage(liveBot.lastMessage)
    const message = liveBot.lastMessage
    if (testStage === 'sending' && message !== null) {
      if (message.type === 'trade_open') {
        setTestStage('accepted')
        setTestRejectReason(null)
      } else if (message.type === 'trade_error') {
        setTestStage('rejected')
        setTestRejectReason(message.reason)
      } else if (message.type === 'trade_result' && message.result === 'SKIPPED') {
        setTestStage('rejected')
        setTestRejectReason(message.reason ?? 'ativo indisponível no momento')
      }
    }
  }

  // Reativa o botão 3s depois da confirmação de aceite.
  useEffect(() => {
    if (testStage !== 'accepted') return
    const timer = window.setTimeout(() => setTestStage('idle'), 3000)
    return () => window.clearTimeout(timer)
  }, [testStage])

  // Destrava o botão se o Python não responder em 10s (timeout).
  useEffect(() => {
    if (testStage !== 'sending') return
    const timer = window.setTimeout(() => {
      setTestStage((current) => (current === 'sending' ? 'timeout' : current))
    }, 10_000)
    return () => window.clearTimeout(timer)
  }, [testStage])

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(settings))
  const patch = (values: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...values }))
    setNotice(null)
  }

  const save = () => {
    updateSettings(toSettings(form, settings))
    setNotice('Configurações salvas. O motor usa os novos parâmetros no próximo fechamento.')
  }

  const restoreDefaults = () => {
    updateSettings(DEFAULT_SETTINGS)
    setForm(toForm(DEFAULT_SETTINGS))
    setNotice('Valores padrão restaurados e aplicados.')
  }

  const testLiveOrder = () => {
    if (liveBot.status !== 'connected') {
      const message = 'Bot desconectado. Conecte o bot antes de enviar a ordem de teste.'
      liveBot.setTradeNotice(message)
      window.alert(message)
      return
    }
    if (liveBot.authStatus !== 'authenticated') {
      const message = 'Autentique o token de sessão antes de enviar a ordem de teste.'
      liveBot.setTradeNotice(message)
      window.alert(message)
      return
    }
    if (testAsset === '') {
      const message = 'Nenhum ativo disponível foi recebido do bot.'
      liveBot.setTradeNotice(message)
      window.alert(message)
      return
    }

    try {
      sendTradeCommand(testAsset, 'CALL', 1)
      setTestRejectReason(null)
      setTestStage('sending')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Erro inesperado ao enviar a ordem.'
      setTestStage('idle')
      liveBot.setTradeNotice(`Falha ao enviar ordem de teste: ${reason}`)
      window.alert(`Falha ao enviar ordem de teste: ${reason}`)
    }
  }

  const cancelTest = () => {
    setTestStage('idle')
    setTestRejectReason(null)
  }

  const submitSessionToken = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    liveBot.authenticateSessionToken(sessionTokenDraft)
  }

  const toggleLiveMode = () => {
    const enableLive = !liveBot.liveModeEnabled
    if (
      enableLive &&
      !window.confirm(
        'ATENÇÃO: Você está ativando o MODO REAL. O robô começará a enviar ordens com dinheiro real assim que um sinal for gerado. Tem certeza absoluta?',
      )
    ) {
      return
    }

    liveBot.setLiveMode(enableLive)
  }

  const toggleNotifications = async (checked: boolean) => {
    if (!checked) {
      patch({ notificationsEnabled: false })
      return
    }
    const permission = await requestNotificationPermission()
    if (permission === 'granted') {
      patch({ notificationsEnabled: true })
    } else {
      patch({ notificationsEnabled: false })
      setNotice('Permissão de notificação negada. Ajuste no navegador para ativar os avisos.')
    }
  }

  return (
    <div>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Configurações</p>
          <h1 className="mt-2 font-display text-[26px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[32px]">
            Motor de sinais e conexão IQ Option.
          </h1>
          <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-muted">
            Parâmetros do motor de sinais e da conexão com a IQ Option. Preferências de alertas
            ficam salvas neste navegador; os controles do bot externo ficam disponíveis abaixo.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-info/25 bg-info/[0.06] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-info">
          <Database className="h-3 w-3" aria-hidden="true" />
          localStorage · v1
        </span>
      </header>

      <section
        aria-labelledby="iq-option-heading"
        className="surface mt-5 p-4 sm:p-5"
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Execução externa</p>
            <h2
              id="iq-option-heading"
              className="mt-1 flex items-center gap-1.5 font-display text-base font-semibold tracking-tight"
            >
              {liveBot.status === 'connected' ? (
                <Wifi className="h-4 w-4 text-buy" aria-hidden="true" />
              ) : (
                <WifiOff className="h-4 w-4 text-muted" aria-hidden="true" />
              )}
              Conexão IQ Option (Bot Externo)
            </h2>
          </div>
          <span
            className={`rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] ${
              liveBot.status === 'connected'
                ? 'border-buy/25 bg-buy/[0.06] text-buy'
                : 'border-line bg-white/[0.02] text-muted'
            }`}
          >
            {liveBot.status === 'connected' ? 'BOT CONECTADO' : 'BOT OFFLINE'}
          </span>
          {liveBot.status === 'connected' && liveBot.accountBalance !== null && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.02] px-2 py-1 font-mono text-[9px] text-content">
              Saldo: {formatUsd(liveBot.accountBalance)} {liveBot.accountCurrency}
              {liveBot.accountType !== null && (
                <span
                  className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold ${
                    liveBot.accountType === 'REAL'
                      ? 'border-sell/35 bg-sell/10 text-sell'
                      : 'border-buy/25 bg-buy/[0.06] text-buy'
                  }`}
                >
                  {liveBot.accountType}
                </span>
              )}
            </span>
          )}
        </header>

        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={submitSessionToken}
        >
          <label htmlFor="bot-session-token" className="block min-w-[min(100%,260px)] flex-1">
            <span className="text-[10px] font-medium text-content">Token de sessão do bot</span>
            <input
              id="bot-session-token"
              aria-label="Token de sessão do bot"
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={sessionTokenDraft}
              onChange={(event) => setSessionTokenDraft(event.currentTarget.value)}
              className="mt-1 w-full rounded-lg border border-line bg-white/[0.025] px-2.5 py-2 font-mono text-[11px] text-content outline-none focus:border-accent/50"
            />
            <span className="mt-1 block text-[9px] leading-tight text-muted">
              Cole o token impresso no terminal. É mascarado e permanece somente na memória desta sessão.
            </span>
          </label>
          <button
            type="submit"
            disabled={sessionTokenDraft.trim() === '' && liveBot.sessionToken === ''}
            className="rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.08em] text-content disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sessionTokenDraft.trim() === '' ? 'Remover token' : 'Autenticar token'}
          </button>
          <span
            className={`rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] ${
              liveBot.authStatus === 'authenticated'
                ? 'border-buy/25 bg-buy/[0.06] text-buy'
                : liveBot.authStatus === 'rejected'
                  ? 'border-sell/25 bg-sell/[0.06] text-sell'
                  : 'border-line bg-white/[0.02] text-muted'
            }`}
            role="status"
          >
            {liveBot.authStatus === 'authenticated'
              ? 'Token autenticado'
              : liveBot.authStatus === 'pending'
                ? 'Validando token'
                : liveBot.authStatus === 'rejected'
                  ? 'Token recusado'
                  : 'Token necessário'}
          </span>
        </form>
        {liveBot.authNotice !== null && (
          <p className="mt-2 text-[10px] text-muted" role="status">
            {liveBot.authNotice}
          </p>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_minmax(180px,auto)_auto] sm:items-end">
          <label htmlFor="bot-stake" className="block">
            <span className="text-[10px] font-medium text-content">Stake ($)</span>
            <span className="mt-1 flex items-center rounded-lg border border-line bg-white/[0.025] focus-within:border-accent/50">
              <input
                id="bot-stake"
                aria-label="Stake do bot em dólares"
                type="number"
                inputMode="decimal"
                min={0.1}
                max={10}
                step={0.1}
                value={botStake}
                onChange={(event) => setBotStake(Number(event.currentTarget.value))}
                className="w-full min-w-0 bg-transparent px-2.5 py-2 font-mono text-[11px] tnum text-content outline-none"
              />
              <span className="shrink-0 border-l border-line px-2 font-mono text-[9px] uppercase tracking-[0.06em] text-muted">
                USD · máx. 10
              </span>
            </span>
          </label>

          <button
            aria-checked={isAutoTradeEnabled}
            aria-label="Auto-Trade"
            className="inline-flex items-center justify-between gap-2 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-[10px] font-semibold text-content disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              (!isAutoTradeEnabled &&
                (liveBot.status !== 'connected' || liveBot.authStatus !== 'authenticated'))
            }
            onClick={() =>
              setIsAutoTradeEnabled(
                !isAutoTradeEnabled &&
                  liveBot.status === 'connected' &&
                  liveBot.authStatus === 'authenticated',
              )
            }
            role="switch"
            type="button"
          >
            <span>Auto-Trade</span>
            <span
              aria-hidden="true"
              className={`relative h-4 w-7 rounded-full transition-colors ${
                isAutoTradeEnabled ? 'bg-sell' : 'bg-muted/40'
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                  isAutoTradeEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>

          <button
            aria-checked={liveBot.liveModeEnabled}
            aria-label={`LIVE (conta ${liveBot.accountType ?? '—'})`}
            className="inline-flex items-center justify-between gap-2 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-[10px] font-semibold text-content disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              liveBot.status !== 'connected' ||
              (!liveBot.liveModeEnabled && liveBot.authStatus !== 'authenticated')
            }
            onClick={toggleLiveMode}
            role="switch"
            type="button"
          >
            <span>LIVE (conta {liveBot.accountType ?? '—'})</span>
            <span
              aria-hidden="true"
              className={`relative h-4 w-7 rounded-full transition-colors ${
                liveBot.liveModeEnabled ? 'bg-sell' : 'bg-muted/40'
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                  liveBot.liveModeEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </span>
            {liveBot.liveModeEnabled && (
              <span className="rounded-full border border-sell/40 bg-sell/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-sell">
                LIVE
              </span>
            )}
          </button>

          <label htmlFor="test-order-asset" className="block">
            <span className="text-[10px] font-medium text-content">Ativo para teste</span>
            <select
              id="test-order-asset"
              aria-label="Ativo para testar ordem"
              value={testAsset}
              onChange={(event) => setSelectedTestAsset(event.currentTarget.value)}
              disabled={
                liveBot.status !== 'connected' ||
                liveBot.authStatus !== 'authenticated' ||
                openTestAssets.length === 0
              }
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-[10px] text-content outline-none focus:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {openTestAssets.length === 0 ? (
                <option value="">Nenhum ativo disponível</option>
              ) : (
                openTestAssets.map((asset) => (
                  <option key={asset.symbol} value={asset.symbol}>
                    {asset.symbol} · payout{' '}
                    {Math.round(asset.payout <= 1 ? asset.payout * 100 : asset.payout)}%
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={testLiveOrder}
              disabled={
                liveBot.status !== 'connected' ||
                liveBot.authStatus !== 'authenticated' ||
                testAsset === '' ||
                testStage === 'sending' ||
                testStage === 'accepted'
              }
              className="rounded-lg border border-sell/50 bg-sell/15 px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.08em] text-sell transition-colors hover:bg-sell/25 disabled:cursor-not-allowed disabled:opacity-50"
              title={
                liveBot.status === 'connected'
                  ? `Envia uma ordem CALL de $1 para ${testAsset || 'o ativo selecionado'}`
                  : 'Conecte o bot antes de testar'
              }
            >
              {testStage === 'sending'
                ? 'Enviando ordem...'
                : `Testar ordem ($1) — conta ${liveBot.accountType ?? '—'}`}
            </button>
            {testStage === 'sending' && (
              <button
                type="button"
                onClick={cancelTest}
                className="rounded-lg border border-line bg-white/[0.02] px-2 py-2 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted transition-colors hover:text-content"
                title="Destrava o botão manualmente sem esperar a resposta"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>

        {testStage !== 'idle' && (
          <p
            className={`mt-2 text-[10px] font-semibold ${
              testStage === 'accepted'
                ? 'text-buy'
                : testStage === 'rejected' || testStage === 'timeout'
                  ? 'text-warn'
                  : 'text-info'
            }`}
            role={testStage === 'sending' ? 'status' : 'alert'}
          >
            {testStage === 'sending'
              ? 'Enviando ordem e aguardando confirmação da corretora…'
              : testStage === 'accepted'
                ? 'Ordem aceita pela corretora!'
                : testStage === 'timeout'
                  ? 'Ordem sem resposta (timeout)'
                  : `Ordem recusada pela corretora: ${testRejectReason ?? 'motivo não informado'}`}
          </p>
        )}

        {isAutoTradeEnabled && (
          <p className="mt-3 flex items-center gap-1.5 text-[10px] font-semibold text-sell" role="alert">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            ATENÇÃO: O robô enviará ordens reais se o bot Python estiver em modo LIVE
          </p>
        )}
        {liveBot.liveModeEnabled && (
          <p className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold text-sell" role="alert">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Modo LIVE ativo: comandos de operação podem enviar ordens reais.
          </p>
        )}
        {liveBot.modeNotice !== null && (
          <p
            className={`mt-2 text-[10px] ${
              liveBot.modeNotice.startsWith('Modo não alterado')
                ? 'text-warn'
                : 'text-info'
            }`}
            role={liveBot.modeNotice.startsWith('Modo não alterado') ? 'alert' : 'status'}
          >
            {liveBot.modeNotice}
          </p>
        )}
        {liveBot.assetWarning !== null && (
          <p
            className="mt-2 flex items-start gap-1.5 rounded-lg border border-warn/25 bg-warn/[0.06] px-2.5 py-2 text-[10px] leading-relaxed text-warn"
            role="status"
            aria-live="polite"
          >
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            {liveBot.assetWarning}
          </p>
        )}
        {liveBot.tradeNotice !== null && (
          <p
            className={`mt-2 text-[10px] ${
              liveBot.tradeNotice.startsWith('Falha') ||
              liveBot.tradeNotice.startsWith('Bot desconectado')
                ? 'text-warn'
                : 'text-buy'
            }`}
            role={
              liveBot.tradeNotice.startsWith('Falha') ||
              liveBot.tradeNotice.startsWith('Bot desconectado')
                ? 'alert'
                : 'status'
            }
          >
            {liveBot.tradeNotice}
          </p>
        )}
      </section>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
        className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12"
      >
        <section aria-labelledby="next-engine-heading" className="surface p-4 sm:p-5 lg:col-span-12">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Motor estatístico</p>
              <h2
                id="next-engine-heading"
                className="mt-1 flex items-center gap-1.5 font-display text-base font-semibold tracking-tight"
              >
                <FlaskConical className="h-4 w-4 text-warn" aria-hidden="true" />
                Configuração shadow · expiração Blitz 60s
              </h2>
            </div>
            <span className="rounded-full border border-warn/30 bg-warn/[0.07] px-2 py-1 text-[8px] font-bold uppercase tracking-[0.08em] text-warn">
              Ordens bloqueadas
            </span>
          </header>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <label htmlFor="strategy-engine" className="block">
              <span className="text-[10px] font-medium text-content">Motor selecionado</span>
              <select
                id="strategy-engine"
                value={form.strategyEngine}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  if (value === 'legacy' || value === 'next') {
                    patch({ strategyEngine: value })
                  }
                }}
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-[10px] text-content outline-none focus:border-accent/50"
              >
                <option value="next">Next · shadow M1</option>
                <option value="legacy">Legacy · M5/M15</option>
              </select>
            </label>
            <NumberField
              id="edge-payout"
              label="Payout do broker"
              value={form.payout}
              onChange={(value) => patch({ payout: value })}
              min={0.01}
              max={1}
              step={0.01}
              suffix="0–1"
            />
            <NumberField
              id="edge-cost"
              label="Custo por operação"
              hint="Unidades de preço; calibrar por ativo antes de considerar qualquer edge."
              value={form.costPerTrade}
              onChange={(value) => patch({ costPerTrade: value })}
              min={0}
              step={0.00001}
            />
            <NumberField
              id="edge-min-trades"
              label="Amostra mínima por bucket"
              value={form.minTradesPerBucket}
              onChange={(value) => patch({ minTradesPerBucket: value })}
              min={10}
              max={100000}
              step={1}
              suffix="trades"
            />
            <NumberField
              id="edge-margin"
              label="Margem acima do breakeven"
              value={form.edgeMargin}
              onChange={(value) => patch({ edgeMargin: value })}
              min={0}
              max={0.5}
              step={0.01}
              suffix="0–1"
            />
            <NumberField
              id="edge-max-signals"
              label="Máximo de candidatos por dia"
              value={form.maxSignalsPerDay}
              onChange={(value) => patch({ maxSignalsPerDay: value })}
              min={1}
              max={100}
              suffix="candidatos"
            />
            <NumberField
              id="edge-utc-offset"
              label="Offset da sessão"
              value={form.utcOffsetMinutes}
              onChange={(value) => patch({ utcOffsetMinutes: value })}
              min={-720}
              max={840}
              suffix="min UTC"
            />
            <NumberField
              id="edge-session-open"
              label="Abertura da sessão"
              value={form.sessionOpenMinute}
              onChange={(value) => patch({ sessionOpenMinute: value })}
              min={0}
              max={1438}
              suffix="min/dia"
            />
            <NumberField
              id="edge-session-close"
              label="Fechamento da sessão"
              value={form.sessionCloseMinute}
              onChange={(value) => patch({ sessionCloseMinute: value })}
              min={1}
              max={1439}
              suffix="min/dia"
            />
            <NumberField
              id="edge-opening-range"
              label="Opening range"
              value={form.openingRangeMinutes}
              onChange={(value) => patch({ openingRangeMinutes: value })}
              min={1}
              max={180}
              suffix="min"
            />
            <NumberField
              id="edge-block-open"
              label="Bloqueio após abertura"
              value={form.noEntryAfterOpenMinutes}
              onChange={(value) => patch({ noEntryAfterOpenMinutes: value })}
              min={0}
              max={180}
              suffix="min"
            />
            <NumberField
              id="edge-block-close"
              label="Bloqueio antes do fechamento"
              value={form.noEntryBeforeCloseMinutes}
              onChange={(value) => patch({ noEntryBeforeCloseMinutes: value })}
              min={0}
              max={180}
              suffix="min"
            />
            <NumberField
              id="edge-lookback"
              label="Lookback de sessões"
              value={form.lookbackSessions}
              onChange={(value) => patch({ lookbackSessions: value })}
              min={1}
              max={30}
              suffix="sessões"
            />
          </div>
          <div className="mt-3">
            <Toggle
              label="Custo calibrado para este ativo"
              hint="Desmarcado por padrão. O motor não aprova candidatos enquanto o custo não for calibrado."
              checked={form.costCalibrated}
              onChange={(checked) => patch({ costCalibrated: checked })}
            />
          </div>
          <p className="mt-3 rounded-lg border border-warn/20 bg-warn/[0.04] px-2.5 py-2 text-[9.5px] leading-relaxed text-warn">
            O motor next permanece em modo sombra. Mesmo um bucket aprovado não autoriza ordens; custo e execução
            ainda precisam de validação independente.
          </p>
        </section>

        <section aria-labelledby="risk-heading" className="surface p-4 sm:p-5 lg:col-span-6">
          <header>
            <p className="eyebrow">Risco</p>
            <h2 id="risk-heading" className="mt-1 flex items-center gap-1.5 font-display text-base font-semibold tracking-tight">
              <SlidersHorizontal className="h-4 w-4 text-muted" aria-hidden="true" />
              Limites e pausas
            </h2>
          </header>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NumberField
              id="pauseAfterLosses"
              label="Pausa após perdas"
              suffix="perdas"
              value={form.pauseAfterLosses}
              onChange={(value) => patch({ pauseAfterLosses: value })}
              min={1}
              max={10}
              step={1}
            />
            <NumberField
              id="pauseMinutes"
              label="Duração da pausa"
              suffix="min"
              value={form.pauseMinutes}
              onChange={(value) => patch({ pauseMinutes: value })}
              min={0}
              max={240}
              step={5}
            />
            <NumberField
              id="spacing"
              label="Espaçamento mínimo"
              suffix="velas"
              value={form.spacingCandles}
              onChange={(value) => patch({ spacingCandles: value })}
              min={1}
              max={50}
              step={1}
              hint="Máximo de 1 sinal por ativo no intervalo."
            />
            <NumberField
              id="expiry"
              label="Expiração do legado"
              suffix="velas M5"
              value={form.expiryCandles}
              onChange={(value) => patch({ expiryCandles: value })}
              min={1}
              max={3}
              step={1}
            />
          </div>
        </section>

        <section aria-labelledby="automation-heading" className="surface p-4 sm:p-5 lg:col-span-6">
          <header>
            <p className="eyebrow">Automação</p>
            <h2
              id="automation-heading"
              className="mt-1 flex items-center gap-1.5 font-display text-base font-semibold tracking-tight"
            >
              <BellRing className="h-4 w-4 text-muted" aria-hidden="true" />
              Alertas de sinal
            </h2>
          </header>
          <div className="mt-3 space-y-2">
            <Toggle
              label="Som no novo gatilho"
              hint="Tom curto no navegador quando uma entrada é confirmada."
              checked={form.soundEnabled}
              onChange={(checked) => patch({ soundEnabled: checked })}
            />
            <Toggle
              label="Notificação do sistema"
              hint="Requer permissão do navegador. Funciona com a aba aberta."
              checked={form.notificationsEnabled}
              onChange={(checked) => void toggleNotifications(checked)}
            />
          </div>
          <button
            type="button"
            onClick={() => playAlertTone()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted transition-colors hover:text-content"
          >
            <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
            Testar som
          </button>
        </section>

        <section aria-labelledby="strategy-heading" className="surface p-4 sm:p-5 lg:col-span-7">
          <header className="flex items-start justify-between gap-2">
            <div>
              <p className="eyebrow">Estratégia base</p>
              <h2
                id="strategy-heading"
                className="mt-1 flex items-center gap-1.5 font-display text-base font-semibold tracking-tight"
              >
                <FlaskConical className="h-4 w-4 text-muted" aria-hidden="true" />
                Regras do motor
              </h2>
            </div>
            <span className="rounded-full border border-warn/25 bg-warn/[0.06] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.08em] text-warn">
              Experimental
            </span>
          </header>
          <ul className="mt-3 grid gap-1.5">
            {STRATEGY_RULES.map((rule) => (
              <li key={rule} className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accentText" aria-hidden="true" />
                {rule}
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-warn/20 bg-warn/[0.04] px-2.5 py-2 text-[9.5px] leading-relaxed text-warn">
            <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            Nenhum setup é considerado validado antes do Edge Gate da Etapa 3 (n≥{EDGE_MIN_SAMPLE}{' '}
            fora da amostra e IC95% acima do breakeven).
          </p>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 lg:col-span-12">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={!dirty}
              className="inline-flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent/[0.14] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-content transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:border-line disabled:bg-white/[0.02] disabled:text-muted/60"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              Salvar configurações
            </button>
            <button
              type="button"
              onClick={restoreDefaults}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white/[0.02] px-3.5 py-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted transition-colors hover:text-content"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Restaurar padrões
            </button>
          </div>
          <p
            role="status"
            className={`text-[10px] leading-relaxed ${notice !== null ? 'text-info' : 'text-muted'}`}
          >
            {notice ?? (dirty ? 'Alterações ainda não salvas.' : 'Configuração sincronizada.')}
          </p>
        </div>
      </form>

      <div className="mt-4">
        <Disclaimer />
      </div>
    </div>
  )
}
