import { cloneMindMapGraph, finalizeGraph } from './graph.ts';
import type { MindMapGraph, MindMapNode, MindMapNodeId } from './types.ts';

export const MAX_CUSTOM_MIND_MAP_LABEL_LENGTH = 160;

export type PinnedMindMapEditErrorCode =
  | 'not-pinned'
  | 'invalid-label'
  | 'unknown-node'
  | 'node-not-custom'
  | 'cannot-delete-root'
  | 'cannot-reparent-root'
  | 'invalid-parent'
  | 'cannot-reparent-descendant';

/** Raised when an edit cannot safely be applied to a pinned map snapshot. */
export class PinnedMindMapEditError extends Error {
  constructor(readonly code: PinnedMindMapEditErrorCode) {
    super(`mindmap: ${code}`);
    this.name = 'PinnedMindMapEditError';
  }
}

function requirePinnedGraph(graph: MindMapGraph): void {
  if (graph.derivation !== 'pinned') {
    throw new PinnedMindMapEditError('not-pinned');
  }
}

function requireNode(graph: MindMapGraph, nodeId: MindMapNodeId): MindMapNode {
  const node = graph.nodes[nodeId];
  if (!node) throw new PinnedMindMapEditError('unknown-node');
  return node;
}

function requireCustomNode(graph: MindMapGraph, nodeId: MindMapNodeId): MindMapNode {
  const node = requireNode(graph, nodeId);
  if (node.kind !== 'custom') {
    throw new PinnedMindMapEditError('node-not-custom');
  }
  return node;
}

function normalizeLabel(label: string): string {
  const normalized = label.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > MAX_CUSTOM_MIND_MAP_LABEL_LENGTH) {
    throw new PinnedMindMapEditError('invalid-label');
  }
  return normalized;
}

function parentEdgeId(parentId: MindMapNodeId, childId: MindMapNodeId): string {
  return `e:parent:${parentId}>${childId}`;
}

function appendParentEdge(graph: MindMapGraph, parentId: MindMapNodeId, childId: MindMapNodeId): void {
  const id = parentEdgeId(parentId, childId);
  if (!graph.edges.some((edge) => edge.id === id)) {
    graph.edges.push({ id, from: parentId, to: childId, kind: 'parent' });
  }
}

function nextCustomNodeId(graph: MindMapGraph): MindMapNodeId {
  let suffix = 1;
  while (graph.nodes[`custom:${suffix}`]) suffix += 1;
  return `custom:${suffix}`;
}

function isDescendant(
  graph: MindMapGraph,
  ancestorId: MindMapNodeId,
  candidateId: MindMapNodeId,
): boolean {
  const seen = new Set<MindMapNodeId>();
  const pending = [...(graph.nodes[ancestorId]?.children ?? [])];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (id === candidateId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(graph.nodes[id]?.children ?? []));
  }
  return false;
}

/**
 * Add a source-less custom node to a pinned snapshot. The live projection is
 * rejected before cloning so caller-owned source data is never changed.
 */
export function addPinnedCustomNode(
  graph: MindMapGraph,
  parentId: MindMapNodeId,
  label: string,
): MindMapGraph {
  requirePinnedGraph(graph);
  const normalizedLabel = normalizeLabel(label);
  if (!graph.nodes[parentId]) {
    throw new PinnedMindMapEditError('invalid-parent');
  }

  const next = cloneMindMapGraph(graph);
  const id = nextCustomNodeId(next);
  next.nodes[id] = {
    id,
    label: normalizedLabel,
    kind: 'custom',
    parentId,
    children: [],
  };
  next.nodes[parentId]!.children.push(id);
  appendParentEdge(next, parentId, id);
  return finalizeGraph(next, 'pinned');
}

/** Rename a custom node in a pinned snapshot without touching its source graph. */
export function renamePinnedCustomNode(
  graph: MindMapGraph,
  nodeId: MindMapNodeId,
  label: string,
): MindMapGraph {
  requirePinnedGraph(graph);
  const node = requireCustomNode(graph, nodeId);
  const normalizedLabel = normalizeLabel(label);
  if (node.label === normalizedLabel) return graph;

  const next = cloneMindMapGraph(graph);
  next.nodes[nodeId]!.label = normalizedLabel;
  return finalizeGraph(next, 'pinned');
}

/**
 * Delete one custom node and promote its children into the former parent.
 * This preserves the remainder of a pinned tree instead of cascading a delete.
 */
export function deletePinnedCustomNode(
  graph: MindMapGraph,
  nodeId: MindMapNodeId,
): MindMapGraph {
  requirePinnedGraph(graph);
  if (nodeId === graph.rootId) {
    throw new PinnedMindMapEditError('cannot-delete-root');
  }
  const node = requireCustomNode(graph, nodeId);
  if (!node.parentId || !graph.nodes[node.parentId]) {
    throw new PinnedMindMapEditError('invalid-parent');
  }

  const next = cloneMindMapGraph(graph);
  const parent = next.nodes[node.parentId]!;
  const promotedIds = [...new Set(
    Object.values(next.nodes)
      .filter((candidate) => candidate.parentId === nodeId)
      .map((candidate) => candidate.id),
  )];
  const oldIndex = parent.children.indexOf(nodeId);
  const remainingChildren = parent.children.filter(
    (id) => id !== nodeId && !promotedIds.includes(id),
  );
  const insertionIndex =
    oldIndex < 0 ? remainingChildren.length : Math.min(oldIndex, remainingChildren.length);
  parent.children = remainingChildren;
  parent.children.splice(insertionIndex, 0, ...promotedIds);

  for (const childId of promotedIds) {
    const child = next.nodes[childId];
    if (child) child.parentId = parent.id;
  }
  delete next.nodes[nodeId];
  next.edges = next.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  for (const childId of promotedIds) appendParentEdge(next, parent.id, childId);
  return finalizeGraph(next, 'pinned');
}

/** Move a custom node beneath a different existing node in a pinned snapshot. */
export function reparentPinnedCustomNode(
  graph: MindMapGraph,
  nodeId: MindMapNodeId,
  parentId: MindMapNodeId,
): MindMapGraph {
  requirePinnedGraph(graph);
  if (nodeId === graph.rootId) {
    throw new PinnedMindMapEditError('cannot-reparent-root');
  }
  const node = requireCustomNode(graph, nodeId);
  if (!graph.nodes[parentId]) {
    throw new PinnedMindMapEditError('invalid-parent');
  }
  if (parentId === nodeId || isDescendant(graph, nodeId, parentId)) {
    throw new PinnedMindMapEditError('cannot-reparent-descendant');
  }
  if (node.parentId === parentId) return graph;

  const next = cloneMindMapGraph(graph);
  for (const candidate of Object.values(next.nodes)) {
    candidate.children = candidate.children.filter((childId) => childId !== nodeId);
  }
  next.nodes[parentId]!.children.push(nodeId);
  next.nodes[nodeId]!.parentId = parentId;
  next.edges = next.edges.filter(
    (edge) => !(edge.kind === 'parent' && edge.to === nodeId),
  );
  appendParentEdge(next, parentId, nodeId);
  return finalizeGraph(next, 'pinned');
}
