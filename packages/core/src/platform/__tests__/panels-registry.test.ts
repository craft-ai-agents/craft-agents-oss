import { describe, it, expect } from 'bun:test'
import { createPanelRegistry } from '../panels/index.ts'
import type { LayoutProfile, PanelContribution, PanelRegistryState, PanelSlot } from '../panels/index.ts'

function panel(id: string, slot: PanelSlot, defaultOrder?: number, when?: string): PanelContribution {
  return {
    id,
    title: id,
    icon: 'icon',
    slot,
    defaultOrder,
    when,
    defaultVisible: true,
    resizable: true,
    source: { type: 'core', id: 'test' },
    render: null,
  }
}

describe('PanelRegistry', () => {
  it('registers contributions and returns them by id', () => {
    const registry = createPanelRegistry()
    const contribution = panel('rail.sessions', 'activity', 10)

    registry.register(contribution)

    expect(registry.get('rail.sessions')).toBe(contribution)
  })

  it('throws on duplicate id; the first registration wins (S-03 §3.4)', () => {
    const registry = createPanelRegistry()
    const first = panel('insp.backlinks', 'inspector', 40)
    registry.register(first)

    expect(() => registry.register(panel('insp.backlinks', 'inspector', 50))).toThrow()
    expect(registry.get('insp.backlinks')).toBe(first)
  })

  it('lists only contributions of the requested slot', () => {
    const registry = createPanelRegistry()
    registry.register(panel('rail.sessions', 'activity', 10))
    registry.register(panel('rail.knowledge', 'activity', 20))
    registry.register(panel('insp.info', 'inspector', 20))

    const activity = registry.list('activity', {})

    expect(activity.map((p) => p.id)).toEqual(['rail.sessions', 'rail.knowledge'])
  })

  it('orders by defaultOrder; ties break by id; unordered contributions sort last', () => {
    const registry = createPanelRegistry()
    registry.register(panel('rail.settings', 'activity', 70))
    registry.register(panel('rail.sessions', 'activity', 10))
    registry.register(panel('rail.browser', 'activity', 30))
    registry.register(panel('rail.y-unordered', 'activity'))
    registry.register(panel('rail.a-unordered', 'activity'))
    registry.register(panel('rail.knowledge', 'activity', 10))

    const activity = registry.list('activity', {})

    expect(activity.map((p) => p.id)).toEqual([
      'rail.knowledge',
      'rail.sessions',
      'rail.browser',
      'rail.settings',
      'rail.a-unordered',
      'rail.y-unordered',
    ])
  })

  it('contributions without when are always listed; when expressions filter by context (S-03 §3.9)', () => {
    const registry = createPanelRegistry()
    registry.register(panel('insp.info', 'inspector', 20))
    registry.register(panel('insp.backlinks', 'inspector', 40, "activeSurface=='knowledge'"))
    registry.register(panel('insp.outline', 'inspector', 30, "activeSurface=='knowledge' || activeSurface=='session'"))

    expect(registry.list('inspector', { activeSurface: 'knowledge' }).map((p) => p.id)).toEqual([
      'insp.info',
      'insp.outline',
      'insp.backlinks',
    ])
    expect(registry.list('inspector', { activeSurface: 'session' }).map((p) => p.id)).toEqual([
      'insp.info',
      'insp.outline',
    ])
    expect(registry.list('inspector', { activeSurface: 'browser' }).map((p) => p.id)).toEqual(['insp.info'])
  })

  it('disposing a registration removes the contribution and stays idempotent', () => {
    const registry = createPanelRegistry()
    const disposable = registry.register(panel('insp.backlinks', 'inspector', 40))

    disposable.dispose()

    expect(registry.get('insp.backlinks')).toBeUndefined()
    expect(registry.list('inspector', {})).toEqual([])
    disposable.dispose() // second dispose must not throw
  })

  it('onDidChange fires on register, dispose, and stops after unsubscribe', () => {
    const registry = createPanelRegistry()
    let calls = 0
    const sub = registry.onDidChange(() => {
      calls++
    })

    const registration = registry.register(panel('insp.info', 'inspector', 20))
    registration.dispose()
    expect(calls).toBe(2)

    sub.dispose()
    registry.register(panel('insp.outline', 'inspector', 30))
    expect(calls).toBe(2)
  })
})

describe('layout profiles (S-03 §3.7)', () => {
  it('LayoutProfile and PanelRegistryState round-trip through JSON', () => {
    const profile: LayoutProfile = {
      id: 'my-review',
      title: 'Мой review',
      activityItem: 'rail.knowledge',
      slots: {
        'navigator-primary': { visible: true, width: 240, active: 'knowledge.navigator' },
        inspector: { visible: true, width: 380, active: 'insp.agent' },
        bottom: { visible: false },
      },
      createdAt: 1754500000000,
      updatedAt: 1754500000000,
    }
    const state: PanelRegistryState = {
      version: 1,
      activeProfile: 'research',
      rails: {
        activity: { collapsed: false },
        inspector: { open: true, activeInspector: 'insp.agent', width: 360 },
      },
      overrides: {
        'knowledge.navigator': { order: 20, pinned: true, hidden: false, width: 260 },
        'rail.runs': { hidden: true },
      },
      customProfiles: { 'my-review': profile },
    }

    const restored = JSON.parse(JSON.stringify(state)) as PanelRegistryState

    expect(restored).toEqual(state)
    expect(restored.customProfiles['my-review']?.slots.inspector?.active).toBe('insp.agent')
  })
})
