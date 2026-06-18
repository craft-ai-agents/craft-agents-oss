import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import type { BrowserInstanceInfo } from '../../../shared/types'
import {
  browserInstancesAtom,
  filterInstancesForWorkspace,
  removeBrowserInstanceAtom,
  setBrowserInstancesAtom,
  updateBrowserInstanceAtom,
} from '../browser-pane'

function makeInstance(id: string, overrides?: Partial<BrowserInstanceInfo>): BrowserInstanceInfo {
  return {
    id,
    url: 'https://example.com',
    title: 'Example',
    favicon: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    boundSessionId: null,
    ownerType: 'manual',
    ownerSessionId: null,
    isVisible: true,
    agentControlActive: false,
    themeColor: null,
    workspaceId: null,
    ...overrides,
  }
}

describe('browser pane atoms', () => {
  it('does not resurrect removed instance from stale update event', () => {
    const store = createStore()

    store.set(updateBrowserInstanceAtom, makeInstance('browser-1'))
    expect(store.get(browserInstancesAtom).map((i) => i.id)).toEqual(['browser-1'])

    store.set(removeBrowserInstanceAtom, 'browser-1')
    expect(store.get(browserInstancesAtom)).toHaveLength(0)

    // Simulate late out-of-order state event arriving after removal
    store.set(updateBrowserInstanceAtom, makeInstance('browser-1'))

    expect(store.get(browserInstancesAtom)).toHaveLength(0)
  })

  it('authoritative list refresh can restore an instance after prior remove', () => {
    const store = createStore()

    store.set(removeBrowserInstanceAtom, 'browser-2')
    expect(store.get(browserInstancesAtom)).toHaveLength(0)

    // Simulate full list() reconciliation from main process
    store.set(setBrowserInstancesAtom, [makeInstance('browser-2')])

    expect(store.get(browserInstancesAtom).map((i) => i.id)).toEqual(['browser-2'])
  })

  describe('filterInstancesForWorkspace', () => {
    it('returns only the active workspace + unbound entries (single id)', () => {
      const all = [
        makeInstance('ws-a-bound', { workspaceId: 'ws-a' }),
        makeInstance('ws-b-bound', { workspaceId: 'ws-b' }),
        makeInstance('unbound', { workspaceId: null }),
      ]

      const visibleInWsA = filterInstancesForWorkspace(all, 'ws-a', null)
      expect(visibleInWsA.map((i) => i.id).sort()).toEqual(['unbound', 'ws-a-bound'])

      const visibleInWsB = filterInstancesForWorkspace(all, 'ws-b', null)
      expect(visibleInWsB.map((i) => i.id).sort()).toEqual(['unbound', 'ws-b-bound'])
    })

    it('matches against BOTH local and remote workspace ids (remote-mirror case)', () => {
      // Remote-connected workspaces stamp tabs with the remote workspace id
      // (e.g. agent on the server) while manual local tabs use the local id.
      // The renderer must accept either for the same logical workspace.
      const all = [
        makeInstance('local-tab', { workspaceId: 'local-ws-uuid' }),
        makeInstance('remote-tab', { workspaceId: 'remote-ws-uuid' }),
        makeInstance('other-ws', { workspaceId: 'unrelated-uuid' }),
      ]

      const visible = filterInstancesForWorkspace(all, 'local-ws-uuid', 'remote-ws-uuid')
      expect(visible.map((i) => i.id).sort()).toEqual(['local-tab', 'remote-tab'])
    })

    it('returns everything when both workspace ids are null (safe default)', () => {
      const all = [
        makeInstance('ws-a-bound', { workspaceId: 'ws-a' }),
        makeInstance('unbound', { workspaceId: null }),
      ]
      expect(filterInstancesForWorkspace(all, null, null).map((i) => i.id).sort()).toEqual([
        'unbound',
        'ws-a-bound',
      ])
    })

    it('treats undefined workspaceId on an instance as unbound (old-server compat)', () => {
      // Simulate an older main process that doesn't emit workspaceId yet.
      const legacyInstance: BrowserInstanceInfo = makeInstance('legacy')
      delete legacyInstance.workspaceId

      expect(filterInstancesForWorkspace([legacyInstance], 'ws-a', null).map((i) => i.id)).toEqual([
        'legacy',
      ])
    })

    it('works with only the remote id (local id null)', () => {
      const all = [
        makeInstance('remote-tab', { workspaceId: 'remote-ws' }),
        makeInstance('other', { workspaceId: 'other-ws' }),
      ]
      expect(filterInstancesForWorkspace(all, null, 'remote-ws').map((i) => i.id)).toEqual([
        'remote-tab',
      ])
    })
  })
})
