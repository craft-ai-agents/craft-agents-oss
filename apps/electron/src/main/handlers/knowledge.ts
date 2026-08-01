import { RPC_CHANNELS, type Session } from '@archstudio/shared/protocol'
import { CONFIG_DIR } from '@archstudio/shared/config'
import type { RpcServer } from '@archstudio/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import type { SimpleSession, WorkspaceGraph } from '@archstudio/shared/knowledge'
import { buildWorkspaceGraph } from '@archstudio/shared/knowledge'
import { scoreNodesAgainstQuery } from '@archstudio/shared/knowledge/retrieval'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'

const MAX_CONVERSATION_MESSAGES = 200
const GRAPH_WORKSPACES_DIR = join(CONFIG_DIR, 'workspaces')

type KnowledgeConversationMessage = { role: 'user' | 'assistant'; content: string }

// In-memory conversation history per workspace. Persistence is intentionally
// deferred until the conversation schema is finalized, but the collection is
// bounded so repeated Q&A cannot grow the main process without limit.
const conversationHistory = new Map<string, KnowledgeConversationMessage[]>()

/**
 * Convert the session DTO returned by SessionManager into the small input
 * shape consumed by the shared graph builder. Full messages are loaded by the
 * caller before this helper is used.
 */
export function toKnowledgeSession(session: Session): SimpleSession {
  return {
    id: session.id,
    name: session.name || session.preview || `Session ${session.id}`,
    createdAt: session.createdAt ?? session.lastMessageAt,
    messages: session.messages.map((message) => ({
      content: message.content,
      role: message.role,
    })),
  }
}

async function loadWorkspaceSessions(deps: HandlerDeps, workspaceId: string): Promise<SimpleSession[]> {
  const summaries = deps.sessionManager
    .getSessions(workspaceId)
    .filter((session) => !session.hidden && !session.isArchived)

  const sessions = await Promise.all(
    summaries.map(async (summary) => {
      // getSessions intentionally returns metadata with lazy messages. Ask the
      // manager for the full session so the graph contains real conversation
      // content rather than only titles.
      const full = await deps.sessionManager.getSession(summary.id).catch(() => null)
      return toKnowledgeSession(full ?? summary)
    }),
  )

  return sessions
}

export function registerKnowledgeHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Build workspace graph from persisted sessions and cache it on disk.
  server.handle(RPC_CHANNELS.knowledge.BUILD_GRAPH, async (_ctx, workspaceId: string) => {
    try {
      const sessions = await loadWorkspaceSessions(deps, workspaceId)
      const graph = await buildWorkspaceGraph(sessions, workspaceId)
      const graphPath = getGraphPath(workspaceId)

      mkdirSync(dirname(graphPath), { recursive: true })
      writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf-8')
      return graph
    } catch (err) {
      throw new Error(`Failed to build workspace graph: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // Get cached graph from disk.
  server.handle(RPC_CHANNELS.knowledge.GET_GRAPH, async (_ctx, workspaceId: string) => {
    try {
      const data = readFileSync(getGraphPath(workspaceId), 'utf-8')
      return JSON.parse(data) as WorkspaceGraph
    } catch {
      return null
    }
  })

  // Get graph build status and metadata.
  server.handle(RPC_CHANNELS.knowledge.GRAPH_STATUS, async (_ctx, workspaceId: string) => {
    try {
      const data = readFileSync(getGraphPath(workspaceId), 'utf-8')
      const graph = JSON.parse(data) as WorkspaceGraph
      return {
        built: true,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        builtAt: graph.builtAt,
      }
    } catch {
      return {
        built: false,
        nodeCount: 0,
        edgeCount: 0,
        builtAt: null,
      }
    }
  })

  // Handle Q&A queries against the workspace graph. RPC forwards positional
  // arguments, matching ElectronAPI.ask(workspaceId, query).
  server.handle(RPC_CHANNELS.knowledge.ASK, async (_ctx, workspaceId: string, query: string) => {
    try {
      if (typeof workspaceId !== 'string' || typeof query !== 'string') {
        throw new Error('workspaceId and query are required')
      }

      const trimmedQuery = query.trim()
      if (!trimmedQuery) {
        return { answer: 'Ask a question about your workspace to search the graph.', nodeIds: [] }
      }

      let graph: WorkspaceGraph | null = null
      try {
        const data = readFileSync(getGraphPath(workspaceId), 'utf-8')
        graph = JSON.parse(data) as WorkspaceGraph
      } catch {
        return {
          answer: 'No workspace data available yet. Build a graph by creating some sessions first.',
          nodeIds: [],
        }
      }

      if (!graph || graph.nodes.length === 0) {
        return {
          answer: 'Your workspace is empty. Create some sessions to build your knowledge graph.',
          nodeIds: [],
        }
      }

      const retrieval = scoreNodesAgainstQuery(graph, trimmedQuery)
      const nodeIds = retrieval.nodes.map((node) => node.id)
      const answer = retrieval.nodes.length > 0
        ? `I found ${retrieval.nodes.length} relevant workspace item${retrieval.nodes.length === 1 ? '' : 's'} for “${trimmedQuery}”. Sources: ${nodeIds.map((id) => `[${id}]`).join(', ')}.`
        : `I couldn't find workspace items matching “${trimmedQuery}”. Try a broader question or rebuild the graph.`

      const history = conversationHistory.get(workspaceId) || []
      history.push({ role: 'user', content: trimmedQuery })
      history.push({ role: 'assistant', content: answer })
      if (history.length > MAX_CONVERSATION_MESSAGES) {
        history.splice(0, history.length - MAX_CONVERSATION_MESSAGES)
      }
      conversationHistory.set(workspaceId, history)

      return { answer, nodeIds }
    } catch (err) {
      throw new Error(`Failed to answer question: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  server.handle(RPC_CHANNELS.knowledge.GET_CONVERSATION, async (_ctx, workspaceId: string) => {
    return conversationHistory.get(workspaceId) || []
  })
}

/**
 * Resolve the graph cache beneath the app config directory. Workspace IDs are
 * generated slugs/UUIDs, so reject path syntax rather than allowing an RPC
 * caller to select arbitrary files with traversal components.
 */
function getGraphPath(workspaceId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(workspaceId) || workspaceId === '.' || workspaceId === '..') {
    throw new Error('Invalid workspace ID')
  }

  const root = resolve(GRAPH_WORKSPACES_DIR)
  const graphPath = resolve(root, workspaceId, 'graph-data.json')
  const relativePath = relative(root, graphPath)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('Invalid graph path')
  }
  return graphPath
}
