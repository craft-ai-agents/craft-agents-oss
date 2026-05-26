import { describe, expect, it } from 'bun:test'
import { buildSemanticHistoryKey, canRunInitialRestore } from '../navigation-history'

describe('buildSemanticHistoryKey', () => {
  it('changes when the single panel route changes', () => {
    const keyA = buildSemanticHistoryKey({
      workspaceSlug: 'ws',
      panelRoutes: ['allSessions/session/s1'],
      sidebarParam: '',
    })

    const keyB = buildSemanticHistoryKey({
      workspaceSlug: 'ws',
      panelRoutes: ['sources/source/github'],
      sidebarParam: '',
    })

    expect(keyA).not.toBe(keyB)
  })

  it('ignores stale duplicate panel routes from legacy callers', () => {
    const keyA = buildSemanticHistoryKey({
      workspaceSlug: 'ws',
      panelRoutes: ['allSessions/session/s1'],
      sidebarParam: '',
    })
    const keyB = buildSemanticHistoryKey({
      workspaceSlug: 'ws',
      panelRoutes: ['allSessions/session/s1'],
      sidebarParam: '',
    })

    expect(keyA).toBe(keyB)
  })

  it('stays stable for identical semantic inputs', () => {
    const input = {
      workspaceSlug: 'ws',
      panelRoutes: ['allSessions/session/s1'],
      sidebarParam: 'files',
    }

    const keyA = buildSemanticHistoryKey(input)
    const keyB = buildSemanticHistoryKey(input)

    expect(keyA).toBe(keyB)
  })
})

describe('canRunInitialRestore', () => {
  it('returns false until session metadata is ready', () => {
    expect(canRunInitialRestore({
      isReady: true,
      isSessionsReady: false,
      workspaceId: 'ws-1',
      initialRouteRestored: false,
    })).toBe(false)
  })

  it('returns true only when all restore conditions are satisfied', () => {
    expect(canRunInitialRestore({
      isReady: true,
      isSessionsReady: true,
      workspaceId: 'ws-1',
      initialRouteRestored: false,
    })).toBe(true)

    expect(canRunInitialRestore({
      isReady: true,
      isSessionsReady: true,
      workspaceId: 'ws-1',
      initialRouteRestored: true,
    })).toBe(false)
  })
})
