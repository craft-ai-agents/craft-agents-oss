import { VISUAL_BOARD_TAG } from '@craft-agent/shared/visual-board'
import type { VisualSurface, VisualSurfaceKind } from '@craft-agent/shared/visual-surfaces'
import type { OutputManifestDTO, OutputSummaryDTO } from '@/hooks/useOutputs'

export interface VisualSurfaceAdapterCapabilities {
  canRefresh: boolean
  canOpenExternal: boolean
  canSendToCanvas: boolean
  canInspect: boolean
  agentControllable: boolean
}

export interface VisualSurfaceAdapterContext {
  workspaceId: string
  sessionId?: string
  surface: VisualSurface
  selectedOutputId?: string
  selectedManifest?: OutputManifestDTO | null
  sessionOutputs: OutputSummaryDTO[]
  boardOutput?: OutputSummaryDTO
  manifestError: string | null
  onOpenOutput: (output: OutputSummaryDTO) => void
}

export interface VisualSurfaceAdapterDescriptor {
  id: string
  label: string
  kinds: VisualSurfaceKind[]
  capabilities: VisualSurfaceAdapterCapabilities
  canRender: (context: VisualSurfaceAdapterContext) => boolean
}

export const visualSurfaceAdapterDescriptors: VisualSurfaceAdapterDescriptor[] = [
  {
    id: 'canvas-board',
    label: 'Canvas board',
    kinds: ['canvas'],
    capabilities: {
      canRefresh: true,
      canOpenExternal: false,
      canSendToCanvas: false,
      canInspect: false,
      agentControllable: true,
    },
    canRender: (context) =>
      context.surface.kind === 'canvas'
      && !!context.sessionId
      && (!context.selectedOutputId || context.selectedManifest?.tags?.includes(VISUAL_BOARD_TAG) === true),
  },
  {
    id: 'output-preview',
    label: 'Output preview',
    kinds: ['document', 'image', 'video', 'audio', 'output'],
    capabilities: {
      canRefresh: true,
      canOpenExternal: true,
      canSendToCanvas: true,
      canInspect: false,
      agentControllable: false,
    },
    canRender: (context) => !!context.selectedManifest,
  },
]

export const unsupportedVisualSurfaceAdapterDescriptor: VisualSurfaceAdapterDescriptor = {
  id: 'unsupported',
  label: 'Unsupported surface',
  kinds: ['browser', 'chart', 'workflow', 'output'],
  capabilities: {
    canRefresh: false,
    canOpenExternal: false,
    canSendToCanvas: false,
    canInspect: false,
    agentControllable: false,
  },
  canRender: () => true,
}

export function selectVisualSurfaceAdapter(context: VisualSurfaceAdapterContext): VisualSurfaceAdapterDescriptor {
  return visualSurfaceAdapterDescriptors.find((adapter) => adapter.canRender(context)) ?? unsupportedVisualSurfaceAdapterDescriptor
}
