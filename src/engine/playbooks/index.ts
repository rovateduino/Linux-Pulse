import type { SignalPlaybook } from '../../types/market'
import { evaluateC } from './playbookC'
import { evaluateD } from './playbookD'
import type { PlaybookEvaluator, RegistryPlaybookId } from './types'

/**
 * Registry principal: apenas os playbooks ativos (C/D).
 * Os legados A/B ficam em `./legacy` e não são exportados aqui.
 */
export const PLAYBOOKS: Record<RegistryPlaybookId, PlaybookEvaluator> = {
  C: evaluateC,
  D: evaluateD,
}

export const PLAYBOOK_IDS: readonly RegistryPlaybookId[] = ['C', 'D']
export const LEGACY_PLAYBOOK_IDS: readonly SignalPlaybook[] = ['A', 'B']

export function isRegistryPlaybook(playbook: SignalPlaybook): playbook is RegistryPlaybookId {
  return playbook === 'C' || playbook === 'D'
}

export function isPlaybookId(value: string): value is SignalPlaybook {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D'
}

export function playbookLabel(playbook: SignalPlaybook): string {
  switch (playbook) {
    case 'C':
      return 'Playbook C · momentum de sessão (breakout)'
    case 'D':
      return 'Playbook D · reversão em extremos (fade)'
    case 'A':
      return 'Playbook A · legado · pullback em tendência'
    case 'B':
      return 'Playbook B · legado · reversão em lateral'
  }
}
