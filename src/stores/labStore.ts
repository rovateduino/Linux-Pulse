import { create } from 'zustand'
import {
  LAB_DEFAULT_SYMBOL,
  SIMULATED_SYMBOL,
  TIMEFRAME_LABEL,
  findAsset,
} from '../data/assets'
import { generateSimulatedM1, generateSimulatedM5 } from '../data/simulator'
import { DEFAULT_SESSIONS } from '../config/sessions'
import { fetchBinanceCandles, isAbortError } from '../engine/binanceImport'
import { edgeThresholds, evaluateEdge } from '../engine/edgeGate'
import { listGrid } from '../engine/grid'
import {
  candleCacheKey,
  listBotCandlesCache,
  readBotCandlesCache,
  readCandlesCache,
  writeBotCandlesCache,
  writeCandlesCache,
  writeEdgeHistory,
} from '../lib/idb'
import type { BotCandleCacheEntry } from '../lib/idb'
import { nextEngineConfigFromSettings } from '../lib/settings'
import { appendShadowTrades } from '../store/edgeBookStore'
import { useMarketStore } from '../store/marketStore'
import { useJournalStore } from '../store/journalStore'
import type { EdgeVerdictRecord } from '../types/edge'
import type { Candle } from '../types/market'
import type {
  AvailableAsset,
  AccountType,
  LiveTrade,
  LiveTradeOpenMessage,
  LiveTradeResultMessage,
} from '../types/liveBot'
import type {
  BacktestResult,
  BaselineResult,
  BotDatasetSummary,
  DatasetState,
  GridCombo,
  LabConfig,
  LabDataset,
  LabRunInfo,
  LabRunPhase,
  LabTimeframe,
  PlaybookId,
  WorkerRequest,
  WorkerResponse,
} from '../types/lab'

export const LAB_DAYS = 60
const M1_SECONDS = 60
const M1_PER_DAY = 1440
const M5_SECONDS = 300
const M5_PER_DAY = 288
const LAB_TIMEFRAME_SECONDS: Readonly<Record<LabTimeframe, number>> = {
  '1m': M1_SECONDS,
  '5m': M5_SECONDS,
  '15m': 900,
}
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const SIMULATED_BUILD_DELAY_MS = 40

/** Trava rígida de segurança: nenhum ativo envia mais do que isso por hora. */
export const MAX_ORDERS_PER_HOUR = 10
export const ORDER_RATE_WINDOW_MS = 60 * 60 * 1000

/**
 * Janela móvel de 1 hora: devolve apenas as ordens cujo timestamp ainda está
 * dentro do limite. Usada tanto pela trava de envio quanto pelo contador da UI.
 */
export function recentOrderTimestamps(
  timestamps: readonly number[],
  nowMs: number,
): number[] {
  return timestamps.filter((timestamp) => nowMs - timestamp < ORDER_RATE_WINDOW_MS)
}

const RUNNING_PHASES: readonly LabRunPhase[] = [
  'carregando',
  'treinando',
  'validando',
  'testando',
  'baselines',
]

export function isLabRunActive(phase: LabRunPhase): boolean {
  return RUNNING_PHASES.includes(phase)
}

function cancelledError(): Error {
  const error = new Error('Importação cancelada.')
  error.name = 'AbortError'
  return error
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return 'Falha ao carregar os candles.'
}

function lastClosedStart(nowMs: number, stepSeconds: number): number {
  return (Math.floor(nowMs / (stepSeconds * 1000)) - 1) * stepSeconds
}

/**
 * Dataset simulado no passo do timeframe base: M1 usa 60 s por vela
 * (SECONDS_PER_MINUTE); M5 e M15 seguem a série M5, que o motor agrega
 * para 15m. Nada é inventado: a série é determinística e fechada.
 */
function buildSimulatedDataset(symbol: string, baseTimeframe: LabTimeframe): LabDataset {
  if (baseTimeframe === '1m') {
    const expected = LAB_DAYS * M1_PER_DAY
    const start = lastClosedStart(Date.now(), M1_SECONDS) - (expected - 1) * M1_SECONDS
    const candles = generateSimulatedM1(findAsset(SIMULATED_SYMBOL), start, expected)
    return {
      symbol,
      source: 'simulado',
      candles,
      fetchedAt: Date.now(),
      gaps: Math.max(0, expected - candles.length),
      expected,
    }
  }

  const expected = LAB_DAYS * M5_PER_DAY
  const start = lastClosedStart(Date.now(), M5_SECONDS) - (expected - 1) * M5_SECONDS
  const candles = generateSimulatedM5(findAsset(SIMULATED_SYMBOL), start, expected)
  return {
    symbol,
    source: 'simulado',
    candles,
    fetchedAt: Date.now(),
    gaps: Math.max(0, expected - candles.length),
    expected,
  }
}

/**
 * Passo modal (segundos) entre velas: a régua real do arquivo. Retorna 0
 * quando não há intervalos positivos para medir.
 */
function modalStep(candles: readonly Candle[]): number {
  if (candles.length < 2) return 0

  const counts = new Map<number, number>()
  for (let index = 1; index < candles.length; index += 1) {
    const diff = candles[index].time - candles[index - 1].time
    if (diff > 0) counts.set(diff, (counts.get(diff) ?? 0) + 1)
  }

  let step = 0
  let best = 0
  counts.forEach((count, diff) => {
    if (count > best || (count === best && (step === 0 || diff < step))) {
      best = count
      step = diff
    }
  })
  return step
}

/**
 * Continuidade real do arquivo importado: o passo mais frequente entre velas
 * vira a régua e as posições ausentes viram lacuna. Nada é preenchido.
 */
function csvCoverage(
  candles: readonly Candle[],
  timeframe: LabTimeframe | null = null,
): { expected: number; gaps: number; step: number } {
  const step = timeframe === null ? modalStep(candles) : LAB_TIMEFRAME_SECONDS[timeframe]
  if (candles.length < 2 || step <= 0) {
    return { expected: candles.length, gaps: 0, step }
  }

  if (candles[0].time % step !== 0) {
    throw new Error(
      `O primeiro candle não está alinhado ao timeframe declarado ${timeframe?.toUpperCase() ?? `${step}s`}.`,
    )
  }

  for (let index = 1; index < candles.length; index += 1) {
    if ((candles[index].time - candles[index - 1].time) % step !== 0) {
      throw new Error(
        `Intervalo de candles incompatível com o timeframe declarado ${timeframe?.toUpperCase() ?? `${step}s`}.`,
      )
    }
  }

  const span = candles[candles.length - 1].time - candles[0].time
  const expected = Math.round(span / step) + 1
  return { expected, gaps: Math.max(0, expected - candles.length), step }
}

/**
 * Compatibilidade entre o passo real dos candles carregados e o timeframe base.
 * O motor fatia '5m' direto do dataset e agrega os demais a partir dele; rodar
 * M5 como M1 (ou o inverso) produziria tempos silenciosamente errados na
 * confirmação e nas divisões. Nada é reamostrado aqui — o conflito é recusado.
 */
export function datasetStepError(
  candles: readonly Candle[],
  base: LabTimeframe,
  declaredTimeframe: LabTimeframe | null = null,
): string | null {
  if (declaredTimeframe !== null) {
    if (declaredTimeframe !== base) {
      return `O CSV declara ${TIMEFRAME_LABEL[declaredTimeframe]}, mas o Laboratório está configurado para ${TIMEFRAME_LABEL[base]}.`
    }
    try {
      csvCoverage(candles, declaredTimeframe)
    } catch (error) {
      return messageOf(error)
    }
    return null
  }

  const step = modalStep(candles)
  if (step <= 0) return null

  const compatible =
    base === '1m'
      ? step <= 60 && 60 % step === 0
      : base === '5m'
        ? step === 300
        : step <= 900 && 900 % step === 0
  if (compatible) return null

  if (base === '1m') {
    return `Os candles carregados têm passo de ${step} s e não podem rodar como M1. Gere o simulado com M1 selecionado ou importe um CSV com timeframe M1/1m — ou escolha M5/M15.`
  }
  if (base === '5m') {
    return `Os candles carregados têm passo de ${step} s e não podem rodar como M5. Selecione M1 ou M15, gere o simulado em M5 ou importe um CSV M5.`
  }
  return `Os candles carregados têm passo de ${step} s, incompatível com M15 (esperado velas de 60, 300 ou 900 s).`
}

function normalizeConfig(patch: Partial<LabConfig>, current: LabConfig): LabConfig {
  const next = { ...current, ...patch }
  const payoutInput = patch.payout ?? current.payout
  const payout = Number.isFinite(payoutInput)
    ? Math.min(0.99, Math.max(0.05, payoutInput))
    : current.payout
  const expiryInput = patch.expiryCandles ?? current.expiryCandles
  const expiryCandles = Number.isFinite(expiryInput)
    ? Math.min(3, Math.max(1, Math.round(expiryInput)))
    : current.expiryCandles
  const confirmation =
    next.baseTimeframe === '15m' && next.confirmation === '15m'
      ? '30m'
      : next.confirmation
  const legacyPlaybooks = next.legacyPlaybooks === true
  const playbookInput = patch.playbook ?? next.playbook
  const playbook: PlaybookId =
    playbookInput === 'C' || playbookInput === 'D'
      ? playbookInput
      : legacyPlaybooks && (playbookInput === 'A' || playbookInput === 'B')
        ? playbookInput
        : 'C'

  return { ...next, payout, expiryCandles, confirmation, playbook, legacyPlaybooks }
}

export function isCacheFresh(fetchedAt: number, nowMs = Date.now()): boolean {
  return nowMs - fetchedAt <= CACHE_MAX_AGE_MS
}

/**
 * Estado derivado ao carregar um dataset do bot (importado agora ou lido do
 * IndexedDB): o ativo vira `customAssetName` e o dataset fica pronto na chave
 * do próprio nome do ativo.
 */
function readyBotState(
  dataset: LabDataset,
  cached: boolean,
): (current: LabStore) => Partial<LabStore> {
  return (current) => ({
    customAssetName: dataset.symbol,
    datasets: {
      ...current.datasets,
      [dataset.symbol]: { status: 'ready', dataset, cached },
    },
    ...(current.config.symbol === dataset.symbol
      ? {
          phase: 'idle' as LabRunPhase,
          progress: 0,
          results: [],
          baselines: [],
          verdicts: [],
          runInfo: null,
        }
      : {}),
  })
}

/** Converte entradas persistidas em resumos ordenados do mais recente ao mais antigo. */
function summariesFromBotEntries(
  entries: readonly BotCandleCacheEntry[],
): BotDatasetSummary[] {
  return entries
    .map((entry) => ({
      symbol: entry.symbol,
      timeframe: entry.timeframe,
      candleCount: entry.candles.length,
      fetchedAt: entry.fetchedAt,
      gaps: entry.gaps,
      expected: entry.expected,
      fileName: entry.fileName,
    }))
    .sort((first, second) => second.fetchedAt - first.fetchedAt)
}

/**
 * Vereditos do Edge Gate (fail-fast) para cada resultado da rodada, a partir das
 * métricas fora da amostra. Alimentam o badge do Dashboard e o histórico de
 * auditoria no IndexedDB.
 */
function verdictRecord(
  id: string,
  symbol: string,
  timeframe: BacktestResult['timeframe'],
  playbook: BacktestResult['playbook'],
  stats: { n: number; wins: number },
  payout: number,
  computedAt: number,
): EdgeVerdictRecord {
  const { n, wins } = stats
  const verdict = evaluateEdge({ n, wins }, payout)
  const { breakeven, se, killBound, confirmBound } = edgeThresholds(payout, n)
  return {
    id,
    symbol,
    timeframe,
    playbook,
    computedAt,
    payout,
    n,
    wins,
    winRate: verdict.winRate,
    se,
    breakeven,
    killBound,
    confirmBound,
    kind: verdict.kind,
    reason: verdict.reason,
  }
}

function verdictRecordsFromResults(
  results: readonly BacktestResult[],
  payout: number,
  computedAt: number,
): EdgeVerdictRecord[] {
  const records = results.map((result) =>
    verdictRecord(
      `${result.symbol}:${result.timeframe}:${result.playbook}:${computedAt}`,
      result.symbol,
      result.timeframe,
      result.playbook,
      result.test,
      payout,
      computedAt,
    ),
  )
  // Visão de portfólio: quando a rodada cobre múltiplos ativos, o Edge Gate
  // avalia a soma de N e wins de todos os resultados — o bot opera onde o
  // setup aparecer, então a significância é do conjunto, não do ativo.
  if (results.length > 1) {
    const first = results[0]
    const total = results.reduce(
      (acc, result) => ({ n: acc.n + result.test.n, wins: acc.wins + result.test.wins }),
      { n: 0, wins: 0 },
    )
    records.push(
      verdictRecord(
        `PORTFOLIO:${first.timeframe}:${first.playbook}:${computedAt}`,
        'PORTFÓLIO',
        first.timeframe,
        first.playbook,
        total,
        payout,
        computedAt,
      ),
    )
  }
  return records
}

interface LabStore {
  config: LabConfig
  customAssetName: string | null
  botStake: number
  isAutoTradeEnabled: boolean
  sentOrdersTimestamps: number[]
  rateLimitBlockedAt: number | null
  accountBalance: number | null
  accountCurrency: string
  accountType: AccountType | null
  availableAssets: AvailableAsset[]
  liveTrades: LiveTrade[]
  datasets: Record<string, DatasetState>
  savedBotDatasets: BotDatasetSummary[]
  grid: GridCombo[]
  gridAccepted: boolean
  phase: LabRunPhase
  progress: number
  runError: string | null
  results: BacktestResult[]
  baselines: BaselineResult[]
  verdicts: EdgeVerdictRecord[]
  runInfo: LabRunInfo | null
  setConfig: (patch: Partial<LabConfig>) => void
  setBotStake: (stake: number) => void
  setIsAutoTradeEnabled: (enabled: boolean) => void
  setSentOrdersTimestamps: (timestamps: number[]) => void
  setRateLimitBlockedAt: (blockedAt: number | null) => void
  setAccountBalance: (balance: number, currency: string, accountType: AccountType) => void
  setAvailableAssets: (assets: AvailableAsset[]) => void
  clearDiaryHistory: () => void
  addLiveTrade: (message: LiveTradeOpenMessage | LiveTradeResultMessage) => void
  ensureDataset: (symbol: string) => void
  importSymbol: (symbol: string) => Promise<void>
  importCsvCandles: (
    symbol: string,
    candles: readonly Candle[],
    declaredTimeframe?: LabTimeframe | null,
    customAssetName?: string,
    fileName?: string | null,
  ) => void
  refreshSavedBotDatasets: () => Promise<void>
  loadSavedBotDataset: (symbol: string) => Promise<void>
  clearDataset: () => void
  previewGrid: () => void
  run: () => void
  cancel: () => void
  clearError: () => void
}

let activeWorker: Worker | null = null
const importControllers = new Map<string, AbortController>()
const cacheReads = new Set<string>()

const INITIAL_CONFIG: LabConfig = {
  symbol: LAB_DEFAULT_SYMBOL,
  baseTimeframe: '5m',
  confirmation: '15m',
  payout: 0.85,
  expiryCandles: 1,
  playbook: 'C',
  legacyPlaybooks: false,
}

export const useLabStore = create<LabStore>()((set, get) => ({
  config: INITIAL_CONFIG,
  customAssetName: null,
  botStake: 1,
  isAutoTradeEnabled: false,
  sentOrdersTimestamps: [],
  rateLimitBlockedAt: null,
  accountBalance: null,
  accountCurrency: 'USD',
  accountType: null,
  availableAssets: [],
  liveTrades: [],
  datasets: {},
  savedBotDatasets: [],
  grid: [],
  gridAccepted: false,
  phase: 'idle',
  progress: 0,
  runError: null,
  results: [],
  baselines: [],
  verdicts: [],
  runInfo: null,

  setBotStake: (botStake) => {
    if (Number.isFinite(botStake) && botStake >= 0.1 && botStake <= 10) {
      set({ botStake })
    }
  },
  setIsAutoTradeEnabled: (isAutoTradeEnabled) =>
    set(
      isAutoTradeEnabled
        ? { isAutoTradeEnabled, rateLimitBlockedAt: null }
        : { isAutoTradeEnabled },
    ),
  setSentOrdersTimestamps: (sentOrdersTimestamps) => set({ sentOrdersTimestamps }),
  setRateLimitBlockedAt: (rateLimitBlockedAt) => set({ rateLimitBlockedAt }),
  setAccountBalance: (accountBalance, accountCurrency, accountType) => {
    if (
      Number.isFinite(accountBalance) &&
      accountBalance >= 0 &&
      accountCurrency.trim() !== '' &&
      (accountType === 'PRACTICE' || accountType === 'REAL')
    ) {
      set({ accountBalance, accountCurrency, accountType })
    }
  },
  setAvailableAssets: (availableAssets) => set({ availableAssets: [...availableAssets] }),
  clearDiaryHistory: () => {
    const analyses = useMarketStore.getState().analyses
    const clearedRecordIds = new Set<string>()
    for (const analysis of Object.values(analyses)) {
      for (const record of analysis.records) clearedRecordIds.add(record.id)
      if (analysis.signal.active !== null) clearedRecordIds.add(analysis.signal.active.id)
    }
    useJournalStore.getState().reset([...clearedRecordIds])
    set({ liveTrades: [] })
  },

  addLiveTrade: (message) => {
    set((state) => {
      const liveTrades = [...state.liveTrades]
      if (message.type === 'trade_open') {
        const id =
          message.trade_id ??
          `${message.asset}:${message.direction}:${message.timestamp}`
        const trade: LiveTrade = {
          id,
          asset: message.asset,
          direction: message.direction,
          amount: message.amount,
          entryPrice: message.entry_price,
          expiration: message.expiration,
          result: null,
          pnl: null,
          openedAt: message.timestamp,
          closedAt: null,
        }
        const existingIndex = liveTrades.findIndex((current) => current.id === id)
        if (existingIndex >= 0) liveTrades[existingIndex] = trade
        else liveTrades.push(trade)
      } else {
        let matchingTradeIndex = message.trade_id
          ? liveTrades.findIndex((current) => current.id === message.trade_id)
          : -1
        if (message.trade_id === undefined) {
          for (let index = liveTrades.length - 1; index >= 0; index -= 1) {
            const current = liveTrades[index]
            if (
              current.asset === message.asset &&
              current.direction === message.direction &&
              current.result === null
            ) {
              matchingTradeIndex = index
              break
            }
          }
        }
        if (matchingTradeIndex >= 0) {
          const current = liveTrades[matchingTradeIndex]
          liveTrades[matchingTradeIndex] = {
            ...current,
            result: message.result,
            pnl: message.pnl,
            closedAt: message.timestamp,
          }
        } else {
          liveTrades.push({
            id:
              message.trade_id ??
              `${message.asset}:${message.direction}:${message.timestamp}`,
            asset: message.asset,
            direction: message.direction,
            amount: null,
            entryPrice: null,
            expiration: null,
            result: message.result,
            pnl: message.pnl,
            openedAt: null,
            closedAt: message.timestamp,
          })
        }
      }

      return { liveTrades: liveTrades.slice(-500) }
    })
  },

  setConfig: (patch) => {
    const state = get()
    const config = normalizeConfig(patch, state.config)
    const changed =
      config.symbol !== state.config.symbol ||
      config.baseTimeframe !== state.config.baseTimeframe ||
      config.confirmation !== state.config.confirmation ||
      config.payout !== state.config.payout ||
      config.expiryCandles !== state.config.expiryCandles ||
      config.playbook !== state.config.playbook ||
      config.legacyPlaybooks !== state.config.legacyPlaybooks
    if (!changed) return

    if (isLabRunActive(state.phase)) get().cancel()

    const selectedDataset = state.datasets[config.symbol]
    set({
      config,
      customAssetName:
        selectedDataset?.status === 'ready' && selectedDataset.dataset.source === 'bot'
          ? selectedDataset.dataset.symbol
          : null,
      grid: [],
      gridAccepted: false,
      phase: 'idle',
      progress: 0,
      runError: null,
      results: [],
      baselines: [],
      verdicts: [],
      runInfo: null,
    })

    if (config.symbol !== state.config.symbol) {
      get().ensureDataset(config.symbol)
    }

    // Dataset simulado é gerado localmente: ao trocar o timeframe base para um
    // passo incompatível (ex.: M5 → M1), ele é regerado no novo passo.
    const dataset = state.datasets[config.symbol]
    if (
      config.baseTimeframe !== state.config.baseTimeframe &&
      dataset?.status === 'ready' &&
      dataset.dataset.source === 'simulado' &&
      datasetStepError(
        dataset.dataset.candles,
        config.baseTimeframe,
        dataset.dataset.timeframe,
      ) !== null
    ) {
      const rebuilt = buildSimulatedDataset(config.symbol, config.baseTimeframe)
      set((current) => ({
        datasets: {
          ...current.datasets,
          [config.symbol]: { status: 'ready', dataset: rebuilt, cached: false },
        },
      }))
    }
  },

  ensureDataset: (symbol) => {
    const state = get()
    const current = state.datasets[symbol]
    if (current !== undefined && current.status !== 'idle' && current.status !== 'error') {
      return
    }
    if (cacheReads.has(symbol)) return
    if (symbol === SIMULATED_SYMBOL) {
      void get().importSymbol(symbol)
      return
    }

    cacheReads.add(symbol)
    set((previous) => ({
      datasets: { ...previous.datasets, [symbol]: { status: 'parsing' } },
    }))

    void readCandlesCache(symbol, LAB_DAYS)
      .then((entry) => {
        const latest = get().datasets[symbol]
        if (latest?.status !== 'parsing') return
        if (entry !== null && entry.candles.length > 0) {
          const dataset: LabDataset = {
            symbol,
            source: 'binance',
            candles: entry.candles,
            fetchedAt: entry.fetchedAt,
            gaps: entry.gaps,
            expected: LAB_DAYS * M5_PER_DAY,
          }
          set((previous) => ({
            datasets: {
              ...previous.datasets,
              [symbol]: { status: 'ready', dataset, cached: true },
            },
          }))
          return
        }
        set((previous) => ({
          datasets: { ...previous.datasets, [symbol]: { status: 'idle' } },
        }))
      })
      .catch(() => {
        const latest = get().datasets[symbol]
        if (latest?.status !== 'parsing') return
        set((previous) => ({
          datasets: { ...previous.datasets, [symbol]: { status: 'idle' } },
        }))
      })
      .finally(() => {
        cacheReads.delete(symbol)
      })
  },

  importSymbol: async (symbol) => {
    const state = get()
    if (isLabRunActive(state.phase)) return

    const previous = state.datasets[symbol]
    const fallback: DatasetState =
      previous?.status === 'ready' ? previous : { status: 'idle' }

    importControllers.get(symbol)?.abort()
    const controller = new AbortController()
    importControllers.set(symbol, controller)

    set((current) => ({
      datasets: {
        ...current.datasets,
        [symbol]: { status: 'fetching', progress: 0 },
      },
    }))

    try {
      let dataset: LabDataset

      if (symbol === SIMULATED_SYMBOL) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, SIMULATED_BUILD_DELAY_MS)
        })
        if (controller.signal.aborted) throw cancelledError()
        set((current) => ({
          datasets: {
            ...current.datasets,
            [symbol]: { status: 'parsing' },
          },
        }))
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0)
        })
        if (controller.signal.aborted) throw cancelledError()
        dataset = buildSimulatedDataset(symbol, get().config.baseTimeframe)
      } else {
        dataset = await fetchBinanceCandles(symbol, {
          days: LAB_DAYS,
          signal: controller.signal,
          onProgress: (pct) => {
            const latest = get().datasets[symbol]
            if (
              latest?.status === 'fetching' &&
              importControllers.get(symbol) === controller
            ) {
              set((current) => ({
                datasets: {
                  ...current.datasets,
                  [symbol]: { status: 'fetching', progress: pct },
                },
              }))
            }
          },
        })
        set((current) => ({
          datasets: {
            ...current.datasets,
            [symbol]: { status: 'parsing' },
          },
        }))
        void writeCandlesCache({
          id: candleCacheKey(symbol, LAB_DAYS),
          symbol,
          interval: '5m',
          days: LAB_DAYS,
          fetchedAt: dataset.fetchedAt,
          gaps: dataset.gaps,
          candles: dataset.candles,
        }).catch(() => undefined)
      }

      const ready: DatasetState = { status: 'ready', dataset, cached: false }
      set((current) => ({
        datasets: { ...current.datasets, [symbol]: ready },
        ...(current.config.symbol === symbol
          ? {
              phase: 'idle' as LabRunPhase,
              progress: 0,
              results: [],
              baselines: [],
              verdicts: [],
              runInfo: null,
            }
          : {}),
      }))
    } catch (error) {
      if (isAbortError(error)) {
        const latest = get().datasets[symbol]
        if (latest?.status === 'fetching' || latest?.status === 'parsing') {
          set((current) => ({
            datasets: { ...current.datasets, [symbol]: fallback },
          }))
        }
        return
      }
      set((current) => ({
        datasets: {
          ...current.datasets,
          [symbol]: { status: 'error', message: messageOf(error) },
        },
      }))
    } finally {
      if (importControllers.get(symbol) === controller) {
        importControllers.delete(symbol)
      }
    }
  },

  importCsvCandles: (
    symbol,
    candles,
    declaredTimeframe = null,
    customAssetName,
    fileName = null,
  ) => {
    const state = get()
    if (isLabRunActive(state.phase)) return
    if (candles.length === 0) return

    const datasetSymbol = customAssetName?.trim() || symbol
    const coverage = csvCoverage(candles, declaredTimeframe)

    const dataset: LabDataset = {
      symbol: datasetSymbol,
      source: 'bot',
      candles: [...candles],
      timeframe: declaredTimeframe,
      fetchedAt: Date.now(),
      gaps: coverage.gaps,
      expected: coverage.expected,
    }

    if (get().config.symbol !== datasetSymbol) {
      get().setConfig({ symbol: datasetSymbol })
    }

    set(readyBotState(dataset, false))

    // Persiste o CSV no IndexedDB pelo nome do ativo: reimportar o mesmo ativo
    // sobrescreve a entrada anterior.
    void writeBotCandlesCache({
      symbol: datasetSymbol,
      source: 'bot',
      timeframe: declaredTimeframe,
      fetchedAt: dataset.fetchedAt,
      gaps: dataset.gaps,
      expected: dataset.expected,
      fileName,
      candles: dataset.candles,
    })
      .then(() => get().refreshSavedBotDatasets())
      .catch(() => undefined)

    // Associa o laboratório ao timeframe declarado no arquivo (ex.: M1/1m).
    if (declaredTimeframe !== null && declaredTimeframe !== state.config.baseTimeframe) {
      get().setConfig({ baseTimeframe: declaredTimeframe })
    }
  },

  refreshSavedBotDatasets: async () => {
    const entries = await listBotCandlesCache()
    set({ savedBotDatasets: summariesFromBotEntries(entries) })
  },

  loadSavedBotDataset: async (symbol) => {
    const state = get()
    if (isLabRunActive(state.phase)) return

    const entry = await readBotCandlesCache(symbol)
    if (isLabRunActive(get().phase)) return

    if (entry === null) {
      // Entrada ausente (removida em outro separador): limpa o resumo local.
      set({
        savedBotDatasets: get().savedBotDatasets.filter((saved) => saved.symbol !== symbol),
      })
      return
    }

    const dataset: LabDataset = {
      symbol: entry.symbol,
      source: 'bot',
      candles: entry.candles,
      timeframe: entry.timeframe,
      fetchedAt: entry.fetchedAt,
      gaps: entry.gaps,
      expected: entry.expected,
    }

    if (get().config.symbol !== dataset.symbol) {
      get().setConfig({ symbol: dataset.symbol })
    }

    set(readyBotState(dataset, true))

    if (entry.timeframe !== null && entry.timeframe !== get().config.baseTimeframe) {
      get().setConfig({ baseTimeframe: entry.timeframe })
    }
  },

  clearDataset: () => {
    const state = get()
    if (isLabRunActive(state.phase)) return

    const symbol = state.config.symbol
    set((current) => ({
      datasets: {
        ...current.datasets,
        [symbol]: { status: 'idle' },
      },
      phase: 'idle',
      progress: 0,
      results: [],
      baselines: [],
      verdicts: [],
      runInfo: null,
    }))
  },

  previewGrid: () => {
    const state = get()
    if (isLabRunActive(state.phase)) return
    set({
      grid: listGrid([state.config.symbol], [state.config.baseTimeframe], [
        state.config.playbook,
      ]),
      gridAccepted: true,
      runError: null,
    })
  },

  run: () => {
    const state = get()
    if (isLabRunActive(state.phase)) return

    const datasetState = state.datasets[state.config.symbol]
    if (datasetState?.status !== 'ready') {
      set({
        phase: 'error',
        progress: 0,
        runError: 'Carregue os candles antes de rodar o backtest.',
      })
      return
    }
    const stepError = datasetStepError(
      datasetState.dataset.candles,
      state.config.baseTimeframe,
      datasetState.dataset.timeframe,
    )
    if (stepError !== null) {
      set({ phase: 'error', progress: 0, runError: stepError })
      return
    }
    if (!state.gridAccepted || state.grid.length === 0) {
      set({
        phase: 'error',
        progress: 0,
        runError: 'Pré-visualize o grid antes de rodar o backtest.',
      })
      return
    }

    const runSymbol =
      datasetState.dataset.source === 'bot'
        ? state.customAssetName ?? datasetState.dataset.symbol
        : state.config.symbol

    activeWorker?.terminate()
    const worker = new Worker(new URL('../workers/backtest.worker.ts', import.meta.url), {
      type: 'module',
    })
    activeWorker = worker

    const request: WorkerRequest = {
      type: 'run',
      config: {
        symbol: runSymbol,
        timeframe: state.config.baseTimeframe,
        confirmation: state.config.confirmation,
        payout: state.config.payout,
        expiryCandles: state.config.expiryCandles,
        candles: datasetState.dataset.candles,
        playbooks: [...new Set(state.grid.map((combo) => combo.playbook))],
        sessions: state.config.sessions ?? DEFAULT_SESSIONS,
        nextEngineConfig: nextEngineConfigFromSettings(
          useJournalStore.getState().settings,
          state.config.baseTimeframe === '1m'
            ? 1
            : state.config.baseTimeframe === '5m'
              ? 5
              : 15,
        ),
      },
    }

    set({
      phase: 'carregando',
      progress: 0,
      runError: null,
      results: [],
      baselines: [],
      verdicts: [],
      runInfo: null,
    })

    worker.onmessage = async (event: MessageEvent<WorkerResponse>) => {
      if (activeWorker !== worker) return
      const message = event.data

      if (message.type === 'progress') {
        set({
          phase: message.phase,
          progress: Math.min(100, Math.max(0, Math.round(message.pct))),
        })
        return
      }

      if (message.type === 'done') {
        const config = get().config
        const symbol =
          datasetState.dataset.source === 'bot'
            ? get().customAssetName ?? datasetState.dataset.symbol
            : config.symbol
        let nextShadow: LabRunInfo['nextShadow']
        if (message.nextShadow.status === 'complete') {
          let persistedTrades: number
          try {
            persistedTrades = await appendShadowTrades(
              symbol,
              message.nextShadow.timeframeMinutes,
              message.nextShadow.shadowTrades,
            )
          } catch (error) {
            if (activeWorker !== worker) return
            const reason =
              error instanceof Error ? error.message : 'Falha inesperada ao salvar o EdgeBook.'
            set({
              phase: 'error',
              progress: 0,
              runError: `Backtest concluído, mas o EdgeBook não foi persistido: ${reason}`,
            })
            worker.terminate()
            activeWorker = null
            return
          }
          nextShadow = {
            status: 'complete',
            timeframeMinutes: message.nextShadow.timeframeMinutes,
            persistedTrades,
            summary: message.nextShadow.summary,
            stats: message.nextShadow.stats,
          }
        } else {
          nextShadow = message.nextShadow
        }
        if (activeWorker !== worker) return
        const verdicts = verdictRecordsFromResults(
          message.results,
          config.payout,
          message.generatedAt,
        )
        void writeEdgeHistory(verdicts).catch(() => undefined)
        const runInfo: LabRunInfo = {
          symbol,
          timeframe: config.baseTimeframe,
          source: datasetState.dataset.source,
          generatedAt: message.generatedAt,
          trades: message.results.reduce((total, result) => total + result.overall.n, 0),
          playbookId: config.playbook,
          split: message.split,
          sessionsUsed: message.sessionsUsed,
          pctCandlesFiltrados: message.pctCandlesFiltrados,
          nextShadow,
        }
        set({
          results: message.results,
          baselines: message.baselines,
          verdicts,
          runInfo,
          phase: 'done',
          progress: 100,
        })
        worker.terminate()
        activeWorker = null
        return
      }

      set({ phase: 'error', progress: 0, runError: message.message })
      worker.terminate()
      activeWorker = null
    }

    worker.onerror = (event) => {
      if (activeWorker !== worker) return
      const message =
        typeof event.message === 'string' && event.message.trim() !== ''
          ? event.message
          : 'Falha no worker do backtest.'
      set({ phase: 'error', progress: 0, runError: message })
      worker.terminate()
      activeWorker = null
    }

    worker.postMessage(request)
  },

  cancel: () => {
    if (activeWorker !== null) {
      activeWorker.terminate()
      activeWorker = null
    }
    set({ phase: 'cancelled', progress: 0 })
  },

  clearError: () => {
    set({ runError: null })
  },
}))
