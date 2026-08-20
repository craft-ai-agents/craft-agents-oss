/**
 * Pure helpers for AI mind-map enrichment.
 * LLM I/O lives in server-core; this module validates/applies structured patches.
 */

import { finalizeGraph } from './graph.ts';
import type {
  MindMapEdge,
  MindMapGraph,
  MindMapNode,
  MindMapNodeId,
  MindMapNodeKind,
} from './types.ts';
import { MIND_MAP_ROOT_ID } from './types.ts';

/** Compact outline node produced by a model (or fixture). */
export interface EnrichedOutlineNode {
  id?: string;
  label: string;
  kind?: MindMapNodeKind;
  children?: EnrichedOutlineNode[];
  source?: { kind: string; id: string };
}

export interface EnrichMindMapInput {
  graph: MindMapGraph;
  outline: EnrichedOutlineNode[];
  rootLabel?: string;
  now?: number;
}

export interface EnrichMindMapResult {
  graph: MindMapGraph;
  droppedIds: MindMapNodeId[];
}

const ALLOWED_KINDS: Record<string, true> = {
  root: true,
  turn: true,
  user: true,
  assistant: true,
  tool: true,
  heading: true,
  section: true,
  backlink: true,
  block: true,
};

function sanitizeId(raw: string, fallback: string): MindMapNodeId {
  const cleaned = raw
    .replace(/[^a-zA-Z0-9:._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

function normalizeKind(kind: string | undefined, depth: number): MindMapNodeKind {
  if (kind && ALLOWED_KINDS[kind] && kind !== 'root') {
    return kind as MindMapNodeKind;
  }
  return depth <= 1 ? 'heading' : 'section';
}

function readStringField(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Build a new MindMapGraph from an enriched outline tree.
 * Sets derivation to `enriched`.
 */
export function applyEnrichedOutline(input: EnrichMindMapInput): EnrichMindMapResult {
  const { graph: source, outline } = input;
  const now = input.now ?? Date.now();
  const rootLabel = (input.rootLabel ?? source.nodes[source.rootId]?.label ?? 'Map').trim() || 'Map';

  const nodes: Record<MindMapNodeId, MindMapNode> = {
    [MIND_MAP_ROOT_ID]: {
      id: MIND_MAP_ROOT_ID,
      label: rootLabel,
      kind: 'root',
      children: [],
      level: 0,
    },
  };
  const edges: MindMapEdge[] = [];
  const usedIds = new Set<MindMapNodeId>([MIND_MAP_ROOT_ID]);

  const takeId = (preferred: string | undefined, path: string): MindMapNodeId => {
    let base = sanitizeId(preferred ?? path, path);
    if (!usedIds.has(base)) {
      usedIds.add(base);
      return base;
    }
    let i = 2;
    while (usedIds.has(`${base}_${i}`)) i += 1;
    const id = `${base}_${i}`;
    usedIds.add(id);
    return id;
  };

  const walk = (
    items: EnrichedOutlineNode[],
    parentId: MindMapNodeId,
    depth: number,
    pathPrefix: string,
  ) => {
    const parent = nodes[parentId];
    if (!parent) return;
    items.forEach((item, index) => {
      const label = (item.label ?? '').replace(/\s+/g, ' ').trim();
      if (!label) return;
      const path = `${pathPrefix}${index}`;
      const id = takeId(item.id, `e${path}`);
      const kind = normalizeKind(item.kind, depth);
      const node: MindMapNode = {
        id,
        label: label.slice(0, 200),
        kind,
        parentId,
        children: [],
        level: depth,
        ...(item.source ? { source: item.source } : {}),
      };
      nodes[id] = node;
      parent.children.push(id);
      edges.push({
        id: `e:parent:${parentId}>${id}`,
        from: parentId,
        to: id,
        kind: 'parent',
      });
      if (item.children?.length) {
        walk(item.children, id, depth + 1, `${path}.`);
      }
    });
  };

  walk(outline, MIND_MAP_ROOT_ID, 1, '');

  const next: MindMapGraph = {
    entity: source.entity,
    rootId: MIND_MAP_ROOT_ID,
    nodes,
    edges,
    contentHash: '',
    derivedAt: now,
    derivation: 'enriched',
  };
  finalizeGraph(next, 'enriched');
  next.derivedAt = now;

  const droppedIds = Object.keys(source.nodes).filter(
    (id) => id !== MIND_MAP_ROOT_ID && !nodes[id],
  );
  return { graph: next, droppedIds };
}

/**
 * Parse model JSON into EnrichedOutlineNode[].
 * Accepts: raw array, { outline: [] }, { nodes: [] }, or fenced ```json.
 */
export function parseEnrichedOutlineJson(raw: string): EnrichedOutlineNode[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();

  const parsed: unknown = JSON.parse(text);
  let list: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.outline)) list = obj.outline;
    else if (Array.isArray(obj.nodes)) list = obj.nodes;
  }

  if (!list) {
    throw new Error('mindmap enrich: expected JSON array or { outline: [] }');
  }

  return list.map(normalizeUnknownNode).filter((n): n is EnrichedOutlineNode => n != null);
}

/** Alias used by server handler. */
export const parseEnrichmentJson = parseEnrichedOutlineJson;

function normalizeUnknownNode(value: unknown): EnrichedOutlineNode | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const label =
    readStringField(o, 'label') ?? readStringField(o, 'text') ?? readStringField(o, 'title') ?? '';
  if (!label.trim()) return null;
  const childrenRaw = Array.isArray(o.children) ? o.children : [];
  const children = childrenRaw
    .map(normalizeUnknownNode)
    .filter((n): n is EnrichedOutlineNode => n != null);
  const kindStr = readStringField(o, 'kind');
  const kind =
    kindStr && ALLOWED_KINDS[kindStr] && kindStr !== 'root'
      ? (kindStr as MindMapNodeKind)
      : undefined;
  const id = readStringField(o, 'id');
  let source: EnrichedOutlineNode['source'];
  if (o.source && typeof o.source === 'object') {
    const s = o.source as Record<string, unknown>;
    const sk = readStringField(s, 'kind');
    const sid = readStringField(s, 'id');
    if (sk && sid) source = { kind: sk, id: sid };
  }
  return {
    label: label.trim(),
    ...(id ? { id } : {}),
    ...(kind ? { kind } : {}),
    ...(source ? { source } : {}),
    ...(children.length ? { children } : {}),
  };
}

/** Deterministic no-LLM enrich: collapse single-child same-label chains. */
export function heuristicEnrichOutline(graph: MindMapGraph): EnrichedOutlineNode[] {
  const walk = (id: MindMapNodeId): EnrichedOutlineNode | null => {
    const node = graph.nodes[id];
    if (!node) return null;
    if (id === graph.rootId) {
      return {
        label: node.label,
        children: node.children.map(walk).filter((n): n is EnrichedOutlineNode => n != null),
      };
    }
    const kids = node.children.map(walk).filter((n): n is EnrichedOutlineNode => n != null);
    if (kids.length === 1 && kids[0] && kids[0].label === node.label) {
      return kids[0];
    }
    return {
      id: node.id,
      label: node.label,
      kind: node.kind === 'root' ? 'heading' : node.kind,
      ...(node.source ? { source: node.source } : {}),
      ...(kids.length ? { children: kids } : {}),
    };
  };

  const root = walk(graph.rootId);
  return root?.children ?? [];
}

export function buildEnrichPrompt(graph: MindMapGraph, maxNodes = 80): string {
  const lines: string[] = [];
  const walk = (id: MindMapNodeId, depth: number) => {
    if (lines.length >= maxNodes) return;
    const node = graph.nodes[id];
    if (!node) return;
    if (id !== graph.rootId) {
      lines.push(`${'  '.repeat(Math.max(0, depth - 1))}- (${node.kind}) ${node.label}`);
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(graph.rootId, 0);

  return [
    'Improve this mind map outline for clarity and hierarchy.',
    'Return ONLY JSON: { "outline": [ { "id?", "label", "kind?", "children?" } ] }',
    'Keep meaning; merge noise; preserve important ids when possible.',
    'Kinds allowed: turn, user, assistant, tool, heading, section, backlink, block.',
    'Root title: ' + (graph.nodes[graph.rootId]?.label ?? 'Map'),
    'Current outline:',
    ...lines,
  ].join('\n');
}
