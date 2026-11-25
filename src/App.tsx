import { lazy, Suspense } from 'react'
import { MotionConfig } from 'motion/react'
import { AppShell } from './components/AppShell'
import { Dashboard } from './components/Dashboard'
import { useHashRoute } from './hooks/useHashRoute'
import { useLiveBot } from './hooks/useLiveBot'
import { useMarketClock } from './hooks/useMarketData'
import { useJournalSync, useSignalAlerts } from './hooks/useJournalSync'
import { useMarketStore } from './store/marketStore'

const Grafico = lazy(() =>
  import('./components/Grafico').then((module) => ({ default: module.Grafico })),
)
const Scanner = lazy(() =>
  import('./components/Scanner').then((module) => ({ default: module.Scanner })),
)
const Diario = lazy(() =>
  import('./components/Diario').then((module) => ({ default: module.Diario })),
)
const Configuracoes = lazy(() =>
  import('./components/Configuracoes').then((module) => ({ default: module.Configuracoes })),
)
const Laboratorio = lazy(() =>
  import('./pages/Laboratorio').then((module) => ({ default: module.Laboratorio })),
)

function ScreenFallback() {
  return (
    <p role="status" className="py-20 text-center text-[11px] text-muted">
      Carregando tela…
    </p>
  )
}

export default function App() {
  const { screen, navigate } = useHashRoute()
  const liveBot = useLiveBot()
  useMarketClock()

  const analyses = useMarketStore((state) => state.analyses)
  const sessionStart = useMarketStore((state) => state.feed.anchorSec)
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol)

  useJournalSync(analyses, sessionStart)
  useSignalAlerts(analyses)

  const openChart = (symbol: string) => {
    setSelectedSymbol(symbol)
    navigate('grafico')
  }

  return (
    <MotionConfig reducedMotion="user">
      <AppShell screen={screen} onNavigate={navigate}>
        <Suspense fallback={<ScreenFallback />}>
          {screen === 'dashboard' && <Dashboard liveBot={liveBot} />}
          {screen === 'grafico' && <Grafico />}
          {screen === 'scanner' && <Scanner openChart={openChart} />}
          {screen === 'laboratorio' && <Laboratorio />}
          {screen === 'diario' && <Diario liveBot={liveBot} />}
          {screen === 'configuracoes' && <Configuracoes liveBot={liveBot} />}
        </Suspense>
      </AppShell>
    </MotionConfig>
  )
}
