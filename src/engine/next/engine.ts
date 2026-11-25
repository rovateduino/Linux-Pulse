import { ContextBuilder, validateSeries } from './context.js'
import { evaluateGate, freshState, rewardRiskOf } from './gate.js'
import type { RuntimeState } from './gate.js'
import { MODULES } from './modules.js'
import type { SetupModule } from './modules.js'
import { EdgeBook } from './stats.js'
import type {
  BucketStats,
  Candle,
  EngineConfig,
  GateDecision,
  SetupCandidate,
  Signal,
  TradeResult,
} from './types.js'

export interface BacktestOptions {
  /** true = gate so aprende com sessoes anteriores (unico modo honesto) */
  walkForward?: boolean
  modules?: SetupModule[]
}

export interface BacktestReport {
  signals: Signal[]
  trades: TradeResult[]
  /** todos os setups simulados (inclusive os barrados pelo gate) */
  shadowTrades: TradeResult[]
  blocked: number
  blockReasons: Array<{ reason: string; count: number }>
  stats: BucketStats[]
  summary: {
    signals: number
    trades: number
    shadowTrades: number
    shadowWinRate: number
    shadowExpectancyR: number
    shadowEvPerStake: number | null
    winRate: number
    expectancyR: number
    evPerStake: number | null
    totalR: number
    profitFactor: number
    maxDrawdownR: number
    signalsPerDay: number
    sessions: number
  }
}

interface SimulationResult {
  trade: TradeResult
  settlementIndex: number
}

function simulate(
  candidate: Signal,
  ctxIndex: number,
  builder: ContextBuilder,
  cfg: EngineConfig,
): SimulationResult | null {
  const candles = builder.candles
  const entryIdx = ctxIndex + 1
  if (entryIdx >= candles.length) return null
  const entryCandle = candles[entryIdx]
  const dir = candidate.direction === 'long' ? 1 : -1
  const mode = cfg.mode ?? 'r'
  const expiryBars = Math.max(1, cfg.expiryOverrideCandles ?? candidate.expiryCandles)
  // em expiracao fixa o custo esta no payout, nao no preco
  const entry = mode === 'expiry' ? entryCandle.open : entryCandle.open + dir * (cfg.costPerTrade / 2)
  const risk = Math.abs(candidate.reference - candidate.stop)
  if (mode !== 'expiry' && !(risk > 0)) return null

  const expiryIdx = entryIdx + expiryBars - 1
  const hasCompleteExpiry = expiryIdx < candles.length
  if (mode === 'expiry' && !hasCompleteExpiry) return null
  const settledAtExpiry =
    hasCompleteExpiry
      ? dir === 1
        ? candles[expiryIdx].close > entry
          ? 'win'
          : candles[expiryIdx].close < entry
            ? 'loss'
            : 'draw'
        : candles[expiryIdx].close < entry
          ? 'win'
          : candles[expiryIdx].close > entry
            ? 'loss'
            : 'draw'
      : null
  const expiryWin = settledAtExpiry === 'win'
  const evPerStake =
    settledAtExpiry === 'win'
      ? cfg.payoutRatio
      : settledAtExpiry === 'loss'
        ? -1
        : settledAtExpiry === 'draw'
          ? cfg.expiryDrawPolicy === 'loss'
            ? -1
            : 0
          : null

  if (mode === 'expiry') {
    const exitCandle = candles[expiryIdx]
    const directionalMoveR =
      risk > 0 ? ((exitCandle.close - entry) * dir) / risk : 0
    return {
      trade: {
        moduleId: candidate.moduleId,
        bucket: candidate.bucket,
        direction: candidate.direction,
        sessionId: candidate.sessionId,
        entryTime: entryCandle.time,
        exitTime: exitCandle.time,
        entry,
        exit: exitCandle.close,
        stop: candidate.stop,
        target: candidate.target,
        risk,
        rMultiple: directionalMoveR,
        expiryWin,
        expiryOutcome: settledAtExpiry,
        evPerStake,
        outcome: 'time',
        costs: 0,
      },
      settlementIndex: expiryIdx,
    }
  }

  const lastIdx = Math.min(expiryIdx, candles.length - 1)
  const sessionLength = cfg.session.closeMinute - cfg.session.openMinute
  let exit = candles[lastIdx].close - dir * (cfg.costPerTrade / 2)
  let exitTime = candles[lastIdx].time
  let settlementIndex = lastIdx
  let outcome: TradeResult['outcome'] = 'time'

  for (let j = entryIdx; j <= lastIdx; j++) {
    const c = candles[j]
    const mfo = builder.minutesFromOpen(c)
    if (mfo > sessionLength) {
      const prev = candles[Math.max(entryIdx, j - 1)]
      exit = prev.close - dir * (cfg.costPerTrade / 2)
      exitTime = prev.time
      settlementIndex = Math.max(entryIdx, j - 1)
      outcome = 'session_end'
      break
    }
    if (dir === 1) {
      // conservador: stop tem prioridade se ambos forem tocados no mesmo candle
      if (c.low <= candidate.stop) {
        exit = candidate.stop - dir * (cfg.costPerTrade / 2)
        exitTime = c.time
        settlementIndex = j
        outcome = 'stop'
        break
      }
      if (candidate.target > 0 && c.high >= candidate.target) {
        exit = candidate.target - dir * (cfg.costPerTrade / 2)
        exitTime = c.time
        settlementIndex = j
        outcome = 'target'
        break
      }
    } else {
      if (c.high >= candidate.stop) {
        exit = candidate.stop - dir * (cfg.costPerTrade / 2)
        exitTime = c.time
        settlementIndex = j
        outcome = 'stop'
        break
      }
      if (candidate.target > 0 && c.low <= candidate.target) {
        exit = candidate.target - dir * (cfg.costPerTrade / 2)
        exitTime = c.time
        settlementIndex = j
        outcome = 'target'
        break
      }
    }
  }

  const rMultiple = ((exit - entry) * dir) / risk

  return {
    trade: {
      moduleId: candidate.moduleId,
      bucket: candidate.bucket,
      direction: candidate.direction,
      sessionId: candidate.sessionId,
      entryTime: entryCandle.time,
      exitTime,
      entry,
      exit,
      stop: candidate.stop,
      target: candidate.target,
      risk,
      rMultiple,
      expiryWin,
      expiryOutcome: settledAtExpiry,
      evPerStake,
      outcome,
      costs: cfg.costPerTrade,
    },
    settlementIndex,
  }
}

function toSignal(
  candidate: ReturnType<SetupModule['evaluate']> & object,
  ctx: ReturnType<ContextBuilder['contextAt']>,
  decision: GateDecision,
  cfg?: EngineConfig,
): Signal {
  const risk = Math.abs(candidate.reference - candidate.stop)
  return {
    ...candidate,
    id: `${candidate.moduleId}-${ctx.sessionId}-${ctx.index}`,
    time: ctx.candle.time,
    sessionId: ctx.sessionId,
    entry: candidate.reference,
    expiryCandles: cfg?.expiryOverrideCandles ?? candidate.expiryCandles,
    risk,
    rewardRisk: rewardRiskOf(candidate),
    probability: decision.probability,
    expectancyR: decision.expectancyR,
    evPerStake: decision.evPerStake,
    sampleSize: decision.sampleSize,
    regime: ctx.regime,
    phase: ctx.phase,
  }
}

export function runBacktest(candles: Candle[], cfg: EngineConfig, options: BacktestOptions = {}): BacktestReport {
  const walkForward = options.walkForward !== false
  const modules = options.modules ?? MODULES
  validateConfig(cfg)
  const problems = validateSeries(candles, cfg.timeframeMinutes, cfg.session.utcOffsetMinutes)
  if (problems.length) {
    throw new Error(`serie invalida: ${problems.join(' | ')}`)
  }

  const builder = new ContextBuilder(candles, cfg)
  const master = new EdgeBook()
  const signals: Signal[] = []
  const trades: TradeResult[] = []
  const allShadow: TradeResult[] = []
  const blockCounts = new Map<string, number>()
  let blocked = 0
  let pendingShadow: TradeResult[] = []
  const timeframeSeconds = cfg.timeframeMinutes * 60

  // agrupa indices por sessao
  const sessionStarts: number[] = []
  let lastSession = ''
  for (let i = 0; i < candles.length; i++) {
    const sid = builder.sessionIdAt(i)
    if (sid !== lastSession) {
      sessionStarts.push(i)
      lastSession = sid
    }
  }

  for (let s = 0; s < sessionStarts.length; s++) {
    const from = sessionStarts[s]
    const to = s + 1 < sessionStarts.length ? sessionStarts[s + 1] - 1 : candles.length - 1
    const sessionStartTime = candles[from].time
    const settledShadow: TradeResult[] = []
    const unresolvedShadow: TradeResult[] = []
    for (const trade of pendingShadow) {
      if (trade.exitTime + timeframeSeconds <= sessionStartTime) {
        settledShadow.push(trade)
      } else {
        unresolvedShadow.push(trade)
      }
    }
    master.addAll(settledShadow)
    pendingShadow = unresolvedShadow
    const snapshot = walkForward ? master.clone() : master
    const dayId = builder.sessionIdAt(from)
    const state: RuntimeState = freshState(dayId)
    const sessionTrades: TradeResult[] = []
    const sessionShadow: TradeResult[] = []
    let pendingStateSettlements: Array<{ index: number; trade: TradeResult }> = []

    for (let i = from; i <= to; i++) {
      const settled = pendingStateSettlements
        .filter((settlement) => settlement.index <= i)
        .sort((left, right) => left.index - right.index)
      pendingStateSettlements = pendingStateSettlements.filter(
        (settlement) => settlement.index > i,
      )
      for (const { index, trade } of settled) {
        const settledContext = builder.contextAt(index)
        if (
          ((trade.expiryOutcome === 'loss' ||
            (trade.expiryOutcome === 'draw' && cfg.expiryDrawPolicy === 'loss')) &&
            (cfg.mode ?? 'r') === 'expiry') ||
          ((cfg.mode ?? 'r') !== 'expiry' && trade.rMultiple <= 0)
        ) {
          state.consecutiveLosses++
          state.cooldownUntilIndex = index + cfg.cooldownCandlesAfterLoss
          if (state.consecutiveLosses >= cfg.pauseAfterConsecutiveLosses) {
            state.pausedUntilMinute = settledContext.minutesFromOpen + cfg.pauseMinutes
            state.consecutiveLosses = 0
          }
        } else if (
          (trade.expiryOutcome === 'win' && (cfg.mode ?? 'r') === 'expiry') ||
          ((cfg.mode ?? 'r') !== 'expiry' && trade.rMultiple > 0)
        ) {
          state.consecutiveLosses = 0
        }
      }

      const ctx = builder.contextAt(i)
      if (ctx.phase === 'pre' || ctx.phase === 'post') continue
      for (const mod of modules) {
        const candidate = mod.evaluate(ctx, cfg)
        if (!candidate) continue
        // mede o setup sempre (modo sombra): e assim que o gate aprende a edge
        const signal = toSignal(
          candidate,
          ctx,
          {
            allowed: false,
            reasons: [],
            probability: 0,
            expectancyR: 0,
            evPerStake: 0,
            sampleSize: 0,
            breakeven: 0,
          },
          cfg,
        )
        const sim = simulate(signal, i, builder, cfg)
        if (!sim) continue
        sessionShadow.push(sim.trade)
        allShadow.push(sim.trade)

        const decision = evaluateGate(candidate, ctx, snapshot, cfg, state)
        if (!decision.allowed) {
          blocked++
          const key = decision.reasons[decision.reasons.length - 1].slice(0, 70)
          blockCounts.set(key, (blockCounts.get(key) ?? 0) + 1)
          continue
        }
        signals.push(toSignal(candidate, ctx, decision, cfg))
        trades.push(sim.trade)
        sessionTrades.push(sim.trade)
        state.signalsToday++
        pendingStateSettlements.push({ index: sim.settlementIndex, trade: sim.trade })
      }
    }
    // O livro só libera resultados depois do fechamento da vela de saída.
    pendingShadow.push(...sessionShadow)
  }
  master.addAll(pendingShadow)

  const wins = trades.filter((t) => t.rMultiple > 0).length
  const totalR = trades.reduce((a, t) => a + t.rMultiple, 0)
  let peak = 0
  let equity = 0
  let maxDd = 0
  for (const t of trades) {
    equity += t.rMultiple
    peak = Math.max(peak, equity)
    maxDd = Math.max(maxDd, peak - equity)
  }
  const grossWin = trades.filter((t) => t.rMultiple > 0).reduce((a, t) => a + t.rMultiple, 0)
  const grossLoss = Math.abs(trades.filter((t) => t.rMultiple <= 0).reduce((a, t) => a + t.rMultiple, 0))
  const shadowWins = allShadow.filter((t) => t.rMultiple > 0).length
  const shadowTotalR = allShadow.reduce((a, t) => a + t.rMultiple, 0)
  const evPerStake =
    (cfg.mode ?? 'r') === 'expiry' && trades.length > 0
      ? trades.reduce((total, trade) => total + (trade.evPerStake ?? 0), 0) / trades.length
      : null
  const shadowEvPerStake =
    (cfg.mode ?? 'r') === 'expiry' && allShadow.length > 0
      ? allShadow.reduce((total, trade) => total + (trade.evPerStake ?? 0), 0) / allShadow.length
      : null

  return {
    signals,
    trades,
    shadowTrades: allShadow,
    blocked,
    blockReasons: [...blockCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    stats: master.all(),
    summary: {
      signals: signals.length,
      trades: trades.length,
      shadowTrades: allShadow.length,
      shadowWinRate: allShadow.length ? shadowWins / allShadow.length : 0,
      shadowExpectancyR: allShadow.length ? shadowTotalR / allShadow.length : 0,
      shadowEvPerStake,
      winRate: trades.length ? wins / trades.length : 0,
      expectancyR: trades.length ? totalR / trades.length : 0,
      evPerStake,
      totalR,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
      maxDrawdownR: maxDd,
      signalsPerDay: sessionStarts.length ? signals.length / sessionStarts.length : 0,
      sessions: sessionStarts.length,
    },
  }
}

export interface LiveEvaluation {
  context: ReturnType<ContextBuilder['contextAt']>
  candidates: Array<{ candidate: NonNullable<ReturnType<SetupModule['evaluate']>>; decision: GateDecision }>
  signals: Signal[]
}

export interface ModuleEvaluation {
  moduleId: string
  candidate: SetupCandidate | null
  decision: GateDecision | null
}

/** Avalia apenas o ultimo candle FECHADO. Nunca use o candle em formacao. */
export function evaluateLatest(
  candles: Candle[],
  cfg: EngineConfig,
  book: EdgeBook,
  state: RuntimeState = freshState('live'),
  modules: SetupModule[] = MODULES,
  onModuleEvaluation?: (evaluation: ModuleEvaluation) => void,
): LiveEvaluation {
  validateConfig(cfg)
  const problems = validateSeries(candles, cfg.timeframeMinutes, cfg.session.utcOffsetMinutes)
  if (problems.length) {
    throw new Error(`serie invalida: ${problems.join(' | ')}`)
  }
  const builder = new ContextBuilder(candles, cfg)
  const i = candles.length - 1
  const ctx = builder.contextAt(i)
  const candidates: LiveEvaluation['candidates'] = []
  const signals: Signal[] = []
  for (const mod of modules) {
    const candidate = mod.evaluate(ctx, cfg)
    if (!candidate) {
      onModuleEvaluation?.({ moduleId: mod.id, candidate: null, decision: null })
      continue
    }
    const decision = evaluateGate(candidate, ctx, book, cfg, state)
    onModuleEvaluation?.({ moduleId: mod.id, candidate, decision })
    candidates.push({ candidate, decision })
    if (decision.allowed) signals.push(toSignal(candidate, ctx, decision, cfg))
  }
  return { context: ctx, candidates, signals }
}

export { ContextBuilder, validateSeries, EdgeBook, MODULES }
export { evaluateGate, freshState } from './gate.js'
export * from './types.js'

function validateConfig(cfg: EngineConfig): void {
  if (!Number.isFinite(cfg.payoutRatio) || cfg.payoutRatio < 0) {
    throw new Error('payoutRatio precisa ser um numero finito nao negativo.')
  }
  if (
    cfg.mode === 'expiry' &&
    cfg.expiryOverrideCandles !== undefined &&
    (!Number.isInteger(cfg.expiryOverrideCandles) || cfg.expiryOverrideCandles < 1)
  ) {
    throw new Error('expiryOverrideCandles precisa ser inteiro positivo.')
  }
  if (
    cfg.expiryDrawPolicy !== undefined &&
    cfg.expiryDrawPolicy !== 'refund' &&
    cfg.expiryDrawPolicy !== 'loss'
  ) {
    throw new Error('expiryDrawPolicy precisa ser "refund" ou "loss".')
  }
}
