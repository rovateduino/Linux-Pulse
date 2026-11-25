import type { CandleDirection } from '../types/market'
import type {
  BacktestMetrics,
  BacktestTrade,
  BaselineKind,
  BaselineOpportunity,
  BaselineResult,
  EquityPoint,
  GateResult,
  RunBaselinesInput,
} from '../types/lab'
import { computeMetrics } from './backtest'
import { edgeGate } from './edgeGate'
import { wilson } from './wilson'
import { findAsset } from '../data/assets'
import { resolveOutcome } from '../lib/backtest/resolveOutcome'

export const RANDOM_BASELINE_TRIALS = 1000
export const RANDOM_BASELINE_SEED = 0x9e3779b1

function clampStake(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function tradeFor(
  opportunity: BaselineOpportunity,
  direction: CandleDirection,
  kind: BaselineKind,
  payout: number,
  stake: number,
): BacktestTrade {
  const { result: outcome, pnl: pnlUsd } = resolveOutcome(
    opportunity.entryPrice,
    opportunity.exitPrice,
    direction,
    payout,
    { stake, tickSize: findAsset(opportunity.symbol).tickSize },
  )
  return {
    id: `${kind}-${opportunity.timeframe}-${opportunity.triggerIndex}`,
    symbol: opportunity.symbol,
    timeframe: opportunity.timeframe,
    playbook: 'A',
    direction,
    lastCandleDirection: opportunity.lastDirection,
    triggerIndex: opportunity.triggerIndex,
    triggerTime: opportunity.triggerTime,
    entryIndex: opportunity.entryIndex,
    entryTime: opportunity.entryTime,
    entryPrice: opportunity.entryPrice,
    exitIndex: opportunity.exitIndex,
    exitTime: opportunity.exitTime,
    exitPrice: opportunity.exitPrice,
    outcome,
    payout,
    pnlUsd,
    split: opportunity.split,
  }
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

function deterministicMetrics(
  opportunities: readonly BaselineOpportunity[],
  directionFor: (opportunity: BaselineOpportunity) => CandleDirection,
  kind: BaselineKind,
  payout: number,
  stake: number,
): BacktestMetrics {
  if (opportunities.length === 0) return emptyMetrics(payout)
  const trades = opportunities.map((opportunity) =>
    tradeFor(opportunity, directionFor(opportunity), kind, payout, stake),
  )
  return computeMetrics(trades, payout, stake)
}

function randomMetrics(
  opportunities: readonly BaselineOpportunity[],
  payout: number,
  stake: number,
  trials: number,
  seed: number,
): BacktestMetrics {
  const n = opportunities.length
  if (n === 0) return emptyMetrics(payout)

  const random = mulberry32(seed)
  const cumulative = new Array<number>(n).fill(0)
  let winsSum = 0
  let lossesSum = 0
  let tiesSum = 0
  let pnlSum = 0
  let unitSum = 0
  let drawdownSum = 0

  for (let trial = 0; trial < trials; trial += 1) {
    let pnl = 0
    let peak = 0
    let drawdown = 0
    for (let index = 0; index < n; index += 1) {
      const opportunity = opportunities[index]
      const direction: CandleDirection = random() < 0.5 ? 'UP' : 'DOWN'
      const { result: outcome, pnl: value } = resolveOutcome(
        opportunity.entryPrice,
        opportunity.exitPrice,
        direction,
        payout,
        { stake, tickSize: findAsset(opportunity.symbol).tickSize },
      )
      pnl += value
      unitSum += value / stake
      peak = Math.max(peak, pnl)
      drawdown = Math.max(drawdown, peak - pnl)
      cumulative[index] += pnl
      if (outcome === 'WIN') winsSum += 1
      else if (outcome === 'LOSS') lossesSum += 1
      else tiesSum += 1
    }
    pnlSum += pnl
    drawdownSum += drawdown
  }

  const wins = winsSum / trials
  const winRate = wins / n
  const [low, high] = wilson(winRate, n)
  const equity: EquityPoint[] = [{ index: 0, time: opportunities[0].entryTime, value: 0 }]
  cumulative.forEach((value, index) => {
    equity.push({
      index: index + 1,
      time: opportunities[index].exitTime,
      value: value / trials,
    })
  })

  return {
    n,
    wins,
    losses: lossesSum / trials,
    ties: tiesSum / trials,
    winRate,
    low,
    high,
    breakeven: 1 / (1 + Math.max(0, payout)),
    expectancy: unitSum / (trials * n),
    pnlUsd: pnlSum / trials,
    maxDrawdown: drawdownSum / trials,
    equity,
  }
}

function gateFor(
  metrics: BacktestMetrics,
  payout: number,
): GateResult {
  return edgeGate(metrics.wins, metrics.n, payout)
}

export function runBaselines(input: RunBaselinesInput): BaselineResult[] {
  const stake = clampStake(input.stake)
  const payout = Number.isFinite(input.payout) ? Math.max(0, input.payout) : 0
  const opportunities = input.opportunities.filter(
    (opportunity) => opportunity.split === 'teste',
  )
  const trials = Math.min(
    5000,
    Math.max(1, Math.round(input.trials ?? RANDOM_BASELINE_TRIALS)),
  )
  const seed = input.seed ?? RANDOM_BASELINE_SEED

  const random = randomMetrics(opportunities, payout, stake, trials, seed)
  const alwaysCall = deterministicMetrics(
    opportunities,
    () => 'UP',
    'sempre_call',
    payout,
    stake,
  )
  const lastCandle = deterministicMetrics(
    opportunities,
    (opportunity) => opportunity.lastDirection,
    'ultima_vela',
    payout,
    stake,
  )

  return [
    {
      kind: 'aleatoria',
      label: `Direção aleatória · ${trials} sorteios`,
      timeframe: input.timeframe,
      trials,
      seed,
      metrics: random,
      gate: gateFor(random, payout),
    },
    {
      kind: 'sempre_call',
      label: 'Sempre CALL',
      timeframe: input.timeframe,
      trials: 1,
      seed: null,
      metrics: alwaysCall,
      gate: gateFor(alwaysCall, payout),
    },
    {
      kind: 'ultima_vela',
      label: 'Repetir a última vela',
      timeframe: input.timeframe,
      trials: 1,
      seed: null,
      metrics: lastCandle,
      gate: gateFor(lastCandle, payout),
    },
  ]
}
