import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { getKeyString, KEYS } from '@/lib/local-storage'
import type { VisualSurface, VisualSurfaceKind } from '@craft-agent/shared/visual-surfaces'

export type VisualSurfacePresentationMode = 'auto' | 'sidecar' | 'rollup'
export type ResolvedVisualSurfacePresentation = 'sidecar' | 'rollup' | null

export interface VisualSidecarState {
  activeSurface: VisualSurface | null
  isCollapsed: boolean
  focusedAt: number | null
  resolvedPresentation: ResolvedVisualSurfacePresentation
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
  resolvedPresentation: null,
})

export const visualSurfacePresentationModeAtom = atomWithStorage<VisualSurfacePresentationMode>(
  getKeyString(KEYS.visualSurfacePresentationMode),
  'auto',
)

export const activeVisualSurfaceAtom = atom((get) => get(visualSidecarAtom).activeSurface)

export const openDemoVisualSurfaceAtom = atom(
  null,
  (_get, set, input: { workspaceId: string; sessionId: string; kind?: VisualSurfaceKind }) => {
    set(visualSidecarAtom, {
      activeSurface: createDemoSurface(input),
      isCollapsed: false,
      focusedAt: Date.now(),
      resolvedPresentation: null,
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
      resolvedPresentation: null,
    })
  },
)

export const toggleDemoVisualSurfaceAtom = atom(
  null,
  (get, set, input: { workspaceId: string; sessionId: string; kind?: VisualSurfaceKind }) => {
    const current = get(visualSidecarAtom)
    if (current.activeSurface?.sessionId === input.sessionId) {
      set(closeVisualSidecarAtom)
      return
    }

    set(openDemoVisualSurfaceAtom, input)
  },
)

export const resolveVisualSurfacePresentationAtom = atom(
  null,
  (get, set, resolvedPresentation: ResolvedVisualSurfacePresentation) => {
    const current = get(visualSidecarAtom)
    if (current.resolvedPresentation === resolvedPresentation) return
    set(visualSidecarAtom, { ...current, resolvedPresentation })
  },
)
