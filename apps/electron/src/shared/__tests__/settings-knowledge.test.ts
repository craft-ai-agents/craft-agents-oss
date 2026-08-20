/**
 * Knowledge settings page: registry wiring + routing for the P1 read-only
 * knowledge provider (spec K-11 P1 — settings page contract: one registry
 * entry + component by the registry recipe).
 */
import { describe, it, expect } from 'bun:test'
import { SETTINGS_PAGES, isValidSettingsSubpage, getSettingsPage } from '../settings-registry'
import { parseCompoundRoute, buildCompoundRoute } from '../route-parser'

describe('settings knowledge page', () => {
  it('registers exactly one knowledge entry with i18n label keys', () => {
    const entries = SETTINGS_PAGES.filter((p) => p.id === 'knowledge')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.labelKey).toBe('settings.knowledge.title')
    expect(entries[0]!.descriptionKey).toBe('settings.knowledge.description')
  })

  it('is a valid settings subpage resolvable via getSettingsPage', () => {
    expect(isValidSettingsSubpage('knowledge')).toBe(true)
    expect(getSettingsPage('knowledge').id).toBe('knowledge')
  })

  it('round-trips settings/knowledge through the compound route parser', () => {
    const parsed = parseCompoundRoute('settings/knowledge')
    expect(parsed).toEqual({ navigator: 'settings', details: { type: 'knowledge', id: 'knowledge' } })
    expect(buildCompoundRoute(parsed!)).toBe('settings/knowledge')
  })

  it('still rejects unknown settings subpages', () => {
    expect(parseCompoundRoute('settings/knowledge-mutations')).toBeNull()
    expect(parseCompoundRoute('settings/does-not-exist')).toBeNull()
    expect(isValidSettingsSubpage('proposeMutation')).toBe(false)
  })
})
