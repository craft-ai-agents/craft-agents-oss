/**
 * Legacy settings subpage redirects:
 * - 'toolchain' → 'runtime' (PRD runtime-context-marketplace §5.1)
 * - 'preferences' → 'context' (P2.1 Context ↔ Preferences merge)
 */
import { describe, it, expect } from 'bun:test'
import { routes } from '../routes'
import { parseCompoundRoute, parseRouteToNavigationState } from '../route-parser'

describe('legacy settings redirects', () => {
  it('redirects toolchain → runtime', () => {
    expect(parseCompoundRoute('settings/toolchain')!.details).toEqual({ type: 'runtime', id: 'runtime' })
  })

  it('redirects preferences → context', () => {
    expect(parseCompoundRoute('settings/preferences')!.details).toEqual({
      type: 'context',
      id: 'context',
    })
  })

  it('keeps Marketplace and Extensions as independent settings routes', () => {
    const marketplaceRoute = routes.view.settings('marketplace')
    const extensionsRoute = routes.view.settings('extensions')

    expect(marketplaceRoute).toBe('settings/marketplace')
    expect(extensionsRoute).toBe('settings/extensions')
    expect(parseCompoundRoute(marketplaceRoute)!.details).toEqual({
      type: 'marketplace',
      id: 'marketplace',
    })
    expect(parseCompoundRoute(extensionsRoute)!.details).toEqual({
      type: 'extensions',
      id: 'extensions',
    })
    expect(parseRouteToNavigationState(marketplaceRoute)).toEqual({
      navigator: 'settings',
      subpage: 'marketplace',
    })
    expect(parseRouteToNavigationState(extensionsRoute)).toEqual({
      navigator: 'settings',
      subpage: 'extensions',
    })
  })

  it('rejects unknown pages', () => {
    expect(parseCompoundRoute('settings/does-not-exist')).toBeNull()
  })
})
