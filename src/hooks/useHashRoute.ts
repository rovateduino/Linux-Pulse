import { useEffect, useState } from 'react'

export const SCREENS = [
  'dashboard',
  'grafico',
  'scanner',
  'laboratorio',
  'diario',
  'configuracoes',
] as const
export type ScreenId = (typeof SCREENS)[number]

const SCREEN_SET = new Set<string>(SCREENS)

function readHash(): ScreenId {
  const raw = window.location.hash.replace(/^#\/?/, '')
  return SCREEN_SET.has(raw) ? (raw as ScreenId) : 'dashboard'
}

export function useHashRoute(): {
  screen: ScreenId
  navigate: (screen: ScreenId) => void
} {
  const [screen, setScreen] = useState<ScreenId>(readHash)

  useEffect(() => {
    const handle = () => {
      setScreen(readHash())
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
    window.addEventListener('hashchange', handle)
    return () => window.removeEventListener('hashchange', handle)
  }, [])

  const navigate = (next: ScreenId) => {
    if (next === readHash()) return
    window.location.hash = `/${next}`
  }

  return { screen, navigate }
}
