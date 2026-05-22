import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import {
  activeVisualSurfaceAtom,
  closeVisualSidecarAtom,
  collapseVisualSidecarAtom,
  focusVisualSidecarAtom,
  openDemoVisualSurfaceAtom,
  visualSidecarAtom,
} from '../visual-surfaces'

describe('visual sidecar atoms', () => {
  it('opens a session-scoped visual surface and can focus, collapse, and close it', () => {
    const store = createStore()

    store.set(openDemoVisualSurfaceAtom, {
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
    })

    const opened = store.get(activeVisualSurfaceAtom)
    expect(opened?.workspaceId).toBe('workspace-1')
    expect(opened?.sessionId).toBe('session-1')
    expect(opened?.kind).toBe('canvas')
    expect(store.get(visualSidecarAtom).isCollapsed).toBe(false)
    expect(store.get(visualSidecarAtom).focusedAt).toBeNumber()

    store.set(collapseVisualSidecarAtom)
    expect(store.get(visualSidecarAtom).isCollapsed).toBe(true)

    store.set(focusVisualSidecarAtom)
    expect(store.get(visualSidecarAtom).isCollapsed).toBe(false)
    expect(store.get(visualSidecarAtom).activeSurface?.id).toBe(opened?.id)

    store.set(closeVisualSidecarAtom)
    expect(store.get(activeVisualSurfaceAtom)).toBeNull()
  })
})
