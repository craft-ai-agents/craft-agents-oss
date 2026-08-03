import type { WorkspaceGraph, GraphNode } from './types'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findNodeById(graph: WorkspaceGraph, id: number): GraphNode | undefined {
  return graph.nodes.find((node) => node.id === id)
}

export interface RetrievalResult {
  nodes: GraphNode[]
  scores: Map<number, number>
}

/**
 * Score nodes against a query using keyword matching.
 * Returns top 6 most relevant nodes sorted by score.
 */
export function scoreNodesAgainstQuery(
  graph: WorkspaceGraph,
  query: string
): RetrievalResult {
  const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  const scores = new Map<number, number>()

  graph.nodes.forEach((node) => {
    let score = 0

    keywords.forEach((keyword) => {
      const title = node.label.toLowerCase()
      const excerpt = node.excerpt.toLowerCase()

      // Title exact match
      if (title === keyword) score += 100

      // Title contains keyword
      if (title.includes(keyword)) score += 50

      // Count keyword occurrences in excerpt
      const excerptMatches = (excerpt.match(new RegExp(escapeRegExp(keyword), 'g')) || []).length
      score += excerptMatches * 10
    })

    // Boost recent sessions
    if (node.type === 'session' && node.timestamp) {
      const ageInDays = (Date.now() - node.timestamp) / (1000 * 60 * 60 * 24)
      const recencyBoost = Math.max(0, 10 - ageInDays / 7) // Decay over weeks
      score += recencyBoost
    }

    if (score > 0) {
      scores.set(node.id, score)
    }
  })

  // Sort by score descending, take top 6
  const topNodeIds = Array.from(scores.entries())
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
    .slice(0, 6)
    .map(([id]) => id)

  const resultNodes = topNodeIds
    .map((id) => findNodeById(graph, id))
    .filter((n): n is GraphNode => n !== undefined && n !== null)

  return {
    nodes: resultNodes,
    scores,
  }
}

/**
 * Format nodes for Claude context.
 * Returns a string like "[0] Session: excerpt...\n[1] Source: ..."
 */
export function formatNodesForContext(nodes: GraphNode[]): string {
  return nodes
    .map(
      (node, idx) =>
        `[${node.id}] ${node.type.charAt(0).toUpperCase() + node.type.slice(1)} - ${node.label}:\n${node.excerpt}`,
    )
    .join('\n\n')
}
