import { Check, Circle, Info, Play, Square, X } from 'lucide-react'
import {
  LAB_CONFIRMATION_LABEL,
  LAB_SYMBOLS,
  LAB_TIMEFRAME_LABEL,
  labName,
} from '../../data/assets'
import { formatUnixDateTime } from '../../lib/format'
import { ORIGIN_RESULT } from '../../lib/labOrigin'
import { PlaybookPicker } from './PlaybookPicker'
import { isLabRunActive, datasetStepError, useLabStore } from '../../stores/labStore'
import type { DatasetState, LabConfirmation, WorkerProgressPhase } from '../../types/lab'

const IDLE_STATE: DatasetState = { status: 'idle' }

const PHASES: { id: WorkerProgressPhase; label: string }[] = [
  { id: 'carregando', label: 'Carregando' },
  { id: 'treinando', label: 'Treinando' },
  { id: 'validando', label: 'Validando' },
  { id: 'testando', label: 'Testando' },
  { id: 'baselines', label: 'Baselines' },
]

const FIELD_CLASS =
  'w-full rounded-xl border border-line bg-white/[0.02] px-2.5 py-2 font-mono text-[11px] text-content outline-none transition-colors focus:border-accent/50'

const RUN_BUTTON =
  'inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-buy/30 bg-buy/[0.08] px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-buy transition-colors hover:bg-buy/[0.14] disabled:cursor-not-allowed disabled:border-line disabled:bg-white/[0.02] disabled:text-muted/70'

function splitPercent(payout: number): string {
  return `${(100 / (1 + payout)).toFixed(1).replace('.', ',')}%`
}

export function RunPanel() {
  const config = useLabStore((state) => state.config)
  const datasets = useLabStore((state) => state.datasets)
  const gridAccepted = useLabStore((state) => state.gridAccepted)
  const phase = useLabStore((state) => state.phase)
  const progress = useLabStore((state) => state.progress)
  const runError = useLabStore((state) => state.runError)
  const runInfo = useLabStore((state) => state.runInfo)
  const setConfig = useLabStore((state) => state.setConfig)
  const run = useLabStore((state) => state.run)
  const cancel = useLabStore((state) => state.cancel)
  const clearError = useLabStore((state) => state.clearError)

  const datasetState = datasets[config.symbol] ?? IDLE_STATE
  const customAssets = Object.entries(datasets)
    .filter(
      ([symbol, state]) =>
        !LAB_SYMBOLS.includes(symbol) &&
        state.status === 'ready' &&
        state.dataset.source === 'bot',
    )
    .map(([symbol]) => symbol)
  const running = isLabRunActive(phase)
  const datasetReady = datasetState.status === 'ready'
  const stepError =
    datasetState.status === 'ready'
      ? datasetStepError(
          datasetState.dataset.candles,
          config.baseTimeframe,
          datasetState.dataset.timeframe,
        )
      : null
  const canRun = datasetReady && gridAccepted && !running && stepError === null
  const phaseIndex = PHASES.findIndex((item) => item.id === phase)

  // Expiração em minutos: cada vela vale o tempo do timeframe base.
  const minutesPerCandle =
    config.baseTimeframe === '1m' ? 1 : config.baseTimeframe === '5m' ? 5 : 15
  const selectedExpiry = config.expiryCandles
  const selectedMinutes = selectedExpiry * minutesPerCandle

  const hint = running
    ? 'O worker está processando o walk-forward. O resultado só aparece no fim.'
    : !datasetReady
      ? 'Carregue os candles do ativo no painel de dados.'
      : stepError !== null
        ? stepError
        : !gridAccepted
          ? 'Pré-visualize o grid para liberar a execução.'
          : 'Grid aceito. A execução usa o teste fora da amostra para o Edge Gate.'

  return (
    <section aria-labelledby="lab-run-heading" className="surface flex h-full flex-col p-4 sm:p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Execução</p>
          <h2
            id="lab-run-heading"
            className="mt-1 font-display text-base font-semibold tracking-tight"
          >
            Backtest walk-forward
          </h2>
        </div>
        <span className="rounded-full border border-line bg-white/[0.02] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
          60/20/20 fixo
        </span>
      </header>

      <div className="mt-3 grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-2">
        <div>
          <label htmlFor="lab-symbol" className="text-[9px] uppercase tracking-[0.1em] text-muted">
            Ativo
          </label>
          <select
            id="lab-symbol"
            value={config.symbol}
            disabled={running}
            onChange={(event) => setConfig({ symbol: event.target.value })}
            className={`mt-1 ${FIELD_CLASS}`}
          >
            {LAB_SYMBOLS.map((symbol) => (
              <option key={symbol} value={symbol}>
                {labName(symbol)} · {symbol}
              </option>
            ))}
            {customAssets.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol} · CSV
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="lab-confirmation"
            className="text-[9px] uppercase tracking-[0.1em] text-muted"
          >
            Confirmação
          </label>
          <select
            id="lab-confirmation"
            value={config.confirmation}
            disabled={running}
            onChange={(event) => {
              const confirmation: LabConfirmation =
                event.target.value === '30m' ? '30m' : '15m'
              setConfig({ confirmation })
            }}
            className={`mt-1 ${FIELD_CLASS}`}
          >
            <option value="15m" disabled={config.baseTimeframe === '15m'}>
              M15
            </option>
            <option value="30m">M30</option>
          </select>
        </div>

        <div>
          <p className="text-[9px] uppercase tracking-[0.1em] text-muted">Timeframe base</p>
          <div
            role="group"
            aria-label="Timeframe base"
            className="mt-1 flex rounded-xl border border-line bg-white/[0.02] p-0.5"
          >
            {(['1m', '5m', '15m'] as const).map((timeframe) => (
              <button
                key={timeframe}
                type="button"
                aria-pressed={config.baseTimeframe === timeframe}
                disabled={running}
                onClick={() => setConfig({ baseTimeframe: timeframe })}
                className={`flex-1 rounded-lg px-2 py-1.5 font-mono text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  config.baseTimeframe === timeframe
                    ? 'bg-white/[0.07] text-content'
                    : 'text-muted hover:text-content'
                }`}
              >
                {LAB_TIMEFRAME_LABEL[timeframe]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <PlaybookPicker />
        </div>

        <div>
          <label htmlFor="lab-payout" className="text-[9px] uppercase tracking-[0.1em] text-muted">
            Payout
          </label>
          <input
            id="lab-payout"
            type="number"
            min={0.05}
            max={0.99}
            step={0.01}
            value={config.payout}
            disabled={running}
            onChange={(event) => setConfig({ payout: Number(event.target.value) })}
            className={`mt-1 ${FIELD_CLASS}`}
          />
          <p className="mt-1 text-[8.5px] text-muted">
            Breakeven {splitPercent(config.payout)} · {LAB_CONFIRMATION_LABEL[config.confirmation]}
          </p>
        </div>

        <div className="min-[360px]:col-span-2">
          <p className="text-[9px] uppercase tracking-[0.1em] text-muted">Expiração</p>
          <div
            role="group"
            aria-label="Expiração em candles"
            className="mt-1 grid grid-cols-3 gap-1"
          >
            {[1, 2, 3].map((expiry) => (
              <button
                key={expiry}
                type="button"
                aria-pressed={config.expiryCandles === expiry}
                disabled={running}
                onClick={() => setConfig({ expiryCandles: expiry })}
                className={`rounded-lg border px-2 py-1.5 font-mono text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  config.expiryCandles === expiry
                    ? 'border-accent/35 bg-accent/[0.1] text-content'
                    : 'border-line bg-white/[0.02] text-muted hover:text-content'
                }`}
              >
                {expiry} {expiry === 1 ? 'vela' : 'velas'}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[9px] leading-relaxed text-muted">
            {`Expiração em ${LAB_TIMEFRAME_LABEL[config.baseTimeframe]}: 1 vela = ${minutesPerCandle} min · 2 velas = ${minutesPerCandle * 2} min · 3 velas = ${minutesPerCandle * 3} min · selecionada: ${selectedExpiry} ${selectedExpiry === 1 ? 'vela' : 'velas'} = ${selectedMinutes} ${selectedMinutes === 1 ? 'minuto' : 'minutos'}.`}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-line bg-white/[0.02] p-3" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-content">
            {phase === 'idle' && 'Pronto para configurar'}
            {phase === 'carregando' && 'Carregando candles'}
            {phase === 'treinando' && 'Treinando o setup'}
            {phase === 'validando' && 'Validando amostra'}
            {phase === 'testando' && 'Testando fora da amostra'}
            {phase === 'baselines' && 'Calculando baselines'}
            {phase === 'done' && 'Backtest concluído'}
            {phase === 'error' && 'Execução interrompida'}
            {phase === 'cancelled' && 'Execução cancelada'}
          </p>
          <span className="font-mono text-[10px] tnum text-muted">
            {phase === 'done' ? '100' : Math.round(progress)}%
          </span>
        </div>

        <div
          role="progressbar"
          aria-label="Progresso do backtest"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={phase === 'done' ? 100 : Math.round(progress)}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
        >
          <div
            className={`h-full rounded-full ${
              phase === 'error' ? 'bg-sell/80' : phase === 'cancelled' ? 'bg-warn/80' : 'bg-accent/80'
            }`}
            style={{
              width: `${phase === 'done' ? 100 : Math.max(phase === 'idle' ? 0 : 2, Math.min(100, progress))}%`,
            }}
          />
        </div>

        <ol className="mt-2.5 grid grid-cols-5 gap-1">
          {PHASES.map((item, index) => {
            const complete = phase === 'done' || (phaseIndex >= 0 && index < phaseIndex)
            const active = item.id === phase
            return (
              <li key={item.id} className="flex min-w-0 flex-col items-center gap-1 text-center">
                {complete ? (
                  <Check className="h-3 w-3 text-buy" aria-hidden="true" />
                ) : active ? (
                  <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                ) : (
                  <Circle className="h-2.5 w-2.5 text-muted/50" aria-hidden="true" />
                )}
                <span
                  className={`hidden truncate text-[8px] uppercase tracking-[0.06em] xl:block ${
                    active ? 'text-content' : 'text-muted/80'
                  }`}
                >
                  {item.label}
                </span>
              </li>
            )
          })}
        </ol>

        {phase === 'done' && runInfo !== null && (
          <p className="mt-2.5 text-[10px] leading-relaxed text-muted">
            {runInfo.trades} operações no total ·{' '}
            {formatUnixDateTime(Math.floor(runInfo.generatedAt / 1000))} · fonte{' '}
            {ORIGIN_RESULT[runInfo.source]}
          </p>
        )}

        {phase === 'cancelled' && (
          <p className="mt-2.5 text-[10px] leading-relaxed text-warn">
            Nenhum resultado parcial foi mantido. Ajuste a configuração e rode novamente.
          </p>
        )}
      </div>

      {runError !== null && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-xl border border-sell/25 bg-sell/[0.05] px-3 py-2 text-[10.5px] leading-relaxed text-sell"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p className="flex-1">{runError}</p>
          <button
            type="button"
            onClick={clearError}
            aria-label="Fechar mensagem de erro"
            className="rounded-md p-0.5 text-sell/80 transition-colors hover:text-sell"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="mt-auto pt-3">
        <p className="text-[9.5px] leading-relaxed text-muted">{hint}</p>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={run} disabled={!canRun} className={RUN_BUTTON}>
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            {running ? 'Rodando…' : 'Rodar backtest'}
          </button>
          {running && (
            <button
              type="button"
              onClick={cancel}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-warn/30 bg-warn/[0.07] px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-warn transition-colors hover:bg-warn/[0.12]"
            >
              <Square className="h-3 w-3" aria-hidden="true" />
              Cancelar
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
