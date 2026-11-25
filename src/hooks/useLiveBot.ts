import { useCallback, useEffect, useRef, useState } from 'react'
import { useLabStore } from '../stores/labStore'
import { useMarketStore } from '../store/marketStore'
import type { Candle, RealCandleTimeframe } from '../types/market'
import type { StrategyEvaluationLog } from '../types/market'
import type {
  BotStoppedMessage,
  AvailableAsset,
  LiveAutoOrder,
  LiveBotMessage,
  LiveBotSession,
  LiveTradeOpenMessage,
  LiveTradeResultMessage,
  LiveTradeDirection,
  RealCandlesMessage,
  StrategyLogResultMessage,
} from '../types/liveBot'

const SOCKET_URL =
  typeof window !== 'undefined'
    ? resolveSocketUrl(window.location.hostname)
    : resolveSocketUrl('')
// Backoff exponencial: 2s, 4s, 8s, 16s, 30s (limite).
const RECONNECT_BASE_MS = 2_000
const RECONNECT_MAX_MS = 30_000

/**
 * Resolve a URL do WebSocket do bot.
 * Prioridade: `VITE_WS_URL` (se definido e não vazio) > hostname atual > localhost.
 * Exportada para teste unitário sem depender de DOM.
 */
export function resolveSocketUrl(
  hostname: string,
  envUrl: string | undefined = import.meta.env.VITE_WS_URL,
): string {
  const configured = envUrl?.trim()
  if (configured) return configured
  const host = hostname?.trim() || 'localhost'
  return `ws://${host}:8000/ws`
}

const MAX_STAKE = 10
let activeSocket: WebSocket | null = null
let authenticatedSocket: WebSocket | null = null
const pendingStrategyLogs = new Map<string, StrategyEvaluationLog>()
const sentStrategyLogKeys = new Set<string>()
const observedStrategyLogKeys = new Set<string>()
const strategyLogAckTimers = new Map<string, ReturnType<typeof setTimeout>>()
const MAX_PENDING_STRATEGY_LOGS = 5_000
let warnedStrategyLogUnavailable = false

/** Texto do banner amarelo para ativo que não aceita ordens. */
export const ASSET_UNAVAILABLE_NOTICE =
  'Este ativo não está aceitando ordens no momento. O radar tentará outro ativo.'

/** Tempo de vida dos avisos de negócio na tela. */
export const TRADE_NOTICE_TTL_MS = 5_000

const ASSET_UNAVAILABLE_PATTERN = /suspended|not available/i

/** Ativo suspenso/indisponível é aviso de negócio, não falha de conexão. */
export function isAssetUnavailable(reason: string): boolean {
  return ASSET_UNAVAILABLE_PATTERN.test(reason)
}

export interface TradeErrorNotice {
  kind: 'warning' | 'error'
  text: string
}

/** Traduz um trade_error em banner amarelo (negócio) ou erro padrão (falha). */
export function resolveTradeErrorNotice(reason: string): TradeErrorNotice {
  if (isAssetUnavailable(reason)) {
    return { kind: 'warning', text: ASSET_UNAVAILABLE_NOTICE }
  }
  return { kind: 'error', text: `Falha ao enviar ordem: ${reason}` }
}

/** Agenda a limpeza de um aviso e devolve o cancelador. */
export function scheduleNoticeClear(clear: () => void): () => void {
  const timer = setTimeout(clear, TRADE_NOTICE_TTL_MS)
  return () => clearTimeout(timer)
}

export function sendTradeCommand(
  asset: string,
  direction: LiveTradeDirection,
  amount = useLabStore.getState().botStake,
): void {
  if (!asset.trim()) throw new Error('Selecione um ativo antes de enviar a ordem.')
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_STAKE) {
    throw new Error(`A stake deve ser maior que zero e no máximo $ ${MAX_STAKE.toFixed(2)}.`)
  }
  if (activeSocket?.readyState !== WebSocket.OPEN) {
    throw new Error('Bot desconectado; a ordem não foi enviada.')
  }
  if (authenticatedSocket !== activeSocket) {
    throw new Error('Autentique o token de sessão antes de enviar comandos.')
  }

  activeSocket.send(JSON.stringify({
    action: 'execute_trade',
    asset,
    direction,
    amount,
  }))
}

export function sendLiveModeCommand(live: boolean): void {
  if (activeSocket?.readyState !== WebSocket.OPEN) {
    throw new Error('Bot desconectado; o modo de execução não foi alterado.')
  }
  if (authenticatedSocket !== activeSocket) {
    throw new Error('Autentique o token de sessão antes de enviar comandos.')
  }

  activeSocket.send(JSON.stringify({
    action: 'set_live_mode',
    live,
  }))
}

function strategyEvaluationKey(event: StrategyEvaluationLog): string {
  const candleTime = event.candleTime === null ? 'none' : String(event.candleTime)
  return `${event.strategy}|${event.asset}|${event.timeframe}|${candleTime}`
}

function flushPendingStrategyLogs(socket: WebSocket): void {
  if (socket.readyState !== WebSocket.OPEN) return
  for (const [key, event] of pendingStrategyLogs) {
    if (sentStrategyLogKeys.has(key)) continue
    try {
      socket.send(JSON.stringify({
        action: 'log_strategy_evaluation',
        key,
        event: {
          strategy: event.strategy,
          asset: event.asset,
          timeframe: event.timeframe,
          mode: event.mode,
          candle_time: event.candleTime,
          result: event.result,
          direction: event.direction,
          reason: event.reason,
          details: event.details,
        },
      }))
      sentStrategyLogKeys.add(key)
      strategyLogAckTimers.set(
        key,
        setTimeout(() => {
          strategyLogAckTimers.delete(key)
          if (pendingStrategyLogs.has(key)) {
            console.error(`Backend não confirmou a gravação da avaliação ${key}.`)
          }
        }, 10_000),
      )
    } catch (error) {
      console.error('Falha ao enviar avaliação ao backend de logs.', error)
      break
    }
  }
}

export function sendStrategyEvaluation(event: StrategyEvaluationLog): void {
  const key = strategyEvaluationKey(event)
  if (observedStrategyLogKeys.has(key)) return
  if (pendingStrategyLogs.size >= MAX_PENDING_STRATEGY_LOGS) {
    console.error('Fila de logs cheia; esta avaliação não foi persistida.', key)
    return
  }

  observedStrategyLogKeys.add(key)
  pendingStrategyLogs.set(key, event)
  const socket = activeSocket
  if (socket?.readyState === WebSocket.OPEN) {
    flushPendingStrategyLogs(socket)
  } else if (!warnedStrategyLogUnavailable) {
    warnedStrategyLogUnavailable = true
    console.warn('Backend de logs desconectado; avaliações pendentes ainda não foram gravadas.')
  }
}

function handleStrategyLogResult(message: StrategyLogResultMessage): void {
  if (message.written) {
    const timer = strategyLogAckTimers.get(message.key)
    if (timer !== undefined) clearTimeout(timer)
    strategyLogAckTimers.delete(message.key)
    pendingStrategyLogs.delete(message.key)
    sentStrategyLogKeys.delete(message.key)
    warnedStrategyLogUnavailable = false
    return
  }
  const timer = strategyLogAckTimers.get(message.key)
  if (timer !== undefined) clearTimeout(timer)
  strategyLogAckTimers.delete(message.key)
  console.error(
    `Backend não gravou a avaliação ${message.key}: ${message.reason ?? 'erro de escrita sem detalhes.'}`,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAvailableAsset(value: unknown): value is AvailableAsset {
  return (
    isRecord(value) &&
    typeof value.symbol === 'string' &&
    value.symbol.trim() !== '' &&
    typeof value.available === 'boolean' &&
    typeof value.payout === 'number' &&
    Number.isFinite(value.payout)
  )
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isCandle(value: unknown): value is Candle {
  return (
    isRecord(value) &&
    typeof value.time === 'number' &&
    Number.isFinite(value.time) &&
    value.time > 0 &&
    typeof value.open === 'number' &&
    Number.isFinite(value.open) &&
    typeof value.high === 'number' &&
    Number.isFinite(value.high) &&
    typeof value.low === 'number' &&
    Number.isFinite(value.low) &&
    typeof value.close === 'number' &&
    Number.isFinite(value.close) &&
    typeof value.volume === 'number' &&
    Number.isFinite(value.volume)
  )
}

function parseRealTimeframe(value: unknown): RealCandleTimeframe | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  if (normalized === 'M1' || normalized === 'M5' || normalized === 'M15') return normalized
  return null
}

function parseBrokerTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value > 10 ** 12 ? Math.floor(value / 1000) : Math.floor(value)
}

export function parseMessage(value: unknown): LiveBotMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null

  if (
    value.type === 'mode_changed' &&
    typeof value.live === 'boolean'
  ) {
    return { type: 'mode_changed', live: value.live }
  }

  if (
    value.type === 'mode_error' &&
    typeof value.reason === 'string' &&
    value.reason.trim() !== ''
  ) {
    return { type: 'mode_error', reason: value.reason }
  }

  if (
    value.type === 'strategy_log_result' &&
    typeof value.key === 'string' &&
    typeof value.written === 'boolean' &&
    typeof value.duplicate === 'boolean' &&
    (value.reason === undefined ||
      (typeof value.reason === 'string' && value.reason.trim() !== ''))
  ) {
    return {
      type: 'strategy_log_result',
      key: value.key,
      written: value.written,
      duplicate: value.duplicate,
      ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    }
  }

  if (
    value.type === 'auth_result' &&
    typeof value.authenticated === 'boolean' &&
    (value.reason === undefined ||
      (typeof value.reason === 'string' && value.reason.trim() !== ''))
  ) {
    return {
      type: 'auth_result',
      authenticated: value.authenticated,
      ...(typeof value.reason === 'string' ? { reason: value.reason.trim() } : {}),
    }
  }

  if (
    value.type === 'assets_status' &&
    Array.isArray(value.assets) &&
    value.assets.every(isAvailableAsset)
  ) {
    return { type: 'assets_status', assets: value.assets }
  }

  if (value.type === 'real_candles') {
    const asset = typeof value.asset === 'string' ? value.asset.trim().toUpperCase() : ''
    const timeframe = parseRealTimeframe(value.timeframe)
    const candles = Array.isArray(value.candles) ? value.candles : null
    const brokerTimestamp =
      parseBrokerTimestamp(value.timestamp) ?? parseBrokerTimestamp(value.server_time)

    if (
      asset !== '' &&
      timeframe !== null &&
      candles !== null &&
      candles.length > 0 &&
      candles.every(isCandle)
    ) {
      const message: RealCandlesMessage = {
        type: 'real_candles',
        asset,
        timeframe,
        candles,
        timestamp: brokerTimestamp ?? candles[candles.length - 1].time,
      }
      return message
    }
  }

  if (
    value.type === 'account_balance' &&
    typeof value.balance === 'number' &&
    Number.isFinite(value.balance) &&
    value.balance >= 0 &&
    typeof value.currency === 'string' &&
    value.currency.trim() !== '' &&
    (value.account_type === 'PRACTICE' || value.account_type === 'REAL')
  ) {
    return {
      type: 'account_balance',
      balance: value.balance,
      currency: value.currency,
      account_type: value.account_type,
    }
  }

  if (
    value.type === 'trade_open' &&
    typeof value.asset === 'string' &&
    (value.direction === 'CALL' || value.direction === 'PUT') &&
    typeof value.amount === 'number' &&
    Number.isFinite(value.amount) &&
    typeof value.entry_price === 'number' &&
    Number.isFinite(value.entry_price) &&
    typeof value.expiration === 'number' &&
    Number.isFinite(value.expiration) &&
    isTimestamp(value.timestamp)
  ) {
    const message: LiveTradeOpenMessage = {
      type: 'trade_open',
      asset: value.asset,
      direction: value.direction,
      amount: value.amount,
      entry_price: value.entry_price,
      expiration: value.expiration,
      timestamp: value.timestamp,
      ...(typeof value.trade_id === 'string' ? { trade_id: value.trade_id } : {}),
    }
    return message
  }

  if (
    value.type === 'trade_result' &&
    typeof value.asset === 'string' &&
    (value.direction === 'CALL' || value.direction === 'PUT') &&
    (value.result === 'WIN' ||
      value.result === 'LOSS' ||
      value.result === 'DRAW' ||
      value.result === 'SKIPPED') &&
    typeof value.pnl === 'number' &&
    Number.isFinite(value.pnl) &&
    isTimestamp(value.timestamp)
  ) {
    const message: LiveTradeResultMessage = {
      type: 'trade_result',
      asset: value.asset,
      direction: value.direction,
      result: value.result,
      pnl: value.pnl,
      timestamp: value.timestamp,
      ...(typeof value.trade_id === 'string' ? { trade_id: value.trade_id } : {}),
      ...(typeof value.reason === 'string' && value.reason.trim() !== ''
        ? { reason: value.reason.trim() }
        : {}),
    }
    return message
  }

  if (
    value.type === 'bot_stopped' &&
    typeof value.reason === 'string' &&
    value.reason.trim() !== ''
  ) {
    const message: BotStoppedMessage = {
      type: 'bot_stopped',
      reason: value.reason,
    }
    return message
  }

  if (value.type === 'trade_error') {
    // O bot envia "reason" para falhas genéricas e "message" para avisos
    // amigáveis (ex.: ativo suspenso); ambos são normalizados para reason.
    const reason =
      typeof value.reason === 'string' && value.reason.trim() !== ''
        ? value.reason
        : typeof value.message === 'string' && value.message.trim() !== ''
          ? value.message
          : null
    if (reason !== null) {
      return { type: 'trade_error', reason }
    }
  }

  return null
}

export function useLiveBot(): LiveBotSession {
  const [status, setStatus] = useState<LiveBotSession['status']>('disconnected')
  const [lastMessage, setLastMessage] = useState<LiveBotMessage | null>(null)
  const [liveModeEnabled, setLiveModeEnabled] = useState(false)
  const [modeNotice, setModeNotice] = useState<string | null>(null)
  const [lastAutoOrder, setLastAutoOrder] = useState<LiveAutoOrder | null>(null)
  const [tradeNotice, setTradeNotice] = useState<string | null>(null)
  const [assetWarning, setAssetWarning] = useState<string | null>(null)
  const [sessionToken, setSessionToken] = useState('')
  const [authStatus, setAuthStatus] =
    useState<LiveBotSession['authStatus']>('unauthenticated')
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const sessionTokenRef = useRef('')
  const addLiveTrade = useLabStore((state) => state.addLiveTrade)
  const autoTrade = useLabStore((state) => state.isAutoTradeEnabled)
  const stake = useLabStore((state) => state.botStake)
  const accountBalance = useLabStore((state) => state.accountBalance)
  const accountCurrency = useLabStore((state) => state.accountCurrency)
  const accountType = useLabStore((state) => state.accountType)
  const setIsAutoTradeEnabled = useLabStore((state) => state.setIsAutoTradeEnabled)
  const setBotStake = useLabStore((state) => state.setBotStake)
  const setAccountBalance = useLabStore((state) => state.setAccountBalance)
  const setAvailableAssets = useLabStore((state) => state.setAvailableAssets)
  const applyRealCandles = useMarketStore((state) => state.applyRealCandles)

  const setAutoTrade = useCallback((enabled: boolean) => {
    setIsAutoTradeEnabled(
      enabled && status === 'connected' && authenticatedSocket === activeSocket,
    )
  }, [setIsAutoTradeEnabled, status])

  const setStake = useCallback((amount: number) => {
    setBotStake(amount)
  }, [setBotStake])

  const authenticateSessionToken = useCallback((token: string) => {
    const normalizedToken = token.trim()
    sessionTokenRef.current = normalizedToken
    setSessionToken(normalizedToken)
    authenticatedSocket = null
    setIsAutoTradeEnabled(false)
    setAuthStatus(normalizedToken === '' ? 'unauthenticated' : 'pending')
    setAuthNotice(
      normalizedToken === ''
        ? 'Token removido da memória desta sessão.'
        : 'Validando o token de sessão...',
    )

    const socket = activeSocket
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ action: 'auth', token: normalizedToken }))
    } else if (normalizedToken !== '') {
      setAuthNotice('Token mantido somente em memória; será validado ao conectar.')
    }
  }, [setIsAutoTradeEnabled])

  const setLiveMode = useCallback((live: boolean) => {
    if (live && authStatus !== 'authenticated') {
      setModeNotice('Autentique o token de sessão antes de alterar o modo.')
      return
    }
    try {
      sendLiveModeCommand(live)
      setModeNotice(
        live
          ? 'Solicitação LIVE enviada. Se necessário, confirme duas vezes no terminal do bot.'
          : 'Solicitação para voltar ao DRY-RUN enviada.',
      )
    } catch (error) {
      setModeNotice(error instanceof Error ? error.message : 'Falha ao alterar o modo.')
    }
  }, [authStatus])

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let disposed = false
    let attempt = 0

    const scheduleReconnect = () => {
      if (disposed) return
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt)
      attempt += 1
      reconnectTimer = window.setTimeout(connect, delay)
    }

    const connect = () => {
      if (disposed) return
      reconnectTimer = undefined

      // Nunca abre uma nova conexão enquanto a anterior ainda estiver aberta
      // (OPEN) ou sendo aberta (CONNECTING). O close() só acontece em estado
      // terminal — fechar durante CONNECTING é o que polui o console.
      if (socket !== null) {
        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          return
        }
        socket.close()
      }

      setStatus('connecting')
      const connectedSocket = new WebSocket(SOCKET_URL)
      socket = connectedSocket
      activeSocket = connectedSocket

      connectedSocket.onopen = () => {
        attempt = 0
        authenticatedSocket = null
        sentStrategyLogKeys.clear()
        setStatus('connected')
        if (sessionTokenRef.current !== '') {
          setAuthStatus('pending')
          setAuthNotice('Autenticando token de sessão...')
          connectedSocket.send(
            JSON.stringify({ action: 'auth', token: sessionTokenRef.current }),
          )
        } else {
          setAuthStatus('unauthenticated')
        }
        flushPendingStrategyLogs(connectedSocket)
      }

      connectedSocket.onmessage = (event: MessageEvent<string>) => {
        if (activeSocket !== connectedSocket) return
        try {
          const message = parseMessage(JSON.parse(event.data) as unknown)
          if (message === null) {
            setStatus('error')
            setIsAutoTradeEnabled(false)
            return
          }
          setStatus('connected')
          setLastMessage(message)
          if (message.type === 'strategy_log_result') {
            handleStrategyLogResult(message)
          } else if (message.type === 'auth_result') {
            authenticatedSocket = message.authenticated ? connectedSocket : null
            setAuthStatus(
              message.authenticated
                ? 'authenticated'
                : sessionTokenRef.current === ''
                  ? 'unauthenticated'
                  : 'rejected',
            )
            setAuthNotice(
              message.authenticated
                ? 'Token de sessão autenticado.'
                : message.reason ?? 'Token de sessão recusado.',
            )
            if (!message.authenticated) setIsAutoTradeEnabled(false)
          } else if (message.type === 'account_balance') {
            setAccountBalance(message.balance, message.currency, message.account_type)
          } else if (message.type === 'assets_status') {
            setAvailableAssets(message.assets)
          } else if (message.type === 'real_candles') {
            applyRealCandles(
              message.asset,
              message.timeframe,
              message.candles,
              message.timestamp,
            )
          } else if (message.type === 'mode_changed') {
            setLiveModeEnabled(message.live)
            setModeNotice(
              message.live ? 'Modo LIVE confirmado pelo bot.' : 'Modo DRY-RUN confirmado pelo bot.',
            )
          } else if (message.type === 'mode_error') {
            setModeNotice(`Modo não alterado: ${message.reason}`)
          } else if (message.type === 'trade_error') {
            // Ativo suspenso/indisponível é aviso de negócio (banner amarelo);
            // não é falha de conexão, então o status segue 'connected'.
            const notice = resolveTradeErrorNotice(message.reason)
            if (notice.kind === 'warning') {
              setAssetWarning(notice.text)
            } else {
              setTradeNotice(notice.text)
            }
            setLastAutoOrder((order) =>
              order?.stage === 'sent'
                ? { ...order, stage: 'error', errorReason: message.reason }
                : order,
            )
          } else if (message.type === 'trade_open') {
            setTradeNotice(`Operação aberta: ${message.direction} ${message.asset}`)
            setLastAutoOrder((order) => {
              if (!matchesAutoOrder(order, message)) return order
              return {
                ...order,
                stage: 'open',
                ...(message.trade_id === undefined ? {} : { tradeId: message.trade_id }),
              }
            })
          } else if (message.type === 'trade_result') {
            setTradeNotice(
              message.result === 'SKIPPED'
                ? `Ordem não enviada: ${message.reason ?? 'ativo indisponível na corretora.'}`
                : `Ordem concluída: ${message.result} · ${message.pnl > 0 ? '+' : ''}$${message.pnl.toFixed(2)}`,
            )
            setLastAutoOrder((order) => {
              if (!matchesAutoOrder(order, message)) return order
              return {
                ...order,
                stage: 'result',
                result: message.result,
                pnl: message.pnl,
                ...(message.reason === undefined ? {} : { errorReason: message.reason }),
                ...(message.trade_id === undefined ? {} : { tradeId: message.trade_id }),
              }
            })
          }
          if (message.type === 'trade_open' || message.type === 'trade_result') {
            addLiveTrade(message)
          }
        } catch {
          setStatus('error')
          setIsAutoTradeEnabled(false)
        }
      }

      connectedSocket.onerror = () => {
        if (activeSocket !== connectedSocket) return
        setStatus('error')
        authenticatedSocket = null
        setAuthStatus(sessionTokenRef.current === '' ? 'unauthenticated' : 'pending')
        setIsAutoTradeEnabled(false)
      }

      connectedSocket.onclose = () => {
        const wasActive = activeSocket === connectedSocket
        if (wasActive) activeSocket = null
        if (authenticatedSocket === connectedSocket) authenticatedSocket = null
        if (socket === connectedSocket) socket = null
        sentStrategyLogKeys.clear()
        for (const timer of strategyLogAckTimers.values()) clearTimeout(timer)
        strategyLogAckTimers.clear()
        if (!wasActive) return
        setAuthStatus(sessionTokenRef.current === '' ? 'unauthenticated' : 'pending')
        setIsAutoTradeEnabled(false)
        if (disposed) return
        setStatus((current) => (current === 'error' ? 'error' : 'disconnected'))
        scheduleReconnect()
      }
    }

    connect()
    return () => {
      disposed = true
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      if (activeSocket === socket) activeSocket = null
      const closing = socket
      socket = null
      if (closing === null) return
      // Fechar um socket em CONNECTING gera erro no console do browser. Nesse
      // caso solta os handlers e só fecha quando a abertura terminar.
      if (closing.readyState === WebSocket.CONNECTING) {
        closing.onmessage = null
        closing.onerror = null
        closing.onclose = null
        closing.onopen = () => closing.close()
        return
      }
      closing.close()
    }
  }, [
    addLiveTrade,
    applyRealCandles,
    setAccountBalance,
    setAvailableAssets,
    setIsAutoTradeEnabled,
  ])

  // Limpa o aviso de trade após 5s para não deixar a tela presa em um erro antigo.
  useEffect(() => {
    if (tradeNotice === null) return
    const timer = window.setTimeout(() => setTradeNotice(null), 5_000)
    return () => window.clearTimeout(timer)
  }, [tradeNotice])

  // Banner amarelo de ativo indisponível some sozinho após 5s.
  useEffect(() => {
    if (assetWarning === null) return
    return scheduleNoticeClear(() => setAssetWarning(null))
  }, [assetWarning])

  return {
    status,
    lastMessage,
    accountBalance,
    accountCurrency,
    accountType,
    liveModeEnabled,
    modeNotice,
    lastAutoOrder,
    isLive: status === 'connected',
    autoTrade,
    stake,
    tradeNotice,
    assetWarning,
    sessionToken,
    authStatus,
    authNotice,
    setAutoTrade,
    setStake,
    setTradeNotice,
    setAssetWarning,
    setLastAutoOrder,
    setLiveMode,
    authenticateSessionToken,
  }
}

function matchesAutoOrder(
  order: LiveAutoOrder | null,
  message: LiveTradeOpenMessage | LiveTradeResultMessage,
): order is LiveAutoOrder {
  const timestampSec = Math.floor(Date.parse(message.timestamp) / 1000)
  return (
    order !== null &&
    order.stage !== 'error' &&
    order.asset === message.asset &&
    order.direction === message.direction &&
    Number.isFinite(timestampSec) &&
    timestampSec >= order.sentAtSec &&
    (order.tradeId === undefined ||
      message.trade_id === undefined ||
      order.tradeId === message.trade_id)
  )
}
