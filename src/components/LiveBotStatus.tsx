import { Wifi, WifiOff } from 'lucide-react'
import { formatUsd } from '../lib/format'
import type { LiveBotSession } from '../types/liveBot'

export function LiveBotStatus({
  status,
  isLive,
  accountBalance,
  accountCurrency,
  accountType,
  liveModeEnabled,
}: Pick<
  LiveBotSession,
  'status' | 'isLive' | 'accountBalance' | 'accountCurrency' | 'accountType' | 'liveModeEnabled'
>) {
  const connected = isLive && status === 'connected'

  return (
    <section
      aria-label="Status do bot IQ Option"
      aria-live="polite"
      className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5"
    >
      {connected ? (
        <Wifi className="h-3.5 w-3.5 text-buy" aria-hidden="true" />
      ) : (
        <WifiOff className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
      )}
      <span
        className={`h-2 w-2 rounded-full ${
          connected ? 'animate-pulse bg-buy' : 'bg-muted/50'
        }`}
        aria-hidden="true"
      />
      <p
        className={`text-[9px] font-semibold uppercase tracking-[0.12em] ${
          connected ? 'text-buy' : 'text-muted'
        }`}
      >
        {connected ? 'BOT CONECTADO' : 'BOT OFFLINE'}
      </p>
      {connected && accountBalance !== null && (
        <span className="ml-1 inline-flex items-center gap-1.5 border-l border-line pl-2">
          <span className="font-mono text-[9px] text-muted">
            Saldo: {formatUsd(accountBalance)}
            {accountCurrency !== 'USD' ? ` ${accountCurrency}` : ''}
          </span>
          {accountType !== null && (
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
        </span>
      )}
      {connected && (
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[8px] font-bold uppercase tracking-[0.08em] ${
            liveModeEnabled
              ? 'border-sell/40 bg-sell/10 text-sell'
              : 'border-buy/30 bg-buy/5 text-buy'
          }`}
          role="status"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              liveModeEnabled ? 'animate-pulse bg-sell' : 'bg-buy'
            }`}
            aria-hidden="true"
          />
          {liveModeEnabled ? 'MODO REAL' : 'MODO SIMULADO'}
        </span>
      )}
    </section>
  )
}
