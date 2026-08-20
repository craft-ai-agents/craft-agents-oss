import { addChild, createEmptyGraph, finalizeGraph, truncateLabel } from './graph.ts';
import type { MindMapGraph } from './types.ts';

export interface MindMapSessionMessage {
  id: string;
  type: string;
  content: string;
  toolName?: string;
  toolUseId?: string;
  parentToolUseId?: string;
  turnId?: string;
}

export interface MindMapSessionInput {
  sessionId: string;
  title: string;
  messages: MindMapSessionMessage[];
  /** default 200 */
  maxTurns?: number;
}

/** Roles skipped so status/info chrome does not clutter the map. */
const SKIP_TYPES = new Set(['status', 'info', 'warning']);

interface SessionTurn {
  /** Stable turn node id key (user message id or synthetic). */
  key: string;
  user?: MindMapSessionMessage;
  rest: MindMapSessionMessage[];
}

function groupSessionTurns(messages: MindMapSessionMessage[]): SessionTurn[] {
  const turns: SessionTurn[] = [];
  let current: SessionTurn | null = null;

  const flush = () => {
    if (current) {
      turns.push(current);
      current = null;
    }
  };

  for (const msg of messages) {
    if (SKIP_TYPES.has(msg.type)) continue;

    if (msg.type === 'user') {
      flush();
      current = { key: msg.id, user: msg, rest: [] };
      continue;
    }

    // Prefer turnId grouping when present and a matching open turn exists.
    if (msg.turnId) {
      const byTurnId = turns.find((t) => t.user?.turnId === msg.turnId || t.key === msg.turnId);
      if (byTurnId && !current) {
        byTurnId.rest.push(msg);
        continue;
      }
      if (current && (current.user?.turnId === msg.turnId || current.key === msg.turnId)) {
        current.rest.push(msg);
        continue;
      }
    }

    if (!current) {
      // Orphan non-user content before first user — attach under synthetic turn.
      current = { key: `orphan-${msg.id}`, rest: [msg] };
      continue;
    }
    current.rest.push(msg);
  }
  flush();
  return turns;
}

export function deriveSessionMindMap(input: MindMapSessionInput): MindMapGraph {
  const maxTurns = input.maxTurns ?? 200;
  const rootLabel = input.title.trim() || 'Session';
  const graph = createEmptyGraph(
    { type: 'session', sessionId: input.sessionId },
    rootLabel,
  );

  const allTurns = groupSessionTurns(input.messages);
  const truncated = allTurns.length > maxTurns;
  const turns = truncated ? allTurns.slice(-maxTurns) : allTurns;

  if (truncated) {
    const root = graph.nodes[graph.rootId]!;
    root.meta = { ...(root.meta ?? {}), truncated: true, totalTurns: allTurns.length };
  }

  for (const turn of turns) {
    const turnId = `turn:${turn.key}`;
    const turnLabel = turn.user
      ? truncateLabel(turn.user.content)
      : truncateLabel(turn.rest[0]?.content ?? 'Turn');
    addChild(graph, graph.rootId, {
      id: turnId,
      label: turnLabel,
      kind: 'turn',
      source: turn.user
        ? { kind: 'message', id: turn.user.id }
        : { kind: 'turn', id: turn.key },
    });

    if (turn.user) {
      addChild(graph, turnId, {
        id: `msg:${turn.user.id}`,
        label: truncateLabel(turn.user.content),
        kind: 'user',
        source: { kind: 'message', id: turn.user.id },
      });
    }

    // Track assistant nodes so tools can nest under them.
    let lastAssistantId: string | null = null;
    const toolParentByUseId = new Map<string, string>();

    for (const msg of turn.rest) {
      if (msg.type === 'assistant' || msg.type === 'thinking' || msg.type === 'plan') {
        const nodeId = `msg:${msg.id}`;
        addChild(graph, turnId, {
          id: nodeId,
          label: truncateLabel(msg.content || msg.type),
          kind: 'assistant',
          source: { kind: 'message', id: msg.id },
        });
        lastAssistantId = nodeId;
        continue;
      }

      if (msg.type === 'tool') {
        const toolKey = msg.toolUseId || msg.id;
        const toolNodeId = `tool:${toolKey}`;
        let parentId = turnId;
        if (msg.parentToolUseId && toolParentByUseId.has(msg.parentToolUseId)) {
          parentId = toolParentByUseId.get(msg.parentToolUseId)!;
        } else if (lastAssistantId) {
          parentId = lastAssistantId;
        }
        addChild(graph, parentId, {
          id: toolNodeId,
          label: truncateLabel(msg.toolName || msg.content || 'tool'),
          kind: 'tool',
          source: { kind: 'tool', id: toolKey },
          meta: msg.toolName ? { toolName: msg.toolName } : undefined,
        });
        toolParentByUseId.set(toolKey, toolNodeId);
        continue;
      }

      // Other roles (error, auth-request, …) as assistant-like leaves under turn.
      addChild(graph, turnId, {
        id: `msg:${msg.id}`,
        label: truncateLabel(msg.content || msg.type),
        kind: 'assistant',
        source: { kind: 'message', id: msg.id },
        meta: { role: msg.type },
      });
    }
  }

  return finalizeGraph(graph, 'session');
}
