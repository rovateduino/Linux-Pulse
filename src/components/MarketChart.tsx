import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CandlestickData,
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  MouseEventParams,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import { ChartSpline, Layers, TimerReset } from 'lucide-react'
import type { Candle, CandleDirection, Timeframe } from '../types/market'
import { PALETTE, withAlpha } from '../lib/palette'
import { formatPercent, formatPrice, formatUnixTime } from '../lib/format'
import { TIMEFRAME_LABEL } from '../data/assets'

interface MarketChartProps {
  symbol: string
  name: string
  decimals: number
  timeframe: Timeframe
  onTimeframeChange: (timeframe: Timeframe) => void
  closed: Candle[]
  marker: { time: number; direction: CandleDirection; label?: string } | null
  tall?: boolean
}

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m']

function toBar(candle: Candle): CandlestickData<UTCTimestamp> {
  return {
    time: candle.time as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }
}

function lineData(candles: readonly Candle[], values: readonly (number | null)[]) {
  const output: { time: UTCTimestamp; value: number }[] = []
  for (let index = 0; index < candles.length; index += 1) {
    const value = values[index]
    if (value === null) continue
    output.push({ time: candles[index].time as UTCTimestamp, value })
  }
  return output
}

export function MarketChart({
  symbol,
  name,
  decimals,
  timeframe,
  onTimeframeChange,
  closed,
  marker,
  tall = false,
}: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const ema20Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const bandUpperRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bandMiddleRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bandLowerRef = useRef<ISeriesApi<'Line'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const viewKeyRef = useRef('')
  const decimalsRef = useRef(decimals)

  const [chartReady, setChartReady] = useState(0)
  const [chartStatus, setChartStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [showEma, setShowEma] = useState(false)
  const [showBands, setShowBands] = useState(false)
  const [hover, setHover] = useState<Candle | null>(null)

  useEffect(() => {
    decimalsRef.current = decimals
  }, [decimals])

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    let disposed = false
    let chart: IChartApi | null = null
    let handleCrosshair: ((param: MouseEventParams<Time>) => void) | null = null

    void import('lightweight-charts')
      .then((module) => {
        if (disposed) return

        const created = module.createChart(container, {
          autoSize: true,
          layout: {
            background: { type: module.ColorType.Solid, color: 'transparent' },
            textColor: PALETTE.muted,
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            fontSize: 10,
          },
          grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.035)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.035)' },
          },
          rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.06)',
            scaleMargins: { top: 0.12, bottom: 0.12 },
          },
          timeScale: {
            borderColor: 'rgba(255, 255, 255, 0.06)',
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 3,
            barSpacing: 7,
            minBarSpacing: 3,
          },
          crosshair: {
            mode: module.CrosshairMode.Normal,
            vertLine: {
              color: 'rgba(255, 255, 255, 0.16)',
              labelBackgroundColor: PALETTE.surface,
            },
            horzLine: {
              color: 'rgba(255, 255, 255, 0.16)',
              labelBackgroundColor: PALETTE.surface,
            },
          },
          localization: {
            locale: 'pt-BR',
            priceFormatter: (price: number) => formatPrice(price, decimalsRef.current),
          },
        })

        const candles = created.addSeries(module.CandlestickSeries, {
          upColor: PALETTE.buy,
          downColor: PALETTE.sell,
          borderUpColor: PALETTE.buy,
          borderDownColor: PALETTE.sell,
          wickUpColor: withAlpha(PALETTE.buy, 0.75),
          wickDownColor: withAlpha(PALETTE.sell, 0.75),
          priceLineVisible: false,
          priceFormat: {
            type: 'price',
            precision: decimalsRef.current,
            minMove: 1 / 10 ** decimalsRef.current,
          },
        })

        const ema20 = created.addSeries(module.LineSeries, {
          color: PALETTE.info,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          visible: false,
        })
        const ema50 = created.addSeries(module.LineSeries, {
          color: PALETTE.accentText,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          visible: false,
        })
        const bandUpper = created.addSeries(module.LineSeries, {
          color: withAlpha(PALETTE.info, 0.45),
          lineWidth: 1,
          lineStyle: module.LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          visible: false,
        })
        const bandMiddle = created.addSeries(module.LineSeries, {
          color: withAlpha(PALETTE.accentText, 0.5),
          lineWidth: 1,
          lineStyle: module.LineStyle.Dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          visible: false,
        })
        const bandLower = created.addSeries(module.LineSeries, {
          color: withAlpha(PALETTE.info, 0.45),
          lineWidth: 1,
          lineStyle: module.LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          visible: false,
        })

        const markers = module.createSeriesMarkers(candles, [])
        chart = created
        chartRef.current = created
        candleRef.current = candles
        ema20Ref.current = ema20
        ema50Ref.current = ema50
        bandUpperRef.current = bandUpper
        bandMiddleRef.current = bandMiddle
        bandLowerRef.current = bandLower
        markersRef.current = markers

        handleCrosshair = (param: MouseEventParams<Time>) => {
          if (param.time === undefined) {
            setHover(null)
            return
          }
          const data = param.seriesData.get(candles) as CandlestickData<Time> | undefined
          if (data === undefined) {
            setHover(null)
            return
          }
          setHover({
            time: Number(param.time),
            open: data.open,
            high: data.high,
            low: data.low,
            close: data.close,
            volume: 0,
          })
        }
        created.subscribeCrosshairMove(handleCrosshair)

        setChartStatus('ready')
        setChartReady((value) => value + 1)
      })
      .catch(() => {
        if (disposed) return
        setChartStatus('error')
      })

    return () => {
      disposed = true
      if (chart !== null) {
        if (handleCrosshair !== null) chart.unsubscribeCrosshairMove(handleCrosshair)
        chart.remove()
      }
      chartRef.current = null
      candleRef.current = null
      ema20Ref.current = null
      ema50Ref.current = null
      bandUpperRef.current = null
      bandMiddleRef.current = null
      bandLowerRef.current = null
      markersRef.current = null
    }
  }, [])

  useEffect(() => {
    candleRef.current?.applyOptions({
      priceFormat: {
        type: 'price',
        precision: decimals,
        minMove: 1 / 10 ** decimals,
      },
    })
  }, [decimals])

  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({
      secondsVisible: timeframe === '1m',
    })
  }, [timeframe])

  useEffect(() => {
    const series = candleRef.current
    if (series === null) return
    const bars = closed.slice(-160).map(toBar)
    series.setData(bars)

    const viewKey = `${symbol}-${timeframe}`
    if (viewKeyRef.current !== viewKey) {
      chartRef.current?.timeScale().setVisibleLogicalRange({
        from: Math.max(0, bars.length - 72),
        to: bars.length + 3,
      })
      viewKeyRef.current = viewKey
    }
  }, [chartReady, closed, symbol, timeframe])

  useEffect(() => {
    ema20Ref.current?.applyOptions({ visible: showEma })
    ema50Ref.current?.applyOptions({ visible: showEma })
    bandUpperRef.current?.applyOptions({ visible: showBands })
    bandMiddleRef.current?.applyOptions({ visible: showBands })
    bandLowerRef.current?.applyOptions({ visible: showBands })
  }, [chartReady, showEma, showBands])

  const overlayData = useMemo(() => {
    const closes = closed.map((candle) => candle.close)
    const period = 20
    const middle: (number | null)[] = new Array(closes.length).fill(null)
    const upper: (number | null)[] = new Array(closes.length).fill(null)
    const lower: (number | null)[] = new Array(closes.length).fill(null)
    for (let index = period - 1; index < closes.length; index += 1) {
      let sum = 0
      for (let cursor = index - period + 1; cursor <= index; cursor += 1) sum += closes[cursor]
      const mean = sum / period
      let variance = 0
      for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
        variance += (closes[cursor] - mean) ** 2
      }
      const deviation = Math.sqrt(variance / period)
      middle[index] = mean
      upper[index] = mean + 2 * deviation
      lower[index] = mean - 2 * deviation
    }

    const emaSeries = (values: readonly number[], span: number): (number | null)[] => {
      const output: (number | null)[] = new Array(values.length).fill(null)
      if (values.length < span) return output
      let sum = 0
      for (let index = 0; index < span; index += 1) sum += values[index]
      let previous = sum / span
      output[span - 1] = previous
      const multiplier = 2 / (span + 1)
      for (let index = span; index < values.length; index += 1) {
        previous = (values[index] - previous) * multiplier + previous
        output[index] = previous
      }
      return output
    }

    return {
      ema20: lineData(closed, emaSeries(closes, 20)),
      ema50: lineData(closed, emaSeries(closes, 50)),
      upper: lineData(closed, upper),
      middle: lineData(closed, middle),
      lower: lineData(closed, lower),
    }
  }, [closed])

  useEffect(() => {
    ema20Ref.current?.setData(overlayData.ema20)
    ema50Ref.current?.setData(overlayData.ema50)
    bandUpperRef.current?.setData(overlayData.upper)
    bandMiddleRef.current?.setData(overlayData.middle)
    bandLowerRef.current?.setData(overlayData.lower)
  }, [chartReady, overlayData])

  useEffect(() => {
    const markers = markersRef.current
    if (markers === null) return
    if (marker === null || timeframe !== '5m') {
      markers.setMarkers([])
      return
    }
    markers.setMarkers([
      {
        time: marker.time as UTCTimestamp,
        position: marker.direction === 'UP' ? 'belowBar' : 'aboveBar',
        color: marker.direction === 'UP' ? PALETTE.buy : PALETTE.sell,
        shape: marker.direction === 'UP' ? 'arrowUp' : 'arrowDown',
        text: marker.label ?? 'ENTRAR',
        size: 1,
      },
    ])
  }, [chartReady, marker, timeframe])

  const lastClosed = closed[closed.length - 1] ?? null
  const legend = hover ?? lastClosed
  const legendUp = legend !== null && legend.close >= legend.open
  const priceFormatter = (value: number) => formatPrice(value, decimals)

  return (
    <section aria-labelledby="chart-heading" className="surface flex h-full flex-col p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Gráfico</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 id="chart-heading" className="font-display text-base font-semibold tracking-tight">
              {symbol}
            </h2>
            <span className="text-[10px] text-muted">{name}</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted/70">
              {TIMEFRAME_LABEL[timeframe]} · candles fechados
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Timeframe do gráfico"
            className="flex rounded-lg border border-line bg-white/[0.02] p-0.5"
          >
            {TIMEFRAMES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={timeframe === value}
                onClick={() => onTimeframeChange(value)}
                className={`rounded-md px-2 py-1 font-mono text-[9px] uppercase tracking-[0.06em] transition-colors ${
                  timeframe === value ? 'bg-white/[0.07] text-content' : 'text-muted hover:text-content'
                }`}
              >
                {TIMEFRAME_LABEL[value]}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={showEma}
            onClick={() => setShowEma((value) => !value)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[9px] font-medium uppercase tracking-[0.06em] transition-colors ${
              showEma
                ? 'border-info/30 bg-info/[0.08] text-info'
                : 'border-line bg-white/[0.02] text-muted hover:text-content'
            }`}
          >
            <ChartSpline className="h-3 w-3" aria-hidden="true" />
            EMA
          </button>
          <button
            type="button"
            aria-pressed={showBands}
            onClick={() => setShowBands((value) => !value)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[9px] font-medium uppercase tracking-[0.06em] transition-colors ${
              showBands
                ? 'border-accent/35 bg-accent/[0.08] text-accentText'
                : 'border-line bg-white/[0.02] text-muted hover:text-content'
            }`}
          >
            <Layers className="h-3 w-3" aria-hidden="true" />
            Bandas
          </button>
        </div>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9.5px] tnum text-muted">
        {legend !== null ? (
          <>
            <span className="flex items-center gap-1 text-content">
              <TimerReset className="h-2.5 w-2.5 text-muted" aria-hidden="true" />
              {formatUnixTime(legend.time)}
            </span>
            <span>A {priceFormatter(legend.open)}</span>
            <span>M {priceFormatter(legend.high)}</span>
            <span>m {priceFormatter(legend.low)}</span>
            <span className={legendUp ? 'text-buy' : 'text-sell'}>{priceFormatter(legend.close)}</span>
            <span className="text-muted/70">
              {formatPercent(((legend.close - legend.open) / legend.open) * 100)}
            </span>
          </>
        ) : (
          <span>Aguardando candles…</span>
        )}
      </div>

      <div
        className={`relative mt-2 w-full ${tall ? 'h-[340px] sm:h-[480px] lg:h-[560px]' : 'h-[290px] sm:h-[380px]'}`}
      >
        <div ref={containerRef} className="h-full w-full" />
        {chartStatus === 'loading' && (
          <div
            role="status"
            className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-surface/70 text-[10px] uppercase tracking-[0.08em] text-muted"
          >
            Carregando gráfico…
          </div>
        )}
        {chartStatus === 'error' && (
          <div
            role="alert"
            className="absolute inset-0 grid place-items-center rounded-xl border border-warn/25 bg-surface/85 px-4 text-center text-[10.5px] text-warn"
          >
            Não foi possível carregar o gráfico. Recarregue a página para tentar novamente.
          </div>
        )}
      </div>

      <footer className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[9px] leading-relaxed text-muted">
        <p>Camadas técnicas desligadas por padrão. Marcador apenas em gatilho confirmado.</p>
        <p className="font-mono uppercase tracking-[0.08em] text-muted/70">UTC interno · exibição local</p>
      </footer>
    </section>
  )
}
