import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { resolveUiLocale, isUiLocale } from '../storage.ts'

describe('ui locale config behavior', () => {
  it('new install defaults are set to pt-BR in bundled config-defaults.json', () => {
    const defaultsPath = new URL('../../../../../apps/electron/resources/config-defaults.json', import.meta.url)
    const raw = readFileSync(defaultsPath, 'utf-8')
    const parsed = JSON.parse(raw) as { defaults?: { uiLocale?: string } }
    expect(parsed.defaults?.uiLocale).toBe('pt-BR')
  })

  it('existing configs without uiLocale resolve to en-US', () => {
    expect(resolveUiLocale({})).toBe('en-US')
    expect(resolveUiLocale(null)).toBe('en-US')
  })

  it('resolves explicitly configured locales', () => {
    expect(resolveUiLocale({ uiLocale: 'pt-BR' })).toBe('pt-BR')
    expect(resolveUiLocale({ uiLocale: 'en-US' })).toBe('en-US')
  })

  it('supports locale persistence shape (set then resolve)', () => {
    const config = { uiLocale: 'pt-BR' as const }
    expect(resolveUiLocale(config)).toBe('pt-BR')
    const updated = { ...config, uiLocale: 'en-US' as const }
    expect(resolveUiLocale(updated)).toBe('en-US')
  })

  it('validates supported locale values', () => {
    expect(isUiLocale('pt-BR')).toBe(true)
    expect(isUiLocale('en-US')).toBe(true)
    expect(isUiLocale('pt')).toBe(false)
    expect(isUiLocale('es-ES')).toBe(false)
  })
})

