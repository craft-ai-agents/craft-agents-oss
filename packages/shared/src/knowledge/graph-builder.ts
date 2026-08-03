import type { GraphNode, GraphEdge, WorkspaceGraph } from './types'

export interface SimpleSession {
  id: string
  title?: string
  name?: string
  createdAt?: string | number
  messages?: Array<{ text?: string; content?: string; role?: string }>
}

/**
 * Build a workspace knowledge graph from sessions, sources, and notes.
 * Extracts nodes from workspace data and links them by co-mention and wikilinks.
 */
export async function buildWorkspaceGraph(
  sessions: SimpleSession[],
  workspaceName: string
): Promise<WorkspaceGraph> {
  const nodes: GraphNode[] = []
  const edges: Set<string> = new Set()

  // Phase 1: Extract session nodes
  sessions.forEach((session) => {
    const title = session.title || session.name
    if (!title) return

    // Collect all persisted message text for excerpt. Runtime sessions use
    // `content`; older graph inputs used `text`, so support both shapes.
    const allText = session.messages
      ?.map((m) => m.content || m.text || '')
      .filter(Boolean)
      .join('\n') || ''
    const excerpt = allText.slice(0, 700)

    nodes.push({
      id: nodes.length,
      label: title,
      type: 'session',
      group: workspaceName,
      excerpt: excerpt || '(empty session)',
      timestamp: session.createdAt ? new Date(session.createdAt).getTime() : undefined,
      metadata: {
        sessionId: session.id,
      },
    })
  })

  // Phase 2: Link nodes by co-mention
  // For now: simple string matching (session title appears in another's messages)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const nodeI = nodes[i]
      const nodeJ = nodes[j]
      if (!nodeI || !nodeJ) continue

      // Check if nodeI's label appears in nodeJ's excerpt/content
      const iMentionsJ = (nodeJ.excerpt + (nodeJ.content || '')).toLowerCase().includes(nodeI.label.toLowerCase())
      const jMentionsI = (nodeI.excerpt + (nodeI.content || '')).toLowerCase().includes(nodeJ.label.toLowerCase())

      if (iMentionsJ || jMentionsI) {
        const edgeKey = `${i}-${j}`
        edges.add(edgeKey)
      }
    }
  }

  // Convert edge set to array
  const edgeArray: GraphEdge[] = Array.from(edges)
    .map((edgeKey) => {
      const parts = edgeKey.split('-').map(Number)
      const source = parts[0]
      const target = parts[1]
      if (typeof source === 'number' && typeof target === 'number') {
        return { source, target, type: 'co-mention' as const }
      }
      return null as any
    })
    .filter((e) => e !== null) as GraphEdge[]

  return {
    nodes,
    edges: edgeArray,
    builtAt: Date.now(),
  }
}
