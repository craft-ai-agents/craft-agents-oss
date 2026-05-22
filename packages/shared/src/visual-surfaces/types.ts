export type VisualSurfaceKind =
  | 'canvas'
  | 'image'
  | 'video'
  | 'chart'
  | 'browser'
  | 'workflow'

export type VisualSurfaceStatus = 'active' | 'archived' | 'failed'

export interface VisualSurface {
  id: string
  workspaceId: string
  sessionId?: string
  kind: VisualSurfaceKind
  title: string
  status: VisualSurfaceStatus
  createdAt: string
  updatedAt: string
}
