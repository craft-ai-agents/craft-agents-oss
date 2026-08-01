export interface GraphNode {
  id: number
  label: string
  type: 'session' | 'source' | 'note'
  group: string
  excerpt: string
  content?: string
  timestamp?: number
  metadata: {
    sourceId?: string
    sessionId?: string
    filePath?: string
  }
}

export interface GraphEdge {
  source: number
  target: number
  type: 'co-mention' | 'link'
}

export interface WorkspaceGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  builtAt: number
}
