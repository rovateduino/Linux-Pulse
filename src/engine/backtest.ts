import type { Candle, CandleDirection, SignalPlaybook, TradeOutcome } from '../types/market'
import type {
  BacktestMetrics,
  BacktestResult,
  BacktestTrade,
  BaselineOpportunity,
  EquityPoint,
  LabConfirmation,
  LabTimeframe,
  RunBacktestInput,
  RunBacktestOutput,
  SessionWindow,
  SplitName,
  SplitRange,
} from '../types/lab'
import { aggregateCandles } from '../data/simulator'
import { findAsset } from '../data/assets'
import { DEFAULT_SESSIONS } from '../config/sessions'
import { resolveOutcome } from '../lib/backtest/resolveOutcome'
import { filterCandlesBySession, isInSession } from '../lib/backtest/sessionFilter'
import {
  BASE_STRATEGY,
  WARMUP_INDEX,
  evaluateSetup,
  prepareConfirmation,
  prepareMarket,
  type PreparedConfirmation,
  type PreparedMarket,
  type SetupTiming,
  type StrategyConfig,
} from './strategy'
import { edgeGate } from './edgeGate'
import { comboId } from './grid'
import { PLAYBOOKS, isRegistryPlaybook } from './playbooks'
import { wilson } from './wilson'

export const LAB_STAKE_USD = 10
export const LAB_TIMEFRAME_SECONDS: Record<LabTimeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
}
export const LAB_CONFIRMATION_SECONDS: Record<LabConfirmation, number> = {
  '15m': 900,
  '30m': 1800,
}

const TRAIN_SHARE = 0.6
const VALIDATION_SHARE = 0.8

function clampExpiry(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(3, Math.max(1, Math.round(value)))
}

function clampStake(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return LAB_STAKE_USD
  return value
}

function buildSplits(base: readonly Candle[], frameSeconds: number): SplitRange[] {
  if (base.length === 0) return []
  const trainEnd = Math.floor(base.length * TRAIN_SHARE)
  const validationEnd = Math.floor(base.length * VALIDATION_SHARE)

  const range = (name: SplitName, startIndex: number, endIndex: number): SplitRange => {
    const first = base[Math.min(startIndex, base.length - 1)]
    const last = base[Math.min(Math.max(endIndex - 1, startIndex), base.length - 1)]
    return {
      name,
      startIndex,
      endIndex,
      startTime: first.time,
      endTime: last.time + frameSeconds,
    }
  }

  return [
    range('treino', 0, trainEnd),
    range('validacao', trainEnd, validationEnd),
    range('teste', validationEnd, base.length),
  ]
}

function splitForIndex(index: number, splits: readonly SplitRange[]): SplitName {
  for (const split of splits) {
    if (index >= split.startIndex && index < split.endIndex) return split.name
  }
  return 'teste'
}

function emptyMetrics(payout: number): BacktestMetrics {
  return {
    n: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    winRate: 0,
    low: 0,
    high: 0,
    breakeven: 1 / (1 + Math.max(0, payout)),
    expectancy: 0,
    pnlUsd: 0,
    maxDrawdown: 0,
    equity: [],
  }
}

export function computeMetrics(
  trades: readonly BacktestTrade[],
  payout: number,
  stake: number,
): BacktestMetrics {
  if (trades.length === 0) return emptyMetrics(payout)

  const ordered = [...trades].sort(
    (a, b) => a.exitTime - b.exitTime || a.id.localeCompare(b.id),
  )
  const safeStake = clampStake(stake)
  const equity: EquityPoint[] = [
    { index: 0, time: ordered[0].entryTime, value: 0 },
  ]
  let wins = 0
  let losses = 0
  let ties = 0
  let pnlUsd = 0
  let unitPnl = 0
  let peak = 0
  let maxDrawdown = 0

  ordered.forEach((trade, position) => {
    if (trade.outcome === 'WIN') wins += 1
    else if (trade.outcome === 'LOSS') losses += 1
    else ties += 1
    pnlUsd += trade.pnlUsd
    unitPnl += trade.pnlUsd / safeStake
    peak = Math.max(peak, pnlUsd)
    maxDrawdown = Math.max(maxDrawdown, peak - pnlUsd)
    equity.push({ index: position + 1, time: trade.exitTime, value: pnlUsd })
  })

  const n = ordered.length
  const winRate = wins / n
  const [low, high] = wilson(winRate, n)

  return {
    n,
    wins,
    losses,
    ties,
    winRate,
    low,
    high,
    breakeven: 1 / (1 + Math.max(0, payout)),
    expectancy: unitPnl / n,
    pnlUsd,
    maxDrawdown,
    equity,
  }
}

interface SimulateInput {
  symbol: string
  timeframe: LabTimeframe
  playbook: SignalPlaybook
  frameSeconds: number
  expiryCandles: number
  payout: number
  stake: number
  strategy: StrategyConfig
  splits: readonly SplitRange[]
  prepared: PreparedMarket
  confirmation: PreparedConfirmation
  timing: SetupTiming
  sessions: readonly SessionWindow[]
}

function simulatePlaybook(input: SimulateInput): BacktestTrade[] {
  const {
    symbol,
    timeframe,
    playbook,
    frameSeconds,
    expiryCandles,
    payout,
    stake,
    strategy,
    splits,
    prepared,
    confirmation,
    timing,
    sessions,
  } = input
  const candles = prepared.candles
  const sessionWindows: SessionWindow[] = [...sessions]
  const trades: BacktestTrade[] = []
  const spacing = Math.max(1, Math.round(strategy.spacingCandles))
  const pauseAfter = Math.max(1, Math.round(strategy.pauseAfterLosses))
  const pauseSeconds = Math.max(0, strategy.pauseMinutes) * 60
  const evaluator = isRegistryPlaybook(playbook) ? PLAYBOOKS[playbook] : null
  const cfg = findAsset(symbol)

  let lastTriggerIndex: number | null = null
  let pausedUntil: number | null = null
  let lossStreak = 0
  let pendingSettlements: Array<{
    exitIndex: number
    exitTime: number
    outcome: TradeOutcome
  }> = []

  for (let index = WARMUP_INDEX; index < candles.length; index += 1) {
    const settled = pendingSettlements
      .filter((settlement) => settlement.exitIndex <= index)
      .sort((left, right) => left.exitIndex - right.exitIndex)
    pendingSettlements = pendingSettlements.filter(
      (settlement) => settlement.exitIndex > index,
    )
    for (const settlement of settled) {
      if (settlement.outcome === 'LOSS') {
        lossStreak += 1
        if (lossStreak >= pauseAfter) {
          pausedUntil = settlement.exitTime + pauseSeconds
          lossStreak = 0
        }
      } else {
        lossStreak = 0
      }
    }

    // Playbooks do registry (C/D) avaliam direto sobre os candles; os
    // legados (A/B) passam por evaluateSetup, que escolhe por regime.
    let direction: CandleDirection | null
    if (evaluator !== null) {
      direction = evaluator(candles, index, cfg, sessionWindows)?.direction ?? null
    } else {
      const evaluation = evaluateSetup(prepared, confirmation, index, timing)
      direction =
        evaluation.ready && evaluation.playbook === playbook ? evaluation.direction : null
    }
    if (direction === null) continue

    const triggerCandle = candles[index]
    const triggerClose = triggerCandle.time + frameSeconds
    if (pausedUntil !== null && triggerClose <= pausedUntil) continue
    if (lastTriggerIndex !== null && index - lastTriggerIndex < spacing) continue

    const entryIndex = index + 1
    const exitIndex = index + expiryCandles
    if (entryIndex >= candles.length || exitIndex >= candles.length) continue

    const entryCandle = candles[entryIndex]
    const exitCandle = candles[exitIndex]
    if (
      !Number.isFinite(entryCandle.open) ||
      entryCandle.open <= 0 ||
      !Number.isFinite(exitCandle.close)
    ) {
      continue
    }
    // Filtro de sessão: seleção pura do funil de entrada. A máquina de estados
    // (espaçamento/pausa) segue idêntica; apenas a ordem é bloqueada fora da
    // janela. Não toca nos playbooks nem na série de indicadores.
    const inSession = isInSession(entryCandle.time, sessionWindows)

    const { result: outcome, pnl: pnlUsd } = resolveOutcome(
      entryCandle.open,
      exitCandle.close,
      direction,
      payout,
      { stake, tickSize: findAsset(symbol).tickSize },
    )
    const exitTime = entryCandle.time + expiryCandles * frameSeconds

    if (inSession) {
      trades.push({
        id: `${comboId(symbol, timeframe, playbook)}-${triggerCandle.time}`,
        symbol,
        timeframe,
        playbook,
        direction,
        lastCandleDirection: triggerCandle.close >= triggerCandle.open ? 'UP' : 'DOWN',
        triggerIndex: index,
        triggerTime: triggerCandle.time,
        entryIndex,
        entryTime: entryCandle.time,
        entryPrice: entryCandle.open,
        exitIndex,
        exitTime,
        exitPrice: exitCandle.close,
        outcome,
        payout,
        pnlUsd,
        split: splitForIndex(entryIndex, splits),
      })
    }

    lastTriggerIndex = index
    pendingSettlements.push({ exitIndex, exitTime, outcome })
  }

  return trades
}

function metricsMap(
  trades: readonly BacktestTrade[],
  split: SplitName,
  payout: number,
  stake: number,
  playbooks: readonly SignalPlaybook[],
): Map<SignalPlaybook, BacktestMetrics> {
  const output = new Map<SignalPlaybook, BacktestMetrics>()
  for (const playbook of playbooks) {
    output.set(
      playbook,
      computeMetrics(
        trades.filter((trade) => trade.playbook === playbook && trade.split === split),
        payout,
        stake,
      ),
    )
  }
  return output
}

export function runBacktest(
  input: RunBacktestInput,
  onProgress?: (phase: 'treinando' | 'validando' | 'testando', pct: number) => void,
): RunBacktestOutput {
  const frameSeconds = LAB_TIMEFRAME_SECONDS[input.timeframe]
  const confirmationSeconds = LAB_CONFIRMATION_SECONDS[input.confirmation]
  if (confirmationSeconds <= frameSeconds) {
    throw new Error('O timeframe de confirmação precisa ser maior que o timeframe base.')
  }
  if (input.m5Candles.length === 0) {
    throw new Error('Nenhum candle M5 disponível para o backtest.')
  }

  const base =
    input.timeframe === '5m'
      ? input.m5Candles.slice()
      : aggregateCandles(input.m5Candles, frameSeconds)
  const confirmation = aggregateCandles(input.m5Candles, confirmationSeconds)

  if (base.length <= WARMUP_INDEX + 10) {
    throw new Error(
      `Histórico insuficiente: ${base.length} velas ${input.timeframe.toUpperCase()} para um aquecimento de ${WARMUP_INDEX + 1}.`,
    )
  }
  if (confirmation.length < 55) {
    throw new Error('Histórico insuficiente para a confirmação de tendência.')
  }

  const payout = Number.isFinite(input.payout) ? Math.max(0, input.payout) : 0
  const expiryCandles = clampExpiry(input.expiryCandles)
  const stake = clampStake(input.stake ?? LAB_STAKE_USD)
  const strategy = input.strategy ?? BASE_STRATEGY
  const playbooks: readonly SignalPlaybook[] =
    input.playbooks !== undefined && input.playbooks.length > 0
      ? [...new Set(input.playbooks)]
      : ['C', 'D']
  const splits = buildSplits(base, frameSeconds)
  const prepared = prepareMarket(base)
  const preparedConfirmation = prepareConfirmation(confirmation)
  const timing: SetupTiming = { candleSeconds: frameSeconds, confirmationSeconds }
  const sessionsUsed: SessionWindow[] = [
    ...(input.sessions !== undefined && input.sessions.length > 0
      ? input.sessions
      : DEFAULT_SESSIONS),
  ]
  const keptCandles = filterCandlesBySession(base, sessionsUsed)
  const pctCandlesFiltrados =
    base.length === 0 ? 0 : (1 - keptCandles.length / base.length) * 100

  onProgress?.('treinando', 8)
  const trades: BacktestTrade[] = []
  for (const playbook of playbooks) {
    trades.push(
      ...simulatePlaybook({
        symbol: input.symbol,
        timeframe: input.timeframe,
        playbook,
        frameSeconds,
        expiryCandles,
        payout,
        stake,
        strategy,
        splits,
        prepared,
        confirmation: preparedConfirmation,
        timing,
        sessions: sessionsUsed,
      }),
    )
  }
  onProgress?.('treinando', 45)

  const train = metricsMap(trades, 'treino', payout, stake, playbooks)
  onProgress?.('treinando', 55)
  const validation = metricsMap(trades, 'validacao', payout, stake, playbooks)
  onProgress?.('validando', 68)
  const test = metricsMap(trades, 'teste', payout, stake, playbooks)
  onProgress?.('testando', 80)

  const results: BacktestResult[] = playbooks.map((playbook) => {
    const playbookTrades = trades.filter((trade) => trade.playbook === playbook)
    const testMetrics = test.get(playbook) ?? emptyMetrics(payout)
    return {
      comboId: comboId(input.symbol, input.timeframe, playbook),
      symbol: input.symbol,
      timeframe: input.timeframe,
      playbook,
      splits,
      train: train.get(playbook) ?? emptyMetrics(payout),
      validation: validation.get(playbook) ?? emptyMetrics(payout),
      test: testMetrics,
      overall: computeMetrics(playbookTrades, payout, stake),
      gate: edgeGate(testMetrics.wins, testMetrics.n, payout),
      trades: playbookTrades,
    }
  })

  const opportunityMap = new Map<number, BaselineOpportunity>()
  for (const trade of trades) {
    if (!opportunityMap.has(trade.triggerIndex)) {
      opportunityMap.set(trade.triggerIndex, {
        symbol: trade.symbol,
        timeframe: trade.timeframe,
        triggerIndex: trade.triggerIndex,
        triggerTime: trade.triggerTime,
        entryIndex: trade.entryIndex,
        exitIndex: trade.exitIndex,
        entryTime: trade.entryTime,
        entryPrice: trade.entryPrice,
        exitTime: trade.exitTime,
        exitPrice: trade.exitPrice,
        lastDirection: trade.lastCandleDirection,
        split: trade.split,
      })
    }
  }

  onProgress?.('testando', 88)

  return {
    results,
    split: splits,
    sessionsUsed,
    pctCandlesFiltrados,
    opportunities: [...opportunityMap.values()].sort(
      (a, b) => a.triggerIndex - b.triggerIndex,
    ),
  }
}

const OUTCOME_CSV: Record<TradeOutcome, string> = {
  WIN: 'ACERTO',
  LOSS: 'ERRO',
  TIE: 'EMPATE',
}

function csvPrice(value: number): string {
  const fixed = value.toFixed(4)
  const trimmed = fixed.includes('.')
    ? fixed.replace(/0+$/, '').replace(/\.$/, '')
    : fixed
  return trimmed.replace('.', ',')
}

function csvFixed(value: number, digits: number): string {
  return value.toFixed(digits).replace('.', ',')
}

export function labTradesCsv(trades: readonly BacktestTrade[]): string {
  const header = [
    'timestamp_utc',
    'ativo',
    'timeframe',
    'playbook',
    'direcao',
    'entrada',
    'saida',
    'resultado',
    'payout',
    'pnl_usd',
  ]
  const rows = [...trades]
    .sort((a, b) => a.entryTime - b.entryTime || a.id.localeCompare(b.id))
    .map((trade) => [
      new Date(trade.entryTime * 1000).toISOString(),
      trade.symbol,
      trade.timeframe === '1m' ? 'M1' : trade.timeframe === '5m' ? 'M5' : 'M15',
      trade.playbook,
      trade.direction === 'UP' ? 'COMPRA' : 'VENDA',
      csvPrice(trade.entryPrice),
      csvPrice(trade.exitPrice),
      OUTCOME_CSV[trade.outcome],
      csvFixed(trade.payout, 2),
      csvFixed(trade.pnlUsd, 2),
    ])
  return [header.join(';'), ...rows.map((row) => row.join(';'))].join('\r\n')
}
