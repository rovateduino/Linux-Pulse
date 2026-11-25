import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  RefreshCw,
  Server,
  Upload,
  Wifi,
} from 'lucide-react'
import {
  LAB_SYMBOLS,
  LAB_TIMEFRAME_LABEL,
  labName,
  labSource,
} from '../../data/assets'
import { parseCandlesCsv } from '../../lib/csvCandles'
import type { ParsedCandles } from '../../lib/csvCandles'
import { formatUnixDateTime } from '../../lib/format'
import { ORIGIN_CHIP_CLASS, ORIGIN_SHORT } from '../../lib/labOrigin'
import { isCacheFresh, isLabRunActive, useLabStore } from '../../stores/labStore'
import { PlaybookPicker } from './PlaybookPicker'
import type { DatasetState } from '../../types/lab'

const IDLE_STATE: DatasetState = { status: 'idle' }
const countFormat = new Intl.NumberFormat('pt-BR')

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-accent/30 bg-accent/[0.1] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-accentText transition-colors hover:bg-accent/[0.16] disabled:cursor-not-allowed disabled:opacity-60'

const SECONDARY_BUTTON =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted transition-colors hover:border-white/15 hover:text-content disabled:cursor-not-allowed disabled:opacity-60'

const BINANCE_BUTTON_LABEL = 'Baixar 60 dias de M5 da Binance (público)'

interface CsvPreview {
  fileName: string
  parsed: ParsedCandles
}

function csvTimeframeLabel(parsed: ParsedCandles): string {
  if (parsed.timeframe !== null) return parsed.timeframe.toUpperCase()
  const inferred: Readonly<Record<number, string>> = { 60: 'M1', 300: 'M5', 900: 'M15' }
  const label = inferred[parsed.stepSeconds]
  return label === undefined ? 'Não declarado/inferível' : `${label} (inferido)`
}

function csvUtc(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().replace('.000Z', 'Z')
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] px-2.5 py-2">
      <p className="text-[8px] uppercase tracking-[0.1em] text-muted">{label}</p>
      <p className="mt-1 font-mono text-[12px] tnum text-content">{value}</p>
    </div>
  )
}

export function ImportPanel() {
  const config = useLabStore((state) => state.config)
  const datasets = useLabStore((state) => state.datasets)
  const setConfig = useLabStore((state) => state.setConfig)
  const importSymbol = useLabStore((state) => state.importSymbol)
  const importCsvCandles = useLabStore((state) => state.importCsvCandles)
  const refreshSavedBotDatasets = useLabStore((state) => state.refreshSavedBotDatasets)
  const loadSavedBotDataset = useLabStore((state) => state.loadSavedBotDataset)
  const savedBotDatasets = useLabStore((state) => state.savedBotDatasets)
  const clearDataset = useLabStore((state) => state.clearDataset)
  const phase = useLabStore((state) => state.phase)

  const [csvError, setCsvError] = useState<string | null>(null)
  const [csvFileName, setCsvFileName] = useState<string | null>(null)
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null)
  const [customAssetName, setCustomAssetName] = useState('')
  const csvInputRef = useRef<HTMLInputElement | null>(null)

  // Carrega a lista de CSVs já persistidos neste navegador na abertura do painel.
  useEffect(() => {
    void refreshSavedBotDatasets()
  }, [refreshSavedBotDatasets])

  const datasetState = datasets[config.symbol] ?? IDLE_STATE
  const running = isLabRunActive(phase)
  const fetchSource = labSource(config.symbol)
  const simulated = fetchSource === 'simulado'
  // Série que o gerador local produz para o timeframe base atual:
  // M1 direto (60 s); M5/M15 partem da série M5 (o motor agrega para M15).
  const simSeriesLabel = LAB_TIMEFRAME_LABEL[config.baseTimeframe === '1m' ? '1m' : '5m']
  const datasetSource =
    datasetState.status === 'ready' ? datasetState.dataset.source : fetchSource
  const busy = datasetState.status === 'fetching' || datasetState.status === 'parsing'
  const canImport = !running && !busy
  const canFetchSelectedAsset = LAB_SYMBOLS.includes(config.symbol)

  const startImport = () => {
    if (!canFetchSelectedAsset) return
    void importSymbol(config.symbol)
  }

  const handleCsvFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    input.value = ''
    if (file === undefined) return

    setCsvError(null)
    setCsvFileName(null)
    setCsvPreview(null)

    if (!canImport) return

    try {
      const text = await file.text()
      const parsed = parseCandlesCsv(text)
      setCsvPreview({ fileName: file.name, parsed })
    } catch (error) {
      setCsvError(
        error instanceof Error && error.message.trim() !== ''
          ? error.message
          : 'Não foi possível ler o CSV do bot.',
      )
    }
  }

  const confirmCsvImport = () => {
    if (csvPreview === null || !canImport) return
    try {
      importCsvCandles(
        config.symbol,
        csvPreview.parsed.candles,
        csvPreview.parsed.timeframe,
        customAssetName.trim() || csvPreview.parsed.asset || '',
        csvPreview.fileName,
      )
      setCsvFileName(csvPreview.fileName)
      setCsvPreview(null)
      setCsvError(null)
    } catch (error) {
      setCsvError(
        error instanceof Error && error.message.trim() !== ''
          ? error.message
          : 'Não foi possível importar o CSV.',
      )
    }
  }

  return (
    <section aria-labelledby="lab-import-heading" className="surface p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="eyebrow">Dados</p>
          <h2
            id="lab-import-heading"
            className="mt-1 font-display text-base font-semibold tracking-tight"
          >
            Fonte de candles para backtest
          </h2>
          <p className="mt-1 max-w-xl text-[10.5px] leading-relaxed text-muted">
            Dados históricos só alimentam o backtest e não disparam comandos ao bot.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] ${ORIGIN_CHIP_CLASS[datasetSource]}`}
        >
          {datasetSource === 'simulado' ? (
            <Wifi className="h-3 w-3" aria-hidden="true" />
          ) : datasetSource === 'bot' ? (
            <Upload className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Server className="h-3 w-3" aria-hidden="true" />
          )}
          {ORIGIN_SHORT[datasetSource]}
        </span>
      </header>

      <div
        role="group"
        aria-label="Ativo do laboratório"
        className="mt-3 flex flex-wrap gap-1.5"
      >
        {LAB_SYMBOLS.map((symbol) => {
          const active = config.symbol === symbol
          return (
            <button
              key={symbol}
              type="button"
              aria-pressed={active}
              title={labName(symbol)}
              disabled={running}
              onClick={() => setConfig({ symbol })}
              className={`rounded-lg border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.06em] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                active
                  ? 'border-accent/35 bg-accent/[0.1] text-content'
                  : 'border-line bg-white/[0.02] text-muted hover:text-content'
              }`}
            >
              {symbol}
            </button>
          )
        })}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
        <PlaybookPicker idSuffix="-import" />
      </div>

      <div className="mt-3 rounded-2xl border border-line bg-white/[0.02] p-3" aria-live="polite">
        {datasetState.status === 'idle' && (
          <div>
            <div className="flex items-start gap-2">
              <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              <div>
                <p className="text-[12px] font-medium text-content">Nenhum dataset carregado</p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
                  {simulated
                    ? `O modo simulado gera 60 dias de ${simSeriesLabel} com o mesmo gerador local do terminal e mantém o rótulo SIMULADO.`
                    : 'Busque 60 dias de candles M5 fechados. Se houver cache local, ele é lido primeiro.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={startImport}
              disabled={!canImport}
              className={`mt-3 w-full ${PRIMARY_BUTTON}`}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {simulated ? `Gerar 60 dias simulados (${simSeriesLabel})` : BINANCE_BUTTON_LABEL}
            </button>
          </div>
        )}

        {datasetState.status === 'fetching' && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] font-medium text-content">
                {simulated ? 'Gerando candles simulados…' : 'Baixando candles da Binance…'}
              </p>
              <span className="font-mono text-[10px] tnum text-muted">
                {Math.round(datasetState.progress)}%
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Progresso da importação"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(datasetState.progress)}
              className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
            >
              <div
                className="h-full rounded-full bg-info/80 transition-[width] duration-200 ease-linear"
                style={{ width: `${Math.max(2, Math.min(100, datasetState.progress))}%` }}
              />
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted">
              {simulated
                ? `Montando velas ${simSeriesLabel} a partir do gerador determinístico.`
                : 'Páginas de até 1.000 velas com 200 ms entre chamadas. Apenas velas fechadas são aceitas.'}
            </p>
          </div>
        )}

        {datasetState.status === 'parsing' && (
          <div className="flex items-start gap-2">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
            <div>
              <p className="text-[12px] font-medium text-content">Validando candles e lacunas…</p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
                Datas, OHLC e volume são conferidos. Registros inválidos são descartados, nunca
                completados.
              </p>
            </div>
          </div>
        )}

        {datasetState.status === 'ready' && (
          <div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-buy" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-content">
                  {countFormat.format(datasetState.dataset.candles.length)} velas prontas
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted">
                  {datasetState.dataset.source === 'simulado'
                    ? 'Fonte SIMULADO · gerador local'
                    : datasetState.dataset.source === 'bot'
                      ? 'Fonte BOT (IQ Option) · CSV importado'
                      : 'Fonte Binance · candles fechados'}{' '}
                  · local {formatUnixDateTime(Math.floor(datasetState.dataset.fetchedAt / 1000))}
                </p>
              </div>
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-2">
              <Stat
                label="Esperado"
                value={countFormat.format(datasetState.dataset.expected)}
              />
              <Stat
                label="Lacunas"
                value={countFormat.format(datasetState.dataset.gaps)}
              />
              <Stat label="Cache" value={datasetState.cached ? 'IndexedDB' : 'memória'} />
            </div>

            {datasetState.dataset.gaps > 0 && (
              <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-warn/20 bg-warn/[0.05] px-2.5 py-2 text-[10px] leading-relaxed text-warn">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {countFormat.format(datasetState.dataset.gaps)} velas ausentes no período. Elas são
                contabilizadas como lacuna e não são fabricadas.
              </p>
            )}

            {datasetState.cached && datasetState.dataset.source !== 'bot' && (
              <p className="mt-2 text-[9.5px] leading-relaxed text-muted">
                {isCacheFresh(datasetState.dataset.fetchedAt)
                  ? 'Cache com menos de 24 h.'
                  : 'Cache com mais de 24 h; use Atualizar para buscar novamente.'}
              </p>
            )}

            {datasetState.dataset.source === 'bot' ? (
              <button
                type="button"
                onClick={clearDataset}
                disabled={!canImport}
                className={`mt-3 w-full ${SECONDARY_BUTTON}`}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Limpar CSV e voltar para Binance
              </button>
            ) : (
              <button
                type="button"
                onClick={startImport}
                disabled={!canImport || !canFetchSelectedAsset}
                className={`mt-3 w-full ${SECONDARY_BUTTON}`}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                {simulated ? `Regerar simulados (${simSeriesLabel})` : BINANCE_BUTTON_LABEL}
              </button>
            )}
          </div>
        )}

        {datasetState.status === 'error' && (
          <div role="alert">
            <p className="flex items-start gap-1.5 text-[11.5px] font-medium leading-relaxed text-sell">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {datasetState.message}
            </p>
            <button
              type="button"
              onClick={startImport}
              disabled={!canImport}
              className={`mt-3 w-full ${SECONDARY_BUTTON}`}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Tentar novamente
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 rounded-2xl border border-line bg-white/[0.02] p-3">
        <div className="flex items-start gap-2">
          <Upload className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-content">Candles exportados pelo bot</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
              Cabeçalho{' '}
              <span className="font-mono text-[10px] text-content/80">
                timestamp_utc,open,high,low,close,volume
              </span>{' '}
              (aceita também <span className="font-mono text-[10px] text-content/80">timestamp</span>
              ). Coluna{' '}
              <span className="font-mono text-[10px] text-content/80">timeframe</span> opcional
              (M1/1m, M5/5m, M15/15m) associa o arquivo ao timeframe do laboratório. O arquivo é
              validado linha a linha. Um resumo de fonte, ativo, período, quantidade, timeframe e
              lacunas aparece para revisão antes de confirmar a importação; metadados ausentes são
              apresentados como não declarados e nenhum candle é completado.
            </p>
          </div>
        </div>

        <label
          htmlFor="lab-custom-asset-name"
          className="mt-3 block text-[9px] uppercase tracking-[0.1em] text-muted"
        >
          Nome do Ativo (ex: EURUSD-OTC)
        </label>
        <input
          id="lab-custom-asset-name"
          type="text"
          value={customAssetName}
          maxLength={40}
          disabled={!canImport}
          onChange={(event) => setCustomAssetName(event.target.value)}
          placeholder={config.symbol}
          className="mt-1 w-full rounded-xl border border-line bg-white/[0.02] px-2.5 py-2 font-mono text-[11px] text-content outline-none transition-colors placeholder:text-muted/60 focus:border-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
        />

        <input
          ref={csvInputRef}
          id="lab-bot-csv"
          type="file"
          accept=".csv"
          aria-label="Arquivo CSV de candles exportado pelo bot"
          className="sr-only"
          onChange={(event) => {
            void handleCsvFile(event)
          }}
        />
        <button
          type="button"
          disabled={!canImport}
          onClick={() => csvInputRef.current?.click()}
          className={`mt-3 w-full ${SECONDARY_BUTTON}`}
        >
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          Importar CSV do bot (IQ Option)
        </button>

        <div className="mt-2.5" aria-live="polite">
          {csvError !== null && (
            <p
              role="alert"
              className="flex items-start gap-1.5 rounded-lg border border-sell/25 bg-sell/[0.05] px-2.5 py-2 text-[10px] leading-relaxed text-sell"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {csvError}
            </p>
          )}
          {csvPreview !== null && (
            <div
              role="region"
              aria-label="Resumo do CSV antes da importação"
              className="rounded-lg border border-info/25 bg-info/[0.04] px-2.5 py-2.5"
            >
              <p className="text-[11px] font-semibold text-content">
                Revise os dados antes de importar · {csvPreview.fileName}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Stat label="Fonte declarada" value={csvPreview.parsed.source ?? 'Não declarada'} />
                <Stat label="Ativo no CSV" value={csvPreview.parsed.asset ?? 'Não declarado'} />
                <Stat label="Ativo no Laboratório" value={
                  customAssetName.trim() || csvPreview.parsed.asset || config.symbol
                } />
                <Stat label="Timeframe" value={csvTimeframeLabel(csvPreview.parsed)} />
                <Stat
                  label="Início UTC"
                  value={csvUtc(csvPreview.parsed.candles[0].time)}
                />
                <Stat
                  label="Fim UTC"
                  value={csvUtc(csvPreview.parsed.candles[csvPreview.parsed.candles.length - 1].time)}
                />
                <Stat
                  label="Candles"
                  value={countFormat.format(csvPreview.parsed.candles.length)}
                />
                <Stat
                  label="Saltos / intervalos ausentes"
                  value={`${countFormat.format(csvPreview.parsed.gapCount)} / ${countFormat.format(csvPreview.parsed.missingIntervals)}`}
                />
              </div>
              <p className="mt-2 text-[9.5px] leading-relaxed text-muted">
                Saltos contam intervalos maiores que o timeframe e podem incluir fins de semana e
                fechamentos do mercado. Nenhum candle será criado para preencher lacunas.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={confirmCsvImport}
                  disabled={!canImport}
                  className={PRIMARY_BUTTON}
                >
                  Confirmar importação
                </button>
                <button
                  type="button"
                  onClick={() => setCsvPreview(null)}
                  disabled={!canImport}
                  className={SECONDARY_BUTTON}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {csvError === null &&
            datasetState.status === 'ready' &&
            datasetState.dataset.source === 'bot' && (
              <p className="flex items-start gap-1.5 rounded-lg border border-buy/25 bg-buy/[0.05] px-2.5 py-2 text-[10px] leading-relaxed text-buy">
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span>
                  {`${countFormat.format(datasetState.dataset.candles.length)} velas importadas${
                    csvFileName !== null ? ` · ${csvFileName}` : ''
                  } · origem BOT (IQ Option)`}
                </span>
              </p>
            )}
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-line bg-white/[0.02] p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-content">CSVs salvos neste navegador</p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
                Cada ativo importado fica gravado no IndexedDB. Carregue no backtest sem enviar o
                arquivo de novo.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              void refreshSavedBotDatasets()
            }}
            disabled={running}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-white/[0.02] px-2 py-1 text-[9px] font-medium uppercase tracking-[0.08em] text-muted transition-colors hover:border-white/15 hover:text-content disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Atualizar
          </button>
        </div>

        {savedBotDatasets.length === 0 ? (
          <p className="mt-3 text-[10.5px] leading-relaxed text-muted">
            Nenhum CSV salvo ainda. Importe um arquivo do bot para iniciar o histórico.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5" aria-live="polite">
            {savedBotDatasets.map((saved) => {
              const active =
                datasetState.status === 'ready' &&
                datasetState.dataset.source === 'bot' &&
                datasetState.dataset.symbol === saved.symbol
              return (
                <li
                  key={saved.symbol}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-2.5 py-2 ${
                    active ? 'border-accent/35 bg-accent/[0.07]' : 'border-line bg-white/[0.02]'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] text-content">{saved.symbol}</p>
                    <p className="mt-0.5 text-[9.5px] leading-relaxed text-muted">
                      {saved.timeframe === null
                        ? 'Timeframe não declarado'
                        : LAB_TIMEFRAME_LABEL[saved.timeframe]}
                      {' · '}
                      {countFormat.format(saved.candleCount)} velas
                      {' · '}
                      {formatUnixDateTime(Math.floor(saved.fetchedAt / 1000))}
                      {saved.gaps > 0 ? ` · ${countFormat.format(saved.gaps)} lacunas` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void loadSavedBotDataset(saved.symbol)
                    }}
                    disabled={running || active}
                    className={`shrink-0 ${SECONDARY_BUTTON}`}
                  >
                    {active ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Carregado
                      </>
                    ) : (
                      <>
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        Carregar
                      </>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <p className="mt-2.5 text-[9.5px] leading-relaxed text-muted">
        A importação da Binance e os CSVs do bot ficam gravados no IndexedDB deste navegador,
        indexados pelo nome do ativo. Nenhum candle é inventado; lacunas e falhas ficam visíveis.
      </p>
    </section>
  )
}
