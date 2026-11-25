import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ASSET_UNAVAILABLE_NOTICE,
  TRADE_NOTICE_TTL_MS,
  isAssetUnavailable,
  parseMessage,
  resolveTradeErrorNotice,
  scheduleNoticeClear,
} from './useLiveBot'

/** Payload real enviado pelo bot Python quando o ativo está suspenso. */
const SUSPENDED_PAYLOAD = {
  type: 'trade_error',
  message: 'Cannot purchase an option (active is suspended)',
}

const YELLOW_TEXT = 'Este ativo não está aceitando ordens no momento. O radar tentará outro ativo.'

describe('QA: aviso amarelo de ativo suspenso', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('faz o parse do trade_error de ativo suspenso sem descartar a mensagem', () => {
    const parsed = parseMessage(SUSPENDED_PAYLOAD)

    expect(parsed).toEqual({
      type: 'trade_error',
      reason: 'Cannot purchase an option (active is suspended)',
    })
  })

  describe('autenticação do bot externo', () => {
    it('reconhece uma autenticação de sessão aceita', () => {
      expect(parseMessage({ type: 'auth_result', authenticated: true })).toEqual({
        type: 'auth_result',
        authenticated: true,
      })
    })

    it('mantém o tipo de conta recebido junto ao saldo', () => {
      expect(
        parseMessage({
          type: 'account_balance',
          balance: 163647.86,
          currency: 'USD',
          account_type: 'PRACTICE',
        }),
      ).toEqual({
        type: 'account_balance',
        balance: 163647.86,
        currency: 'USD',
        account_type: 'PRACTICE',
      })
    })

    it('preserva o motivo de uma autenticação recusada', () => {
      expect(
        parseMessage({
          type: 'auth_result',
          authenticated: false,
          reason: 'Token de sessão inválido ou ausente.',
        }),
      ).toEqual({
        type: 'auth_result',
        authenticated: false,
        reason: 'Token de sessão inválido ou ausente.',
      })
    })
  })

  it('preserva o motivo do corretor quando a ordem é pulada', () => {
    const parsed = parseMessage({
      type: 'trade_result',
      asset: 'NZDUSD',
      direction: 'PUT',
      result: 'SKIPPED',
      pnl: 0,
      timestamp: '2026-11-16T04:44:10Z',
      reason: 'Cannot purchase an option (asset not available)',
    })

    expect(parsed).toMatchObject({
      type: 'trade_result',
      asset: 'NZDUSD',
      direction: 'PUT',
      result: 'SKIPPED',
      reason: 'Cannot purchase an option (asset not available)',
    })
  })

  it('reconhece "suspended" e "not available" sem diferenciar maiúsculas', () => {
    expect(isAssetUnavailable('Cannot purchase an option (active is suspended)')).toBe(true)
    expect(isAssetUnavailable('Asset is SUSPENDED')).toBe(true)
    expect(isAssetUnavailable('The asset is not available')).toBe(true)
    expect(isAssetUnavailable('Insufficient balance')).toBe(false)
  })

  it('traduz o ativo suspenso em aviso de negócio (amarelo), não em erro', () => {
    const notice = resolveTradeErrorNotice(SUSPENDED_PAYLOAD.message)

    expect(notice.kind).toBe('warning')
    expect(notice.text).toBe(YELLOW_TEXT)
    expect(notice.text).toBe(ASSET_UNAVAILABLE_NOTICE)
    expect(notice.text.startsWith('Falha')).toBe(false)
  })

  it('mantém o erro padrão para falhas que não são de ativo indisponível', () => {
    const notice = resolveTradeErrorNotice('Insufficient balance')

    expect(notice.kind).toBe('error')
    expect(notice.text).toBe('Falha ao enviar ordem: Insufficient balance')
    expect(notice.text).not.toBe(ASSET_UNAVAILABLE_NOTICE)
  })

  it('simula a injeção do evento WebSocket e o auto-clear em 5s', () => {
    // Espelha o estado do hook: mensagem -> banner -> timer de limpeza.
    let rendered: string | null = null
    const setRendered = (value: string | null) => {
      rendered = value
    }

    const parsed = parseMessage(SUSPENDED_PAYLOAD)
    if (parsed === null || parsed.type !== 'trade_error') {
      throw new Error('payload de trade_error não foi reconhecido')
    }

    const notice = resolveTradeErrorNotice(parsed.reason)
    if (notice.kind === 'warning') setRendered(notice.text)
    expect(rendered).toBe(YELLOW_TEXT)

    const cancel = scheduleNoticeClear(() => setRendered(null))

    vi.advanceTimersByTime(4_999)
    expect(rendered).toBe(YELLOW_TEXT)

    vi.advanceTimersByTime(1)
    expect(rendered).toBeNull()

    cancel()
  })

  it('usa 5000ms como tempo de vida do aviso', () => {
    expect(TRADE_NOTICE_TTL_MS).toBe(5_000)
  })
})
