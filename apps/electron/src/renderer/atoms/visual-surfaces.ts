import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { getKeyString, KEYS } from '@/lib/local-storage'
import type { OutputKind } from '@craft-agent/shared/outputs'
import type { VisualSurface, VisualSurfaceKind } from '@craft-agent/shared/visual-surfaces'

export type VisualSurfacePresentationMode = 'auto' | 'sidecar' | 'rollup'
export type ResolvedVisualSurfacePresentation = 'sidecar' | 'rollup' | null

export interface VisualSidecarState {
  activeSurface: VisualSurface | null
  isCollapsed: boolean
  focusedAt: number | null
  resolvedPresentation: ResolvedVisualSurfacePresentation
  rememberedSurfacesBySession: Record<string, VisualSurface>
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
    source: 'demo',
    createdAt: now,
    updatedAt: now,
  }
}

function outputKindToVisualKind(kind: OutputKind): VisualSurfaceKind {
  if (kind === 'image' || kind === 'video' || kind === 'audio') return kind
  if (kind === 'document' || kind === 'report' || kind === 'code' || kind === 'dataset') return 'document'
  return 'output'
}

function createOutputSurface({
  workspaceId,
  sessionId,
  outputId,
  title,
  kind,
  status = 'active',
  createdAt,
  updatedAt,
}: {
  workspaceId: string
  sessionId: string
  outputId: string
  title: string
  kind: OutputKind
  status?: VisualSurface['status']
  createdAt: string
  updatedAt?: string
}): VisualSurface {
  return {
    id: outputId,
    workspaceId,
    sessionId,
    kind: outputKindToVisualKind(kind),
    title,
    status,
    source: 'output',
    outputId,
    createdAt,
    updatedAt: updatedAt ?? createdAt,
  }
}

export const visualSidecarAtom = atom<VisualSidecarState>({
  activeSurface: null,
  isCollapsed: false,
  focusedAt: null,
  resolvedPresentation: null,
  rememberedSurfacesBySession: {},
})

export const visualSurfacePresentationModeAtom = atomWithStorage<VisualSurfacePresentationMode>(
  getKeyString(KEYS.visualSurfacePresentationMode),
  'auto',
)

export const activeVisualSurfaceAtom = atom((get) => get(visualSidecarAtom).activeSurface)

export const openDemoVisualSurfaceAtom = atom(
  null,
  (get, set, input: { workspaceId: string; sessionId: string; kind?: VisualSurfaceKind }) => {
    const current = get(visualSidecarAtom)
    const surface = createDemoSurface(input)
    set(visualSidecarAtom, {
      ...current,
      activeSurface: surface,
      isCollapsed: false,
      focusedAt: Date.now(),
      resolvedPresentation: null,
      rememberedSurfacesBySession: rememberSurface(current.rememberedSurfacesBySession, surface),
    })
  },
)

export const openOutputVisualSurfaceAtom = atom(
  null,
  (get, set, input: {
    workspaceId: string
    sessionId: string
    outputId: string
    title: string
    kind: OutputKind
    createdAt: string
    updatedAt?: string
  }) => {
    const current = get(visualSidecarAtom)
    const surface = createOutputSurface(input)
    set(visualSidecarAtom, {
      ...current,
      activeSurface: surface,
      isCollapsed: false,
      focusedAt: Date.now(),
      resolvedPresentation: null,
      rememberedSurfacesBySession: rememberSurface(current.rememberedSurfacesBySession, surface),
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
  (get, set) => {
    const current = get(visualSidecarAtom)
    set(visualSidecarAtom, {
      ...current,
      activeSurface: null,
      isCollapsed: false,
      focusedAt: null,
      resolvedPresentation: null,
      rememberedSurfacesBySession: current.activeSurface
        ? rememberSurface(current.rememberedSurfacesBySession, current.activeSurface)
        : current.rememberedSurfacesBySession,
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

export const toggleVisualSurfaceAtom = atom(
  null,
  (get, set, input: {
    workspaceId: string
    sessionId: string
    fallbackKind?: VisualSurfaceKind
    output?: {
      id: string
      title: string
      kind: OutputKind
      createdAt: string
      updatedAt?: string
    }
  }) => {
    const current = get(visualSidecarAtom)
    if (current.activeSurface?.sessionId === input.sessionId) {
      set(closeVisualSidecarAtom)
      return
    }

    const remembered = current.rememberedSurfacesBySession[input.sessionId]
    if (remembered?.workspaceId === input.workspaceId && (remembered.source === 'output' || !input.output)) {
      set(visualSidecarAtom, {
        ...current,
        activeSurface: remembered,
        isCollapsed: false,
        focusedAt: Date.now(),
        resolvedPresentation: null,
      })
      return
    }

    if (input.output) {
      set(openOutputVisualSurfaceAtom, {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        outputId: input.output.id,
        title: input.output.title,
        kind: input.output.kind,
        createdAt: input.output.createdAt,
        updatedAt: input.output.updatedAt,
      })
      return
    }

    set(openDemoVisualSurfaceAtom, {
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      kind: input.fallbackKind,
    })
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

function rememberSurface(
  rememberedSurfacesBySession: Record<string, VisualSurface>,
  surface: VisualSurface,
): Record<string, VisualSurface> {
  if (!surface.sessionId) return rememberedSurfacesBySession
  return {
    ...rememberedSurfacesBySession,
    [surface.sessionId]: surface,
  }
}
