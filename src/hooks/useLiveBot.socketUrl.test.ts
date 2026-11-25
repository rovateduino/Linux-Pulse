import { describe, expect, it } from 'vitest'
import { resolveSocketUrl } from './useLiveBot'

describe('resolveSocketUrl', () => {
  it('usa VITE_WS_URL quando definido', () => {
    expect(resolveSocketUrl('127.0.0.1', 'wss://bot.example.com/ws')).toBe('wss://bot.example.com/ws')
  })

  it('ignora VITE_WS_URL vazio ou só espaços', () => {
    expect(resolveSocketUrl('127.0.0.1', '')).toBe('ws://127.0.0.1:8000/ws')
    expect(resolveSocketUrl('127.0.0.1', '   ')).toBe('ws://127.0.0.1:8000/ws')
  })

  it('deriva do hostname quando não há env', () => {
    expect(resolveSocketUrl('192.168.1.10', undefined)).toBe('ws://192.168.1.10:8000/ws')
  })

  it('cai para localhost quando hostname é vazio', () => {
    expect(resolveSocketUrl('', undefined)).toBe('ws://localhost:8000/ws')
  })
})
