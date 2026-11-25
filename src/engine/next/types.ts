/**
 * Tipos do motor de estrategia "edge-first" do pulse-signals.
 *
 * Principio central: o motor NAO emite sinal porque um indicador cruzou.
 * Ele emite sinal porque uma familia de setup, num regime especifico, tem
 * expectancia medida (walk-forward, liquida de custos) acima do breakeven.
 */

export interface Candle {
  /** epoch ms do FECHAMENTO do candle (nao da abertura) */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type Direction = 'long' | 'short'

/**
 * 'r'      = operacao com stop e alvo, resultado medido em R.
 * 'expiry' = contrato de expiracao fixa (binario/Blitz), resultado medido em stake.
 */
export type EngineMode = 'r' | 'expiry'
export type ExpiryDrawPolicy = 'refund' | 'loss'

export type Regime =
  | 'trend_up'
  | 'trend_down'
  | 'range'
  | 'expansion'
  | 'compression'

export type SessionPhase =
  | 'pre'
  | 'opening'
  | 'morning'
  | 'midday'
  | 'power'
  | 'close'
  | 'post'

export interface SessionConfig {
  /** offset UTC em minutos usado para definir o dia de negociacao (B3: -180) */
  utcOffsetMinutes: number
  /** abertura da sessao em minutos desde a meia-noite local (B3: 600 = 10:00) */
  openMinute: number
  /** fechamento da sessao em minutos desde a meia-noite local (B3: 1080 = 18:00) */
  closeMinute: number
  /** duracao do opening range em minutos */
  openingRangeMinutes: number
  /** nao abrir posicao nos primeiros N minutos apos a abertura */
  noEntryAfterOpenMinutes: number
  /** nao abrir posicao nos ultimos N minutos antes do fechamento */
  noEntryBeforeCloseMinutes: number
  /** numero de sessoes usadas para a media de RVOL e niveis anteriores */
  lookbackSessions: number
}

export interface EngineConfig {
  /** timeframe de execucao, em minutos. Validado contra os dados. */
  timeframeMinutes: number
  /** 'r' (stop/alvo) ou 'expiry' (expiracao fixa). Default: 'r'. */
  mode?: EngineMode
  /**
   * Forca a expiracao de todos os modulos, em candles.
   * Use 1 para Blitz de 60s em M1, 5 para 5 min em M1, etc.
   */
  expiryOverrideCandles?: number
  /** regra usada se a cotacao de entrada e a de vencimento forem iguais */
  expiryDrawPolicy?: ExpiryDrawPolicy
  session: SessionConfig
  /** minimo de trades por bucket para o gate confiar na estatistica */
  minTradesPerBucket: number
  /** margem de seguranca sobre a taxa de acerto de breakeven (ex 0.03 = 3 p.p.) */
  edgeMargin: number
  /** payout de contrato de expiracao fixa, como fracao do stake (0.8 = 80%) */
  payoutRatio: number
  /** custo round-trip em unidades de preco (spread + slippage + corretagem) */
  costPerTrade: number
  /** risco por trade em fracao do capital */
  riskPerTradePct: number
  /** maximo de sinais por dia */
  maxSignalsPerDay: number
  /** candles de espera apos um loss */
  cooldownCandlesAfterLoss: number
  /** pausa apos N perdas consecutivas */
  pauseAfterConsecutiveLosses: number
  /** duracao da pausa em minutos */
  pauseMinutes: number
}

export interface OpeningRange {
  high: number
  low: number
  /** RVOL da janela de abertura vs media das sessoes anteriores */
  rvol: number
  /** (high - low) / atr diario aproximado */
  rangeAtrRatio: number
  complete: boolean
}

export interface MarketContext {
  /** indice do candle fechado que originou este contexto */
  index: number
  candle: Candle
  timeframeMinutes: number
  /** yyyy-mm-dd local */
  sessionId: string
  /** minutos desde a abertura da sessao (pode ser negativo) */
  minutesFromOpen: number
  phase: SessionPhase
  /** 1 = primeira sessao disponivel */
  sessionNumber: number
  atr: number
  atrPercentile: number
  adx: number
  ema20: number
  ema50: number
  ema200: number
  rsi: number
  vwap: number
  vwapSd: number
  /** (close - vwap) / vwapSd */
  vwapZ: number
  /** inclinacao do VWAP normalizada por ATR */
  vwapSlope: number
  volumeAvg20: number
  /** volume do candle / media de volume do mesmo horario nas sessoes anteriores */
  rvolCandle: number
  openingRange: OpeningRange | null
  priorHigh: number | null
  priorLow: number | null
  priorClose: number | null
  dayOpen: number
  regime: Regime
  /** retorno da primeira meia hora da sessao (close aos 30min / abertura - 1) */
  firstHalfHourReturn: number
  /** true se o candle anterior fechou acima/abaixo de um nivel relevante */
  brokePriorHigh: boolean
  brokePriorLow: boolean
}

export interface SetupCandidate {
  moduleId: string
  direction: Direction
  /** preco de referencia (fechamento do candle de sinal) */
  reference: number
  /** stop em unidades de preco */
  stop: number
  /** alvo em unidades de preco (0 = sem alvo, sai no tempo) */
  target: number
  /** expiracao em candles, para modo de expiracao fixa */
  expiryCandles: number
  /** chave do bucket usada pelo gate */
  bucket: string
  /** justificativa legivel, para auditoria e UI */
  reasons: string[]
  /** confianca declarada pelo modulo, 0..1 (usada so como desempate) */
  confidence: number
}

export interface Signal extends SetupCandidate {
  id: string
  time: number
  sessionId: string
  entry: number
  stop: number
  target: number
  /** risco em unidades de preco */
  risk: number
  /** R:R alvo */
  rewardRisk: number
  /** probabilidade estimada pelo gate (walk-forward) */
  probability: number
  /** expectancia estimada em R, liquida */
  expectancyR: number
  /** EV estimado por unidade de stake em modo expiry */
  evPerStake: number
  /** amostra usada na estimativa */
  sampleSize: number
  regime: Regime
  phase: SessionPhase
}

export interface GateDecision {
  allowed: boolean
  reasons: string[]
  probability: number
  expectancyR: number
  evPerStake: number
  sampleSize: number
  breakeven: number
}

export interface TradeResult {
  moduleId: string
  bucket: string
  direction: Direction
  sessionId: string
  entryTime: number
  exitTime: number
  entry: number
  exit: number
  stop: number
  target: number
  risk: number
  rMultiple: number
  /** true se o resultado na expiracao fixa foi favoravel */
  expiryWin: boolean
  expiryOutcome: 'win' | 'loss' | 'draw' | null
  /** retorno liquido por unidade de stake no horizonte de expiracao */
  evPerStake: number | null
  outcome: 'target' | 'stop' | 'time' | 'session_end'
  costs: number
}

export interface BucketStats {
  bucket: string
  n: number
  wins: number
  winRate: number
  /** limite inferior de Wilson para a taxa de acerto */
  winRateLower: number
  /** acertos na expiracao fixa (independe de stop/alvo) */
  expiryWins: number
  expiryLosses: number
  expiryDraws: number
  expiryWinRate: number
  expiryWinRateLower: number
  /** amostra decisiva, excluindo empates que devolvem a stake */
  expiryResolvedTrades: number
  expiryResolvedWinRate: number
  expiryResolvedWinRateLower: number
  /** EV medio por unidade de stake no horizonte de expiracao */
  evPerStake: number
  avgWinR: number
  avgLossR: number
  expectancyR: number
  profitFactor: number
  breakeven: number
}
