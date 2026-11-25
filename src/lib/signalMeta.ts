import type { RegimeKind, SignalPlaybook, SignalView, TradeOutcome } from '../types/market'

export type SignalTone = 'buy' | 'sell' | 'warn' | 'idle' | 'info'

export function signalTone(signal: SignalView): SignalTone {
  if (signal.phase === 'RESULTADO') {
    const outcome = signal.lastResult?.outcome
    if (outcome === 'WIN') return 'buy'
    if (outcome === 'LOSS') return 'sell'
    return 'warn'
  }
  if (signal.phase === 'ENTRAR' || signal.phase === 'EM_ANDAMENTO') {
    return signal.direction === 'DOWN' ? 'sell' : 'buy'
  }
  if (signal.phase === 'ATENCAO') return 'warn'
  return 'idle'
}

export function verdictLabel(signal: SignalView): string {
  if (signal.phase === 'RESULTADO') {
    const outcome = signal.lastResult?.outcome
    if (outcome === 'WIN') return 'ACERTO'
    if (outcome === 'LOSS') return 'ERRO'
    return 'EMPATE'
  }
  if (signal.phase === 'ENTRAR' || signal.phase === 'EM_ANDAMENTO') {
    return signal.direction === 'UP' ? 'COMPRAR' : 'VENDER'
  }
  if (signal.phase === 'ATENCAO') return 'PREPARE-SE'
  return 'AGUARDAR'
}

export function phaseLabel(signal: SignalView): string {
  if (signal.phase === 'ENTRAR') return 'ENTRAR'
  if (signal.phase === 'EM_ANDAMENTO') return 'EM ANDAMENTO'
  if (signal.phase === 'RESULTADO') return 'RESULTADO'
  if (signal.phase === 'ATENCAO') return 'ATENÇÃO'
  return 'OBSERVANDO'
}

export function outcomeLabel(outcome: TradeOutcome | null): string {
  if (outcome === 'WIN') return 'Acerto'
  if (outcome === 'LOSS') return 'Erro'
  if (outcome === 'TIE') return 'Empate'
  return 'Em aberto'
}

export function outcomeTone(outcome: TradeOutcome | null): 'buy' | 'sell' | 'warn' | 'idle' {
  if (outcome === 'WIN') return 'buy'
  if (outcome === 'LOSS') return 'sell'
  if (outcome === 'TIE') return 'warn'
  return 'idle'
}

export function directionLabel(direction: 'UP' | 'DOWN' | null): string {
  if (direction === 'UP') return 'Alta'
  if (direction === 'DOWN') return 'Baixa'
  return 'Neutro'
}

export function regimeLabel(kind: RegimeKind): string {
  if (kind === 'TENDENCIA') return 'Tendência'
  if (kind === 'LATERAL') return 'Lateral'
  return 'Sem regime'
}

export function regimeDescription(kind: RegimeKind): string {
  if (kind === 'TENDENCIA') return 'ADX ≥ 25 e EMAs alinhadas'
  if (kind === 'LATERAL') return 'ADX < 18 e bandas comprimidas'
  return 'Fora dos critérios de operação'
}

export function playbookLabel(playbook: SignalPlaybook | null): string {
  if (playbook === 'C') return 'Playbook C · momentum de sessão (breakout)'
  if (playbook === 'D') return 'Playbook D · reversão em extremos (fade)'
  if (playbook === 'A') return 'Playbook A · pullback em tendência'
  if (playbook === 'B') return 'Playbook B · reversão em lateral'
  return 'Nenhum playbook habilitado'
}

export function regimeTone(kind: RegimeKind): 'buy' | 'warn' | 'muted' {
  if (kind === 'TENDENCIA') return 'buy'
  if (kind === 'LATERAL') return 'warn'
  return 'muted'
}
