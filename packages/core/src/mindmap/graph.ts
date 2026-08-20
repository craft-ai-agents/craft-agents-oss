import { hashMindMapSource } from './hash.ts';
import type {
  MindMapDerivation,
  MindMapEdge,
  MindMapEntityRef,
  MindMapGraph,
  MindMapNode,
  MindMapNodeId,
  MindMapNodeKind,
  MindMapNodeSource,
} from './types.ts';
import { MIND_MAP_ROOT_ID } from './types.ts';

/** Partial node passed to addChild — children are always assigned by the helper. */
export type MindMapChildInput = {
  id: MindMapNodeId;
  label: string;
  kind: MindMapNodeKind;
  meta?: Record<string, string | number | boolean>;
  source?: MindMapNodeSource;
  collapsed?: boolean;
  level?: number;
};

export function entityKey(entity: MindMapEntityRef): string {
  if (entity.type === 'session') return `session:${entity.sessionId}`;
  if (entity.type === 'note') return `note:${entity.noteId}`;
  const ref = entity.ref;
  return `knowledge:${ref.provider ?? ref.scheme}:${ref.kind}:${ref.id}`;
}

export function createEmptyGraph(entity: MindMapEntityRef, rootLabel: string): MindMapGraph {
  const root: MindMapNode = {
    id: MIND_MAP_ROOT_ID,
    label: rootLabel,
    kind: 'root',
    children: [],
    level: 0,
  };
  return {
    entity,
    rootId: MIND_MAP_ROOT_ID,
    nodes: { [MIND_MAP_ROOT_ID]: root },
    edges: [],
    contentHash: '',
    derivedAt: 0,
    derivation: 'session',
  };
}

/** Localized labels supplied by the renderer for a new empty map. */
export interface MindMapStarterLabels {
  input: string;
  plan: string;
  execute: string;
  review: string;
  result: string;
}

/**
 * Build a small, editable pinned pipeline when an entity has no derived
 * structure yet. It deliberately has no source-bearing nodes.
 */
export function createMindMapStarterGraph(
  entity: MindMapEntityRef,
  labels: MindMapStarterLabels,
): MindMapGraph {
  const graph = createEmptyGraph(entity, labels.input);
  let parentId = graph.rootId;
  for (const [id, label] of [
    ['starter:plan', labels.plan],
    ['starter:execute', labels.execute],
    ['starter:review', labels.review],
    ['starter:result', labels.result],
  ] as const) {
    addChild(graph, parentId, { id, label, kind: 'custom' });
    parentId = id;
  }
  return finalizeGraph(graph, 'pinned');
}

/**
 * Copy a graph before changing a pinned snapshot. Derived/live projections stay
 * isolated from pin-local structure and label edits.
 */
export function cloneMindMapGraph(graph: MindMapGraph): MindMapGraph {
  const nodes: Record<MindMapNodeId, MindMapNode> = {};
  for (const [id, node] of Object.entries(graph.nodes)) {
    nodes[id] = {
      ...node,
      children: [...node.children],
      ...(node.meta ? { meta: { ...node.meta } } : {}),
      ...(node.source ? { source: { ...node.source } } : {}),
    };
  }

  const entity: MindMapEntityRef =
    graph.entity.type === 'knowledge'
      ? { type: 'knowledge', ref: { ...graph.entity.ref } }
      : { ...graph.entity };

  return {
    ...graph,
    entity,
    nodes,
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

/**
 * Add a child under parentId. Assigns children[], parentId, and a parent edge.
 * Returns the created (or existing) node.
 */
export function addChild(
  graph: MindMapGraph,
  parentId: MindMapNodeId,
  partial: MindMapChildInput,
): MindMapNode {
  const parent = graph.nodes[parentId];
  if (!parent) {
    throw new Error(`mindmap: unknown parent ${parentId}`);
  }

  const existing = graph.nodes[partial.id];
  if (existing) {
    if (!parent.children.includes(existing.id)) {
      parent.children.push(existing.id);
      existing.parentId = parentId;
      ensureParentEdge(graph, parentId, existing.id);
    }
    return existing;
  }

  const node: MindMapNode = {
    id: partial.id,
    label: partial.label,
    kind: partial.kind,
    parentId,
    children: [],
    ...(partial.meta ? { meta: partial.meta } : {}),
    ...(partial.source ? { source: partial.source } : {}),
    ...(partial.collapsed !== undefined ? { collapsed: partial.collapsed } : {}),
    ...(partial.level !== undefined ? { level: partial.level } : {}),
  };
  graph.nodes[node.id] = node;
  parent.children.push(node.id);
  ensureParentEdge(graph, parentId, node.id);
  return node;
}

function ensureParentEdge(graph: MindMapGraph, from: MindMapNodeId, to: MindMapNodeId): void {
  const id = `e:parent:${from}>${to}`;
  if (graph.edges.some((e) => e.id === id)) return;
  const edge: MindMapEdge = { id, from, to, kind: 'parent' };
  graph.edges.push(edge);
}

export function addEdge(
  graph: MindMapGraph,
  from: MindMapNodeId,
  to: MindMapNodeId,
  kind: MindMapEdge['kind'],
): MindMapEdge {
  const id = `e:${kind}:${from}>${to}`;
  const existing = graph.edges.find((edge) => edge.id === id);
  if (existing) return existing;
  const edge: MindMapEdge = { id, from, to, kind };
  graph.edges.push(edge);
  return edge;
}

export function truncateLabel(text: string, max = 80): string {
  const firstLine = text.split('\n')[0] ?? '';
  const oneLine = firstLine.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine || '…';
  return `${oneLine.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * Sets contentHash from sorted node labels+ids+edges, derivedAt, derivation.
 */
export function finalizeGraph(graph: MindMapGraph, derivation: MindMapDerivation): MindMapGraph {
  const nodeParts = Object.values(graph.nodes)
    .map((n) => `${n.id}\0${n.label}\0${n.kind}\0${n.parentId ?? ''}`)
    .sort();
  const edgeParts = graph.edges
    .map((e) => `${e.id}\0${e.from}\0${e.to}\0${e.kind}`)
    .sort();
  graph.contentHash = hashMindMapSource([...nodeParts, ...edgeParts]);
  graph.derivedAt = Date.now();
  graph.derivation = derivation;
  return graph;
}
