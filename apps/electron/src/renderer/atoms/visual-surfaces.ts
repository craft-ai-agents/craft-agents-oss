import { atom } from 'jotai'
import type { VisualSurface, VisualSurfaceKind } from '@craft-agent/shared/visual-surfaces'

export interface VisualSidecarState {
  activeSurface: VisualSurface | null
  isCollapsed: boolean
  focusedAt: number | null
}

const nowIso = () => new Date().toISOString()

function createDemoSurface({
  workspaceId,
  sessionId,
  kind = 'canvas',
}: {
  workspaceId: string
  sessionId: string
  kind?: VisualSurfaceKind
}): VisualSurface {
  const now = nowIso()
  return {
    id: `visual-${sessionId}-${Date.now()}`,
    workspaceId,
    sessionId,
    kind,
    title: 'Visual Workbench',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
}

export const visualSidecarAtom = atom<VisualSidecarState>({
  activeSurface: null,
  isCollapsed: false,
  focusedAt: null,
})

export const activeVisualSurfaceAtom = atom((get) => get(visualSidecarAtom).activeSurface)

export const openDemoVisualSurfaceAtom = atom(
  null,
  (_get, set, input: { workspaceId: string; sessionId: string; kind?: VisualSurfaceKind }) => {
    set(visualSidecarAtom, {
      activeSurface: createDemoSurface(input),
      isCollapsed: false,
      focusedAt: Date.now(),
    })
  },
)
export const focusVisualSidecarAtom = atom(
  null,
  (get, set) => {
    const current = get(visualSidecarAtom)
    if (!current.activeSurface) return
    set(visualSidecarAtom, {
      ...current,
      isCollapsed: false,
      focusedAt: Date.now(),
    })
  },
)

export const collapseVisualSidecarAtom = atom(
  null,
  (get, set) => {
    const current = get(visualSidecarAtom)
    if (!current.activeSurface) return
    set(visualSidecarAtom, { ...current, isCollapsed: true })
  },
)

export const closeVisualSidecarAtom = atom(
  null,
  (_get, set) => {
    set(visualSidecarAtom, {
      activeSurface: null,
      isCollapsed: false,
      focusedAt: null,
    })
  },
)
