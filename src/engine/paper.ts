import type { SignalRecord, TradeOutcome } from '../types/market'
import type { AppSettings, DailyStatus, PaperTrade } from '../types/trading'

export interface PaperStats {
  total: number
  closed: number
  open: number
  wins: number
  losses: number
  ties: number
  winRate: number
  expectancy: number
  pnl: number
  maxDrawdown: number
  openStake: number
  equity: number
  equitySeries: { time: number; value: number }[]
}

export function utcDayKey(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10)
}

export function tradePnl(
  outcome: TradeOutcome,
  stake: number,
  payout: number,
  tieRefund: boolean,
): number {
  if (outcome === 'WIN') return stake * payout
  if (outcome === 'LOSS') return -stake
  return tieRefund ? 0 : -stake
}

export function tradeFromRecord(
  record: SignalRecord,
  settings: AppSettings,
  dayKey: string,
): PaperTrade {
  const stake = Math.max(0, settings.stake)
  const outcome = record.outcome
  return {
    id: record.id,
    symbol: record.symbol,
    playbook: record.playbook,
    direction: record.direction,
    openedAt: record.entryTime,
    entryPrice: record.entryPrice,
    stake,
    payout: settings.payout,
    tieRefund: settings.tieRefund,
    expiryCandles: Math.max(1, Math.round((record.expiresAt - record.entryTime) / 300)),
    expiresAt: record.expiresAt,
    closedAt: outcome === null ? null : record.expiresAt,
    exitPrice: record.exitPrice,
    outcome,
    pnl: outcome === null ? null : tradePnl(outcome, stake, settings.payout, settings.tieRefund),
    dayKey,
    conditions: record.conditions,
    regime: record.regime,
    indicators: record.indicators,
  }
}

export function computeStats(trades: readonly PaperTrade[], initialBalance: number): PaperStats {
  const closed = trades
    .filter((trade) => trade.outcome !== null && trade.pnl !== null)
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))

  let wins = 0
  let losses = 0
  let ties = 0
  let pnl = 0
  let expectancy = 0
  let equity = initialBalance
  let peak = initialBalance
  let maxDrawdown = 0
  const equitySeries: { time: number; value: number }[] = []

  for (const trade of closed) {
    if (trade.outcome === 'WIN') wins += 1
    else if (trade.outcome === 'LOSS') losses += 1
    else ties += 1
    const value = trade.pnl ?? 0
    pnl += value
    equity += value
    peak = Math.max(peak, equity)
    maxDrawdown = Math.max(maxDrawdown, peak - equity)
    expectancy += trade.stake > 0 ? value / trade.stake : 0
    equitySeries.push({ time: trade.closedAt ?? trade.openedAt, value: equity })
  }

  const openTrades = trades.filter((trade) => trade.outcome === null)

  return {
    total: trades.length,
    closed: closed.length,
    open: openTrades.length,
    wins,
    losses,
    ties,
    winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
    expectancy: closed.length > 0 ? expectancy / closed.length : 0,
    pnl,
    maxDrawdown,
    openStake: openTrades.reduce((total, trade) => total + trade.stake, 0),
    equity,
    equitySeries,
  }
}

export function statsByPlaybook(
  trades: readonly PaperTrade[],
  initialBalance: number,
): Record<'A' | 'B', PaperStats> {
  return {
    A: computeStats(
      trades.filter((trade) => trade.playbook === 'A'),
      initialBalance,
    ),
    B: computeStats(
      trades.filter((trade) => trade.playbook === 'B'),
      initialBalance,
    ),
  }
}

export function dayGate(
  trades: readonly PaperTrade[],
  settings: AppSettings,
  dayKey: string,
): { allowed: boolean; reason: string | null } {
  const realized = trades
    .filter((trade) => trade.dayKey === dayKey && trade.pnl !== null)
    .reduce((total, trade) => total + (trade.pnl ?? 0), 0)
  if (settings.dailyStop > 0 && realized <= -settings.dailyStop) {
    return { allowed: false, reason: 'Stop diário atingido. O paper trading fica pausado até o próximo dia.' }
  }
  if (settings.dailyCap > 0 && realized >= settings.dailyCap) {
    return { allowed: false, reason: 'Teto diário atingido. Novas entradas simuladas ficam bloqueadas hoje.' }
  }
  return { allowed: true, reason: null }
}

export function dailyStatus(
  trades: readonly PaperTrade[],
  settings: AppSettings,
  timestampSeconds: number,
): DailyStatus {
  const dayKey = utcDayKey(timestampSeconds)
  const dayTrades = trades.filter((trade) => trade.dayKey === dayKey)
  const realized = dayTrades
    .filter((trade) => trade.pnl !== null)
    .reduce((total, trade) => total + (trade.pnl ?? 0), 0)
  const stopped = settings.dailyStop > 0 && realized <= -settings.dailyStop
  const capped = settings.dailyCap > 0 && realized >= settings.dailyCap
  return {
    dayKey,
    realized,
    closed: dayTrades.filter((trade) => trade.outcome !== null).length,
    open: dayTrades.filter((trade) => trade.outcome === null).length,
    stopped,
    capped,
    allowed: settings.autoPaper && !stopped && !capped,
  }
}

const OUTCOME_CSV: Record<TradeOutcome, string> = {
  WIN: 'ACERTO',
  LOSS: 'ERRO',
  TIE: 'EMPATE',
}

function csvCell(value: string | number | null): string {
  if (value === null) return ''
  const text = String(value)
  if (/[;"\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

export function tradesCsv(trades: readonly PaperTrade[]): string {
  const header = [
    'id',
    'ativo',
    'playbook',
    'direcao',
    'aberto_em',
    'entrada',
    'stake',
    'payout',
    'expira_em',
    'fechado_em',
    'saida',
    'resultado',
    'pnl',
    'dia',
    'condicoes',
  ]
  const rows = [...trades]
    .sort((a, b) => a.openedAt - b.openedAt)
    .map((trade) =>
      [
        trade.id,
        trade.symbol,
        trade.playbook,
        trade.direction,
        new Date(trade.openedAt * 1000).toISOString(),
        trade.entryPrice,
        trade.stake,
        trade.payout,
        new Date(trade.expiresAt * 1000).toISOString(),
        trade.closedAt === null ? '' : new Date(trade.closedAt * 1000).toISOString(),
        trade.exitPrice,
        trade.outcome === null ? 'ABERTO' : OUTCOME_CSV[trade.outcome],
        trade.pnl,
        trade.dayKey,
        trade.conditions
          .map((condition) => `${condition.label}: ${condition.met ? 'ok' : 'nao'}`)
          .join(' | '),
      ]
        .map(csvCell)
        .join(';'),
    )
  return [header.join(';'), ...rows].join('\r\n')
}
