import { describe, expect, it } from 'bun:test'
import { buildCompoundRoute, parseCompoundRoute } from '../route-parser'

describe('route-parser: settings routes', () => {
  it('parses "settings/plugins" as the plugins settings page', () => {
    process.env.CRAFT_FEATURE_PLUGIN_HOST = '1'
    const result = parseCompoundRoute('settings/plugins')
    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('settings')
    expect(result!.details).toEqual({ type: 'plugins', id: 'plugins' })
    delete process.env.CRAFT_FEATURE_PLUGIN_HOST
  })

  it('parses "settings/routing" as the routing settings page', () => {
    process.env.CRAFT_FEATURE_PLUGIN_ROUTING_UI = '1'
    const result = parseCompoundRoute('settings/routing')
    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('settings')
    expect(result!.details).toEqual({ type: 'routing', id: 'routing' })
    delete process.env.CRAFT_FEATURE_PLUGIN_ROUTING_UI
  })

  it('rejects unknown settings pages', () => {
    expect(parseCompoundRoute('settings/not-a-real-page')).toBeNull()
  })

  it('rejects feature-gated settings pages when their flags are off', () => {
    delete process.env.CRAFT_FEATURE_PLUGIN_HOST
    delete process.env.CRAFT_FEATURE_PLUGIN_ROUTING_UI
    expect(parseCompoundRoute('settings/plugins')).toBeNull()
    expect(parseCompoundRoute('settings/routing')).toBeNull()
  })

  it('roundtrips "settings/plugins"', () => {
    process.env.CRAFT_FEATURE_PLUGIN_HOST = '1'
    const parsed = parseCompoundRoute('settings/plugins')!
    expect(buildCompoundRoute(parsed)).toBe('settings/plugins')
    delete process.env.CRAFT_FEATURE_PLUGIN_HOST
  })

  it('roundtrips "settings/routing"', () => {
    process.env.CRAFT_FEATURE_PLUGIN_ROUTING_UI = '1'
    const parsed = parseCompoundRoute('settings/routing')!
    expect(buildCompoundRoute(parsed)).toBe('settings/routing')
    delete process.env.CRAFT_FEATURE_PLUGIN_ROUTING_UI
  })
})
