export type VisualSurfaceKind =
  | 'canvas'
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'chart'
  | 'browser'
  | 'workflow'
  | 'output'

export type VisualSurfaceStatus = 'active' | 'archived' | 'failed'

export interface VisualSurface {
  id: string
  workspaceId: string
  sessionId?: string
  kind: VisualSurfaceKind
  title: string
  status: VisualSurfaceStatus
  source?: 'demo' | 'output'
  outputId?: string
  createdAt: string
  updatedAt: string
}
