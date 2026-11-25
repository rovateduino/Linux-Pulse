import type { ReactNode } from 'react'
import {
  FlaskConical,
  LayoutDashboard,
  Lock,
  NotebookPen,
  Radar,
  Settings,
  ShieldAlert,
} from 'lucide-react'
import type { ScreenId } from '../hooks/useHashRoute'
import { BrandMark } from './BrandMark'

interface AppShellProps {
  children: ReactNode
  screen: ScreenId
  onNavigate: (screen: ScreenId) => void
}

interface NavItem {
  id: ScreenId | null
  label: string
  shortLabel?: string
  icon: typeof LayoutDashboard
  stage?: string
}

const PRIMARY_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'scanner', label: 'Scanner', icon: Radar },
  { id: 'laboratorio', label: 'Laboratório', icon: FlaskConical },
  { id: 'diario', label: 'Diário', icon: NotebookPen },
]

const MOBILE_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', shortLabel: 'Início', icon: LayoutDashboard },
  { id: 'scanner', label: 'Scanner', icon: Radar },
  { id: 'laboratorio', label: 'Laboratório', shortLabel: 'Lab', icon: FlaskConical },
  { id: 'diario', label: 'Diário', icon: NotebookPen },
  {
    id: 'configuracoes',
    label: 'Configurações',
    shortLabel: 'Ajustes',
    icon: Settings,
  },
]

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`grid place-items-center rounded-xl border border-accent/25 bg-accent/[0.08] text-accent ${
          compact ? 'h-9 w-9' : 'h-10 w-10'
        }`}
      >
        <BrandMark className={compact ? 'h-5 w-5' : 'h-5 w-5'} />
      </span>
      <div className="leading-tight">
        <p className="font-display text-[13px] font-semibold tracking-[0.12em]">PULSE SIGNALS</p>
        <p className="mt-0.5 text-[9px] uppercase tracking-[0.2em] text-muted">
          {compact ? 'Terminal' : 'Terminal · laboratório'}
        </p>
      </div>
    </div>
  )
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick: () => void
}) {
  const Icon = item.icon

  if (item.id === null) {
    return (
      <button
        type="button"
        disabled
        title={`${item.label} · disponível na ${item.stage}`}
        className="flex w-full cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] text-muted/70"
      >
        <span className="grid h-7 w-7 place-items-center rounded-lg border border-line bg-white/[0.02]">
          <Icon className="h-4 w-4" />
        </span>
        <span className="flex-1">{item.label}</span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-line px-1.5 py-0.5 text-[8px] uppercase tracking-[0.08em] text-muted/70">
          <Lock className="h-2.5 w-2.5" aria-hidden="true" />
          {item.stage}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${
        active
          ? 'border-accent/25 bg-accent/[0.09] text-content'
          : 'border-transparent text-muted hover:border-line hover:bg-white/[0.025] hover:text-content'
      }`}
    >
      <span
        className={`grid h-7 w-7 place-items-center rounded-lg ${
          active ? 'bg-accent/15 text-accent' : 'border border-line bg-white/[0.02]'
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1">{item.label}</span>
      {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />}
    </button>
  )
}

export function AppShell({ children, screen, onNavigate }: AppShellProps) {
  return (
    <div className="min-h-[100dvh]">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-[-22rem] h-[38rem] w-[62rem] -translate-x-1/2 rounded-full bg-accent/[0.07] blur-[140px]" />
        <div className="absolute right-[-16rem] top-1/3 h-[26rem] w-[34rem] rounded-full bg-info/[0.035] blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:26px_26px] opacity-40 [mask-image:radial-gradient(70%_50%_at_50%_0%,black,transparent)]" />
      </div>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-line bg-canvas/70 backdrop-blur-xl lg:flex lg:flex-col">
        <div className="flex h-full flex-col px-4 py-5">
          <div className="px-2">
            <Brand />
          </div>

          <div className="mt-8 flex items-center justify-between px-3">
            <p className="eyebrow">Terminal</p>
            <span className="rounded-full border border-buy/25 bg-buy/[0.06] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-buy">
              Ao vivo
            </span>
          </div>
          <nav aria-label="Navegação principal" className="mt-2.5 space-y-1">
            {PRIMARY_NAV.map((item) => (
              <NavButton
                key={item.label}
                item={item}
                active={item.id !== null && item.id === screen}
                onClick={() => item.id !== null && onNavigate(item.id)}
              />
            ))}
          </nav>

          <div className="mt-2 border-t border-line pt-2">
            <NavButton
              item={{ id: 'configuracoes', label: 'Configurações', icon: Settings }}
              active={screen === 'configuracoes'}
              onClick={() => onNavigate('configuracoes')}
            />
          </div>

          <div className="mt-auto space-y-3">
            <div className="flex items-start gap-2 px-1 text-[10px] leading-relaxed text-muted/80">
              <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <p>Conteúdo educacional. Opções binárias são de alto risco.</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Brand compact />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-buy/25 bg-buy/[0.06] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-buy">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-buy" aria-hidden="true" />
              Ao vivo
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1380px] px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
          {children}
        </main>
      </div>

      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <div className="grid grid-cols-5">
          {MOBILE_NAV.map((item) => {
            const Icon = item.icon
            const active = item.id === screen
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => item.id !== null && onNavigate(item.id)}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                className={`relative flex min-w-0 flex-col items-center gap-1 overflow-hidden py-2.5 text-[8.5px] font-medium transition-colors ${
                  active ? 'text-accent' : 'text-muted/70 hover:text-content'
                }`}
              >
                {active && (
                  <span className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent" />
                )}
                <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                <span className="w-full truncate px-0.5 text-center leading-none">
                  {item.shortLabel ?? item.label}
                </span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
