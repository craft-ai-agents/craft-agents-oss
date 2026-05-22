import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import {
  activeVisualSurfaceAtom,
  closeVisualSidecarAtom,
  collapseVisualSidecarAtom,
  focusVisualSidecarAtom,
  openDemoVisualSurfaceAtom,
  resolveVisualSurfacePresentationAtom,
  toggleDemoVisualSurfaceAtom,
  visualSurfacePresentationModeAtom,
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

  it('toggles the active session visual surface from the toolbar control', () => {
    const store = createStore()

    store.set(toggleDemoVisualSurfaceAtom, {
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
    })
    expect(store.get(activeVisualSurfaceAtom)?.sessionId).toBe('session-1')

    store.set(toggleDemoVisualSurfaceAtom, {
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
    })
    expect(store.get(activeVisualSurfaceAtom)).toBeNull()
  })

  it('stores user display mode and tracks resolved presentation separately', () => {
    const store = createStore()

    expect(store.get(visualSurfacePresentationModeAtom)).toBe('auto')
    store.set(visualSurfacePresentationModeAtom, 'rollup')
    expect(store.get(visualSurfacePresentationModeAtom)).toBe('rollup')

    store.set(openDemoVisualSurfaceAtom, {
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
    })
    store.set(resolveVisualSurfacePresentationAtom, 'rollup')
    expect(store.get(visualSidecarAtom).resolvedPresentation).toBe('rollup')

    store.set(closeVisualSidecarAtom)
    expect(store.get(visualSidecarAtom).resolvedPresentation).toBeNull()
  })
})
