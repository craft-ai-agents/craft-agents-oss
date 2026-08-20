import { describe, it, expect } from 'bun:test'
import {
  createSurfaceRegistry,
  surfaceTabDurableKey,
  surfaceTabToDescriptor,
} from '../surfaces/index.ts'
import type {
  KnowledgeRef,
  SurfaceContribution,
  SurfaceLayoutSnapshot,
  SurfaceTab,
} from '../surfaces/index.ts'

const docRef: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-1' }
const dbRef: KnowledgeRef = { scheme: 'siyuan', kind: 'database', id: 'db-1' }

function contribution(
  kind: SurfaceTab['kind'],
  match: (navState: { type?: string }) => SurfaceTab | null,
): SurfaceContribution<{ type?: string }> {
  return {
    kind,
    match,
    buildRoute: () => 'toy',
    title: () => kind,
    icon: () => kind,
    policy: { singletonPer: surfaceTabDurableKey },
    render: () => null,
    hostKind: 'dom',
  }
}

describe('surfaceTabToDescriptor (S-02 §3.2 downgrade rules)', () => {
  it('maps all seven tab kinds', () => {
    expect(surfaceTabToDescriptor({ kind: 'session', sessionId: 's1' })).toEqual({
      kind: 'chat',
      sessionId: 's1',
    })
    expect(surfaceTabToDescriptor({ kind: 'knowledge', ref: docRef })).toEqual({
      kind: 'knowledge',
      ref: docRef,
    })
    expect(surfaceTabToDescriptor({ kind: 'browser', tabId: 't1' })).toEqual({
      kind: 'browser',
      tabId: 't1',
    })
    expect(surfaceTabToDescriptor({ kind: 'cloud-run', runId: 'r1' })).toEqual({
      kind: 'cloud-run',
      runId: 'r1',
    })
    expect(surfaceTabToDescriptor({ kind: 'diff', proposalId: 'p1' })).toEqual({
      kind: 'diff',
      proposalId: 'p1',
    })
  })

  it('downgrades database tabs to knowledge descriptors with ref.kind database', () => {
    expect(surfaceTabToDescriptor({ kind: 'database', ref: dbRef })).toEqual({
      kind: 'knowledge',
      ref: { scheme: 'siyuan', kind: 'database', id: 'db-1' },
    })
  })

  it('extension tabs are not host descriptors (sandbox bridge, S-02 §3.2)', () => {
    expect(surfaceTabToDescriptor({ kind: 'extension', extensionId: 'ext', viewId: 'view' })).toBeNull()
  })
})

describe('surfaceTabDurableKey (S-02 §3.7 durable refs)', () => {
  it('is stable per durable ref and distinct across refs', () => {
    expect(surfaceTabDurableKey({ kind: 'session', sessionId: 's1' })).toBe('session:s1')
    expect(surfaceTabDurableKey({ kind: 'session', sessionId: 's1' })).toBe(
      surfaceTabDurableKey({ kind: 'session', sessionId: 's1' }),
    )
    expect(surfaceTabDurableKey({ kind: 'session', sessionId: 's1' })).not.toBe(
      surfaceTabDurableKey({ kind: 'session', sessionId: 's2' }),
    )
  })

  it('distinguishes kinds that share an id shape', () => {
    const keys = new Set([
      surfaceTabDurableKey({ kind: 'session', sessionId: 'id' }),
      surfaceTabDurableKey({ kind: 'browser', tabId: 'id' }),
      surfaceTabDurableKey({ kind: 'knowledge', ref: { scheme: 'siyuan', kind: 'document', id: 'id' } }),
      surfaceTabDurableKey({ kind: 'database', ref: { scheme: 'siyuan', kind: 'database', id: 'id' } }),
      surfaceTabDurableKey({ kind: 'cloud-run', runId: 'id' }),
      surfaceTabDurableKey({ kind: 'extension', extensionId: 'id', viewId: 'view' }),
      surfaceTabDurableKey({ kind: 'diff', proposalId: 'id' }),
    ])
    expect(keys.size).toBe(7)
  })
})

describe('SurfaceRegistry', () => {
  it('registers, gets, lists, and unregisters contributions', () => {
    const registry = createSurfaceRegistry<{ type?: string }>()
    const knowledge = contribution('knowledge', () => null)

    registry.register(knowledge)

    expect(registry.get('knowledge')).toBe(knowledge)
    expect(registry.list()).toEqual([knowledge])

    registry.unregister('knowledge')
    expect(registry.get('knowledge')).toBeUndefined()
    expect(registry.list()).toEqual([])
  })

  it('throws on duplicate kind', () => {
    const registry = createSurfaceRegistry<{ type?: string }>()
    registry.register(contribution('knowledge', () => null))

    expect(() => registry.register(contribution('knowledge', () => null))).toThrow()
  })

  it('resolves the first matching contribution; null is the legacy fallback (S-02 §3.3)', () => {
    const registry = createSurfaceRegistry<{ type?: string }>()
    const knowledgeTab: SurfaceTab = { kind: 'knowledge', ref: docRef }
    registry.register(contribution('browser', (nav) => (nav.type === 'browser' ? { kind: 'browser', tabId: 't' } : null)))
    registry.register(contribution('knowledge', (nav) => (nav.type === 'knowledge' ? knowledgeTab : null)))

    const resolved = registry.resolve({ type: 'knowledge' })

    expect(resolved?.kind).toBe('knowledge')
    expect(resolved?.match({ type: 'knowledge' })).toBe(knowledgeTab)
    expect(registry.resolve({ type: 'browser' })?.kind).toBe('browser')
    expect(registry.resolve({ type: 'settings' })).toBeNull()
  })

  it('dispose of a registration removes it from resolution', () => {
    const registry = createSurfaceRegistry<{ type?: string }>()
    const registration = registry.register(
      contribution('knowledge', (nav) => (nav.type === 'knowledge' ? { kind: 'knowledge', ref: docRef } : null)),
    )

    registration.dispose()

    expect(registry.resolve({ type: 'knowledge' })).toBeNull()
  })

  it('onDidChange fires on register and unregister', () => {
    const registry = createSurfaceRegistry<{ type?: string }>()
    let calls = 0
    registry.onDidChange(() => {
      calls++
    })

    registry.register(contribution('diff', () => null))
    registry.unregister('diff')
    registry.unregister('diff') // unknown kind: no event

    expect(calls).toBe(2)
  })
})

describe('SurfaceLayoutSnapshot (S-02 §3.10)', () => {
  it('serializes durable refs only and survives a JSON round-trip', () => {
    const snapshot: SurfaceLayoutSnapshot = {
      version: 1,
      workspaceId: 'ws-1',
      lanes: [{ laneId: 'main', locked: false }],
      tabs: [
        { panelId: 'panel-1', laneId: 'main', tab: { kind: 'session', sessionId: 's1' }, proportion: 0.5 },
        { panelId: 'panel-2', laneId: 'main', tab: { kind: 'knowledge', ref: docRef }, proportion: 0.5 },
      ],
      focusedIndex: 1,
      savedAt: 1754500000000,
    }

    const restored = JSON.parse(JSON.stringify(snapshot)) as SurfaceLayoutSnapshot

    expect(restored).toEqual(snapshot)
    expect(JSON.stringify(snapshot)).not.toContain('instance')
    expect(restored.tabs.map((t) => surfaceTabDurableKey(t.tab))).toEqual([
      'session:s1',
      'knowledge:siyuan/document/doc-1',
    ])
  })
})
