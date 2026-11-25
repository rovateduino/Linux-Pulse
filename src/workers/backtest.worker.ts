import { LAB_STAKE_USD, runBacktest } from '../engine/backtest'
import { runBaselines } from '../engine/baselines'
import { runBacktest as runNextBacktest } from '../engine/next'
import { inferTimeframeMinutes, toEngineCandles } from '../engine/nextAdapter'
import type {
  NextShadowResult,
  RunBacktestInput,
  WorkerRequest,
  WorkerResponse,
} from '../types/lab'

interface BacktestWorkerScope {
  postMessage: (message: WorkerResponse) => void
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ) => void
}

const scope = self as unknown as BacktestWorkerScope

function post(message: WorkerResponse): void {
  scope.postMessage(message)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return 'Falha inesperada ao executar o backtest.'
}

scope.addEventListener('message', (event) => {
  const request = event.data
  if (request.type !== 'run') return

  const config = request.config
  try {
    post({ type: 'progress', phase: 'carregando', pct: 4 })
    const input: RunBacktestInput = {
      symbol: config.symbol,
      timeframe: config.timeframe,
      confirmation: config.confirmation,
      payout: config.payout,
      expiryCandles: config.expiryCandles,
      m5Candles: config.candles,
      playbooks: config.playbooks,
      strategy: config.strategy,
      stake: config.stake,
      sessions: config.sessions,
    }
    const output = runBacktest(input, (phase, pct) => {
      post({ type: 'progress', phase, pct })
    })

    post({ type: 'progress', phase: 'validando', pct: 86 })
    const timeframeMinutes = inferTimeframeMinutes(
      config.candles,
      config.nextEngineConfig.session.utcOffsetMinutes,
    )
    let nextShadow: NextShadowResult
    if (timeframeMinutes === 1) {
      const nextConfig = { ...config.nextEngineConfig, timeframeMinutes }
      const nextCandles = toEngineCandles(
        config.candles,
        timeframeMinutes,
        nextConfig.session.utcOffsetMinutes,
      )
      const nextOutput = runNextBacktest(nextCandles, nextConfig, { walkForward: true })
      nextShadow = {
        status: 'complete',
        timeframeMinutes,
        summary: nextOutput.summary,
        stats: nextOutput.stats,
        shadowTrades: nextOutput.shadowTrades,
      }
    } else {
      nextShadow = {
        status: 'skipped',
        timeframeMinutes,
        reason: 'Gate Blitz de 60s exige dados M1; candles M5/M15 não alimentam este EdgeBook.',
      }
    }

    post({ type: 'progress', phase: 'baselines', pct: 92 })
    const baselines = runBaselines({
      symbol: config.symbol,
      timeframe: config.timeframe,
      payout: config.payout,
      stake: config.stake ?? LAB_STAKE_USD,
      opportunities: output.opportunities,
    })

    post({
      type: 'done',
      results: output.results,
      baselines,
      split: output.split,
      generatedAt: Date.now(),
      nextShadow,
      sessionsUsed: output.sessionsUsed,
      pctCandlesFiltrados: output.pctCandlesFiltrados,
    })
  } catch (error) {
    post({ type: 'error', message: errorMessage(error) })
  }
})
