import type { SignalPlaybook } from '../types/market'
import type { GridCombo, LabTimeframe } from '../types/lab'

export const MAX_GRID_COMBOS = 24
export const GRID_TIMEFRAMES: readonly LabTimeframe[] = ['5m', '15m']
export const GRID_PLAYBOOKS: readonly SignalPlaybook[] = ['C', 'D']

export function comboId(
  symbol: string,
  timeframe: LabTimeframe,
  playbook: SignalPlaybook,
): string {
  return `${symbol}-${timeframe}-${playbook}`
}

export function listGrid(
  symbols: readonly string[],
  timeframes: readonly LabTimeframe[] = GRID_TIMEFRAMES,
  playbooks: readonly SignalPlaybook[] = GRID_PLAYBOOKS,
): GridCombo[] {
  const combos: GridCombo[] = []
  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      for (const playbook of playbooks) {
        combos.push({
          id: comboId(symbol, timeframe, playbook),
          symbol,
          timeframe,
          playbook,
          label: `Playbook ${playbook} · ${symbol} · ${timeframe === '1m' ? 'M1' : timeframe === '5m' ? 'M5' : 'M15'}`,
        })
        if (combos.length >= MAX_GRID_COMBOS) return combos
      }
    }
  }
  return combos
}
