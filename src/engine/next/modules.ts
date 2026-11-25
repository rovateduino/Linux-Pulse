import type { EngineConfig, MarketContext, SetupCandidate } from './types.js'

export interface SetupModule {
  id: string
  label: string
  /** tese em uma linha, exibida na UI */
  thesis: string
  evaluate(ctx: MarketContext, cfg: EngineConfig): SetupCandidate | null
}

function bucket(id: string, ctx: MarketContext): string {
  return `${id}|${ctx.regime}|${ctx.phase}`
}

const round = (v: number, d = 5) => Number(v.toFixed(d))

/**
 * 1. ORB + RVOL — rompimento do range de abertura filtrado por volume relativo.
 * Evidencia: Zarattini/Barbon/Aziz (2024) — ORB cru Sharpe 0.48; com RVOL Sharpe 2.81.
 */
export const orbRvol: SetupModule = {
  id: 'orb-rvol',
  label: 'ORB + Volume Relativo',
  thesis: 'Rompimento do range de abertura com fluxo anormal na janela inicial.',
  evaluate(ctx, cfg) {
    const or = ctx.openingRange
    if (!or || !or.complete) return null
    if (ctx.phase !== 'morning' && ctx.phase !== 'midday') return null
    if (ctx.minutesFromOpen > cfg.session.openingRangeMinutes + 150) return null
    if (!(ctx.atr > 0)) return null
    if (or.rvol < 1.5) return null
    if (or.rangeAtrRatio < 0.25 || or.rangeAtrRatio > 2.5) return null
    if (!(ctx.adx >= 20)) return null

    const buffer = 0.1 * ctx.atr
    const close = ctx.candle.close
    let direction: 'long' | 'short' | null = null
    if (close > or.high + buffer) direction = 'long'
    else if (close < or.low - buffer) direction = 'short'
    if (!direction) return null

    const risk = 1.0 * ctx.atr
    const stop = direction === 'long' ? close - risk : close + risk
    const target = direction === 'long' ? close + 2 * risk : close - 2 * risk
    if (direction === 'long' && stop <= or.low) return null
    if (direction === 'short' && stop >= or.high) return null

    return {
      moduleId: this.id,
      direction,
      reference: round(close),
      stop: round(stop),
      target: round(target),
      expiryCandles: 24,
      bucket: bucket(this.id, ctx),
      reasons: [
        `RVOL da abertura ${or.rvol.toFixed(2)}x`,
        `range/ATR ${or.rangeAtrRatio.toFixed(2)}`,
        `ADX ${ctx.adx.toFixed(1)}`,
        `rompimento de ${direction === 'long' ? 'máxima' : 'mínima'} ${round(direction === 'long' ? or.high : or.low)}`,
      ],
      confidence: Math.min(1, 0.4 + 0.1 * Math.min(or.rvol, 4)),
    }
  },
}

/**
 * 2. Tendência ancorada no VWAP — continuidade com o VWAP como referência de fluxo.
 * Evidencia: Zarattini & Aziz (2023) em QQQ; replicação independente mostra dependência de regime.
 */
export const vwapTrend: SetupModule = {
  id: 'vwap-trend',
  label: 'Tendência VWAP',
  thesis: 'Preço aceito de um lado do VWAP com inclinação e ADX: continuidade.',
  evaluate(ctx) {
    if (ctx.phase !== 'morning' && ctx.phase !== 'power') return null
    if (!(ctx.atr > 0) || !(ctx.vwapSd > 0)) return null
    if (!(ctx.adx >= 20)) return null
    const close = ctx.candle.close
    const above = ctx.vwapZ >= 0.25 && ctx.vwapSlope >= 0.15 && close > ctx.vwap
    const below = ctx.vwapZ <= -0.25 && ctx.vwapSlope <= -0.15 && close < ctx.vwap
    if (!above && !below) return null

    const direction = above ? 'long' : 'short'
    const body = Math.abs(close - ctx.candle.open)
    const range = Math.max(ctx.candle.high - ctx.candle.low, 1e-9)
    if (body / range < 0.4) return null

    const stop = above ? Math.min(close - 0.8 * ctx.atr, ctx.vwap - 0.2 * ctx.atr) : Math.max(close + 0.8 * ctx.atr, ctx.vwap + 0.2 * ctx.atr)
    const risk = Math.abs(close - stop)
    if (risk <= 0) return null
    const target = above ? close + 2 * risk : close - 2 * risk

    return {
      moduleId: this.id,
      direction,
      reference: round(close),
      stop: round(stop),
      target: round(target),
      expiryCandles: 18,
      bucket: bucket(this.id, ctx),
      reasons: [
        `z do VWAP ${ctx.vwapZ.toFixed(2)}`,
        `inclinação ${ctx.vwapSlope.toFixed(2)} ATR`,
        `ADX ${ctx.adx.toFixed(1)}`,
        `corpo ${(body / range).toFixed(2)} do range`,
      ],
      confidence: Math.min(1, 0.35 + 0.15 * Math.min(Math.abs(ctx.vwapZ), 3)),
    }
  },
}

/**
 * 3. Reversão às bandas do VWAP — só no meio da sessão, com ADX baixo.
 * Evidencia: reversão intradiária paga aproximadamente o spread (Heston/Korajczyk/Sadka);
 * por isso o filtro de custo e de regime é obrigatório, não opcional.
 */
export const vwapReversion: SetupModule = {
  id: 'vwap-reversion',
  label: 'Reversão banda VWAP',
  thesis: 'Extensão de 2 sigma em mercado sem tendência volta à média.',
  evaluate(ctx, cfg) {
    if (ctx.phase !== 'midday') return null
    if (!(ctx.atr > 0) || !(ctx.vwapSd > 0)) return null
    if (!(ctx.adx <= 20)) return null
    if (Math.abs(ctx.vwapSlope) > 0.2) return null
    if (Math.abs(ctx.vwapZ) < 2.0) return null
    if (Math.abs(ctx.vwapZ) > 3.2) return null

    const close = ctx.candle.close
    const direction = ctx.vwapZ > 0 ? 'short' : 'long'
    if (direction === 'short' && !(ctx.rsi >= 65)) return null
    if (direction === 'long' && !(ctx.rsi <= 35)) return null

    const stop = direction === 'short' ? ctx.candle.high + 1.0 * ctx.atr : ctx.candle.low - 1.0 * ctx.atr
    const risk = Math.abs(stop - close)
    if (risk <= 0 || risk > 2.5 * ctx.atr) return null
    // alvo na linha do VWAP: so entra se o R:R minimo cobrir o custo
    const reward = Math.abs(ctx.vwap - close)
    if (reward < Math.max(1.2 * risk, 4 * cfg.costPerTrade)) return null

    return {
      moduleId: this.id,
      direction,
      reference: round(close),
      stop: round(stop),
      target: round(ctx.vwap),
      expiryCandles: 12,
      bucket: bucket(this.id, ctx),
      reasons: [
        `z do VWAP ${ctx.vwapZ.toFixed(2)}`,
        `ADX ${ctx.adx.toFixed(1)}`,
        `RSI ${ctx.rsi.toFixed(1)}`,
        `alvo no VWAP ${round(ctx.vwap)}`,
      ],
      confidence: Math.min(1, 0.3 + 0.15 * (Math.abs(ctx.vwapZ) - 2)),
    }
  },
}

/**
 * 4. Sweep de liquidez em extremo da sessão anterior + reclaim.
 * Evidencia: stops se concentram além de extremos e números redondos (Osler, FRBNY);
 * varredura com rejeição é o que sobrevive a custo em M5, diferente do rompimento puro.
 */
export const liquiditySweep: SetupModule = {
  id: 'liquidity-sweep',
  label: 'Sweep + reclaim',
  thesis: 'Extremo anterior é varrido, stops disparam e o preço volta: falha do rompimento.',
  evaluate(ctx) {
    if (ctx.phase !== 'morning' && ctx.phase !== 'midday') return null
    if (!(ctx.atr > 0)) return null
    if (ctx.volumeAvg20 <= 0 || ctx.candle.volume < 1.5 * ctx.volumeAvg20) return null
    if (ctx.minutesFromOpen < 15) return null

    const c = ctx.candle
    const upperWick = c.high - Math.max(c.open, c.close)
    const lowerWick = Math.min(c.open, c.close) - c.low
    const range = Math.max(c.high - c.low, 1e-9)

    let direction: 'long' | 'short' | null = null
    let sweptLevel = 0
    if (ctx.priorHigh !== null && c.high > ctx.priorHigh && c.close < ctx.priorHigh && upperWick / range >= 0.4) {
      direction = 'short'
      sweptLevel = ctx.priorHigh
    } else if (ctx.priorLow !== null && c.low < ctx.priorLow && c.close > ctx.priorLow && lowerWick / range >= 0.4) {
      direction = 'long'
      sweptLevel = ctx.priorLow
    }
    if (!direction) return null

    const close = c.close
    const stop = direction === 'short' ? c.high + 0.35 * ctx.atr : c.low - 0.35 * ctx.atr
    const risk = Math.abs(stop - close)
    if (risk <= 0 || risk > 1.8 * ctx.atr) return null

    return {
      moduleId: this.id,
      direction,
      reference: round(close),
      stop: round(stop),
      target: round(direction === 'short' ? close - 1.6 * risk : close + 1.6 * risk),
      expiryCandles: 16,
      bucket: bucket(this.id, ctx),
      reasons: [
        `varredura de ${round(sweptLevel)}`,
        `volume ${(c.volume / ctx.volumeAvg20).toFixed(2)}x a média`,
        `pavio ${(direction === 'short' ? upperWick / range : lowerWick / range).toFixed(2)} do range`,
      ],
      confidence: Math.min(1, 0.35 + 0.2 * (c.volume / ctx.volumeAvg20 - 1.5)),
    }
  },
}

/**
 * 5. Momentum de fechamento — o retorno da primeira meia hora prevê a última.
 * Evidencia: Gao, Han, Li & Zhou (2018): Sharpe 1.08 no S&P 500, 1.63 no tercil de alta volatilidade.
 */
export const closingMomentum: SetupModule = {
  id: 'closing-momentum',
  label: 'Momentum de fechamento',
  thesis: 'Fluxo de execução com prazo (VWAP/TWAP) amplifica a direção do dia no fim da sessão.',
  evaluate(ctx) {
    if (ctx.phase !== 'close' && ctx.phase !== 'power') return null
    if (ctx.minutesFromOpen < 300) return null
    if (!(ctx.atr > 0)) return null
    if (Math.abs(ctx.firstHalfHourReturn) < 0.0015) return null
    if (Math.abs(ctx.vwapZ) < 0.3) return null

    const direction = ctx.firstHalfHourReturn > 0 ? 'long' : 'short'
    if (direction === 'long' && ctx.vwapZ < 0) return null
    if (direction === 'short' && ctx.vwapZ > 0) return null

    const close = ctx.candle.close
    const stop = direction === 'long' ? close - 1.0 * ctx.atr : close + 1.0 * ctx.atr
    const risk = Math.abs(stop - close)
    if (risk <= 0) return null

    return {
      moduleId: this.id,
      direction,
      reference: round(close),
      stop: round(stop),
      target: round(direction === 'long' ? close + 1.5 * risk : close - 1.5 * risk),
      expiryCandles: 10,
      bucket: bucket(this.id, ctx),
      reasons: [
        `retorno da 1ª meia hora ${(ctx.firstHalfHourReturn * 100).toFixed(2)}%`,
        `z do VWAP ${ctx.vwapZ.toFixed(2)}`,
      ],
      confidence: 0.4,
    }
  },
}

export const MODULES: SetupModule[] = [orbRvol, vwapTrend, vwapReversion, liquiditySweep, closingMomentum]

/** Regimes em que cada modulo pode operar (o gate tambem exige estatistica). */
export const MODULE_REGIMES: Record<string, string[]> = {
  'orb-rvol': ['trend_up', 'trend_down', 'expansion'],
  'vwap-trend': ['trend_up', 'trend_down', 'expansion'],
  'vwap-reversion': ['range', 'compression'],
  'liquidity-sweep': ['range', 'compression', 'expansion'],
  'closing-momentum': ['trend_up', 'trend_down', 'range', 'expansion'],
}

export function moduleAllowedInRegime(moduleId: string, regime: string): boolean {
  const allowed = MODULE_REGIMES[moduleId]
  return allowed ? allowed.includes(regime) : true
}

export type { EngineConfig }
