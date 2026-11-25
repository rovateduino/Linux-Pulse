import {
  AlertTriangle,
  Download,
  Clock,
  Landmark,
  NotebookPen,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { formatSignedUsd, formatUnixDateTime, formatUsd } from '../lib/format'
import type { LiveTrade } from '../types/liveBot'
import { Disclaimer } from './Disclaimer'
import { useLabStore } from '../stores/labStore'
import type { LiveBotSession } from '../types/liveBot'

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'text-content',
  accountType,
}: {
  icon: typeof Wallet
  label: string
  value: string
  hint: string
  tone?: string
  accountType?: 'PRACTICE' | 'REAL' | null
}) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5 text-muted">
        <Icon className="h-3 w-3" aria-hidden="true" />
        <p className="text-[8.5px] uppercase tracking-[0.12em]">{label}</p>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <p className={`font-mono text-lg font-medium leading-none tnum ${tone}`}>{value}</p>
        {accountType != null && (
          <span
            className={`rounded-full border px-1.5 py-0.5 font-mono text-[8px] font-bold ${
              accountType === 'REAL'
                ? 'border-sell/35 bg-sell/10 text-sell'
                : 'border-buy/25 bg-buy/[0.06] text-buy'
            }`}
          >
            {accountType}
          </span>
        )}
      </div>
      <p className="mt-1 text-[9px] leading-tight text-muted">{hint}</p>
    </div>
  )
}

function formatLiveTradeTimestamp(timestamp: string | null): string {
  if (timestamp === null) return 'Horário indisponível'
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed)
    ? formatUnixDateTime(Math.floor(parsed / 1000))
    : timestamp
}

export function Diario({ liveBot }: { liveBot: LiveBotSession }) {
  const liveTrades = useLabStore((state) => state.liveTrades)
  const clearDiaryHistory = useLabStore((state) => state.clearDiaryHistory)

  const openBotTrades = liveTrades
    .filter((trade) => trade.result === null)
    .sort((a, b) => Date.parse(b.openedAt ?? '') - Date.parse(a.openedAt ?? ''))
  const closedBotTrades = liveTrades
    .filter((trade) => trade.result !== null)
    .sort(
      (a, b) =>
        Date.parse(b.closedAt ?? b.openedAt ?? '') -
        Date.parse(a.closedAt ?? a.openedAt ?? ''),
    )
  const botPnl = closedBotTrades.reduce((total, trade) => total + (trade.pnl ?? 0), 0)
  const botClosedToShow = closedBotTrades.slice(0, 30)

  const exportCsv = () => {
    const csvCell = (value: string | number | null) =>
      `"${String(value ?? '').replaceAll('"', '""')}"`
    const rows = [
      ['asset', 'direction', 'amount', 'entry_price', 'result', 'pnl', 'opened_at', 'closed_at'],
      ...liveTrades.map((trade) => [
        trade.asset,
        trade.direction,
        trade.amount,
        trade.entryPrice,
        trade.result,
        trade.pnl,
        trade.openedAt,
        trade.closedAt,
      ]),
    ]
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `pulse-signals-iq-option-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <div>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Diário · IQ Option</p>
          <h1 className="mt-2 font-display text-[26px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[32px]">
            Operações recebidas da corretora.
          </h1>
          <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-muted">
            Histórico de operações abertas e encerradas pelo bot externo via WebSocket.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={liveTrades.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-[9.5px] font-medium uppercase tracking-[0.08em] text-content transition-colors hover:border-accent/30 disabled:cursor-not-allowed disabled:text-muted/60"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Exportar CSV
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Tem certeza que deseja limpar todo o histórico do Diário?')) {
                clearDiaryHistory()
              }
            }}
            disabled={liveTrades.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sell/30 bg-sell/[0.05] px-3 py-2 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-sell transition-colors hover:bg-sell/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            LIMPAR HISTÓRICO
          </button>
        </div>
      </header>

      {liveBot.assetWarning !== null && (
        <p
          className="mt-4 flex items-start gap-1.5 rounded-lg border border-warn/25 bg-warn/[0.06] px-2.5 py-2 text-[10px] leading-relaxed text-warn"
          role="status"
          aria-live="polite"
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {liveBot.assetWarning}
        </p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          icon={Landmark}
          label="Saldo IQ Option"
          value={
            liveBot.status === 'connected' && liveBot.accountBalance !== null
              ? formatUsd(liveBot.accountBalance)
              : '--'
          }
          hint={
            liveBot.status === 'connected'
              ? liveBot.accountCurrency
              : 'Bot desconectado'
          }
          accountType={
            liveBot.status === 'connected' ? liveBot.accountType : null
          }
          tone="text-info"
        />
        <Stat
          icon={TrendingUp}
          label="P&L real"
          value={formatSignedUsd(botPnl)}
          hint={`${closedBotTrades.length} operações BOT (IQ OPTION)`}
          tone={botPnl > 0 ? 'text-buy' : botPnl < 0 ? 'text-sell' : 'text-content'}
        />
        <Stat
          icon={Wallet}
          label="Encerradas"
          value={String(closedBotTrades.length)}
          hint="Operações do bot"
        />
        <Stat
          icon={NotebookPen}
          label="Em aberto"
          value={String(openBotTrades.length)}
          hint={`stake ${formatUsd(openBotTrades.reduce((total, trade) => total + (trade.amount ?? 0), 0))}`}
          tone={openBotTrades.length > 0 ? 'text-info' : 'text-content'}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section aria-labelledby="open-heading" className="surface p-4 sm:p-5 lg:col-span-12">
          <header className="flex items-center justify-between gap-2">
            <div>
              <p className="eyebrow">Posições</p>
              <h2 id="open-heading" className="mt-1 font-display text-base font-semibold tracking-tight">
                Operações em aberto
              </h2>
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              {openBotTrades.length} abertas
            </span>
          </header>

          {openBotTrades.length === 0 ? (
            <p className="mt-3 rounded-xl border border-line bg-white/[0.02] px-3 py-4 text-[10.5px] leading-relaxed text-muted">
              Nenhuma operação do bot em aberto.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {openBotTrades.map((trade: LiveTrade) => (
                <li key={`bot-${trade.id}`} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="font-display font-semibold">{trade.asset}</span>
                      <span className={trade.direction === 'CALL' ? 'text-buy' : 'text-sell'}>
                        {trade.direction}
                      </span>
                      <span className="rounded-full border border-info/30 bg-info/[0.08] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.06em] text-info">
                        BOT (IQ OPTION)
                      </span>
                      <span className="inline-flex items-center gap-1 text-muted">
                        <Clock className="h-3 w-3 animate-pulse text-info" aria-hidden="true" />
                        ABERTA
                      </span>
                    </p>
                    <p className="mt-0.5 font-mono text-[9.5px] tnum text-muted">
                      entrada {formatLiveTradeTimestamp(trade.openedAt)}
                      {trade.expiration !== null ? ` · expiração ${trade.expiration}m` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[10px] tnum text-content">
                      {trade.amount === null ? '—' : formatUsd(trade.amount)}
                    </p>
                    <p className="mt-0.5 text-[9px] text-muted">stake</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="closed-heading" className="surface p-4 sm:p-5 lg:col-span-12">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="eyebrow">Histórico</p>
              <h2 id="closed-heading" className="mt-1 font-display text-base font-semibold tracking-tight">
                Operações encerradas
              </h2>
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              {closedBotTrades.length} operações BOT (IQ OPTION)
            </span>
          </header>

          {closedBotTrades.length === 0 ? (
            <p className="mt-3 rounded-xl border border-line bg-white/[0.02] px-3 py-4 text-[10.5px] leading-relaxed text-muted">
              Nenhuma operação encerrada recebida do bot.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {botClosedToShow.map((trade: LiveTrade) => (
                <li
                  key={`bot-${trade.id}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 sm:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,0.5fr))_auto]"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="font-display font-semibold">{trade.asset}</span>
                      <span className={trade.direction === 'CALL' ? 'text-buy' : 'text-sell'}>
                        {trade.direction}
                      </span>
                      <span className="rounded-full border border-info/30 bg-info/[0.08] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.06em] text-info">
                        BOT (IQ OPTION)
                      </span>
                    </p>
                    <p className="mt-0.5 font-mono text-[9px] tnum text-muted">
                      {formatLiveTradeTimestamp(trade.closedAt ?? trade.openedAt)}
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="text-[8px] uppercase tracking-[0.08em] text-muted">Stake</p>
                    <p className="mt-0.5 font-mono text-[10px] tnum text-content">
                      {trade.amount === null ? '—' : formatUsd(trade.amount)}
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="text-[8px] uppercase tracking-[0.08em] text-muted">Entrada</p>
                    <p className="mt-0.5 font-mono text-[10px] tnum text-content">
                      {trade.entryPrice === null
                        ? '—'
                        : trade.entryPrice.toLocaleString('pt-BR', { maximumFractionDigits: 5 })}
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="text-[8px] uppercase tracking-[0.08em] text-muted">Resultado</p>
                    <p className="mt-0.5 font-mono text-[10px] tnum text-content">
                      {trade.result ?? '—'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.08em] ${
                        trade.result === 'WIN'
                          ? 'border-buy/30 bg-buy/[0.08] text-buy'
                          : trade.result === 'LOSS'
                            ? 'border-sell/30 bg-sell/[0.08] text-sell'
                            : 'border-line bg-white/[0.03] text-muted'
                      }`}
                    >
                      {trade.result ?? '—'}
                    </span>
                    <span
                      className={`min-w-[64px] text-right font-mono text-[10px] tnum ${
                        (trade.pnl ?? 0) > 0
                          ? 'text-buy'
                          : (trade.pnl ?? 0) < 0
                            ? 'text-sell'
                            : 'text-muted'
                      }`}
                    >
                      {trade.pnl === null ? '—' : formatSignedUsd(trade.pnl)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-4">
        <Disclaimer />
      </div>
    </div>
  )
}
