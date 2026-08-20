/**
 * Horizontal tree auto-layout for MindMapGraph.
 * Root left, children to the right; collapsed nodes hide descendants.
 */

import type { MindMapGraph, MindMapLayout, MindMapNodeId } from './types.ts';

export interface AutoLayoutOptions {
  /** Explicit collapsed node ids (merged with graph node.collapsed). */
  collapsed?: readonly MindMapNodeId[];
  /** Horizontal gap between depth levels (default 200). */
  hGap?: number;
  /** Vertical gap between sibling leaf rows (default 56). */
  vGap?: number;
  /** Reserved node box width (positions are node centers). */
  nodeWidth?: number;
  /** Leaf row height contribution (default 40; used with vGap stacking). */
  nodeHeight?: number;
  /** Alias for hGap (compat). */
  levelGap?: number;
  /** Alias for vGap (compat). */
  rowGap?: number;
  /** Root origin (default 0,0). */
  origin?: { x: number; y: number };
}

const DEFAULT_HGAP = 200;
const DEFAULT_VGAP = 56;

/** Visible child ids (empty when parent collapsed). */
export function visibleChildren(
  graph: MindMapGraph,
  parentId: MindMapNodeId,
  collapsedSet: ReadonlySet<MindMapNodeId>,
): MindMapNodeId[] {
  if (collapsedSet.has(parentId) || graph.nodes[parentId]?.collapsed) return [];
  const parent = graph.nodes[parentId];
  if (!parent) return [];
  return parent.children.filter((id) => Boolean(graph.nodes[id]));
}

/**
 * Count leaf rows under id (1 if leaf or collapsed with no visible children).
 */
export function subtreeLeafCount(
  graph: MindMapGraph,
  id: MindMapNodeId,
  collapsedSet: ReadonlySet<MindMapNodeId>,
  memo: Map<MindMapNodeId, number> = new Map(),
): number {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;
  const kids = visibleChildren(graph, id, collapsedSet);
  if (kids.length === 0) {
    memo.set(id, 1);
    return 1;
  }
  let sum = 0;
  for (const child of kids) {
    sum += subtreeLeafCount(graph, child, collapsedSet, memo);
  }
  const n = Math.max(1, sum);
  memo.set(id, n);
  return n;
}

/**
 * LR tree layout: x = depth * hGap; y stacks sibling subtrees with vGap.
 * Each node is vertically centered over its leaf span.
 * Collapsed nodes are placed; descendants are omitted.
 */
export function autoLayout(graph: MindMapGraph, opts: AutoLayoutOptions = {}): MindMapLayout {
  const hGap = opts.hGap ?? opts.levelGap ?? DEFAULT_HGAP;
  const vGap = opts.vGap ?? opts.rowGap ?? DEFAULT_VGAP;
  const origin = opts.origin ?? { x: 0, y: 0 };

  const collapsedList: MindMapNodeId[] = [...(opts.collapsed ?? [])];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node?.collapsed) collapsedList.push(id);
  }
  const collapsedSet = new Set<MindMapNodeId>(collapsedList);

  const positions: MindMapLayout['positions'] = {};
  const leafMemo = new Map<MindMapNodeId, number>();

  if (!graph.nodes[graph.rootId]) {
    return { positions, collapsed: [...new Set(collapsedList)] };
  }

  const totalLeaves = subtreeLeafCount(graph, graph.rootId, collapsedSet, leafMemo);

  const place = (id: MindMapNodeId, depth: number, rowStart: number): void => {
    const leaves = subtreeLeafCount(graph, id, collapsedSet, leafMemo);
    const mid = rowStart + (leaves - 1) / 2;
    positions[id] = {
      x: origin.x + depth * hGap,
      y: origin.y + mid * vGap,
    };
    const kids = visibleChildren(graph, id, collapsedSet);
    let cursor = rowStart;
    for (const child of kids) {
      const childLeaves = subtreeLeafCount(graph, child, collapsedSet, leafMemo);
      place(child, depth + 1, cursor);
      cursor += childLeaves;
    }
  };

  // Center tree so multi-leaf spans around origin.y; single leaf sits at origin.
  place(graph.rootId, 0, -((totalLeaves - 1) / 2));

  const collapsed = [...new Set(collapsedList)].filter((id) => Boolean(graph.nodes[id]));

  return {
    positions,
    collapsed,
  };
}

/** Bounding box of laid-out positions (for fit/minimap). */
export function layoutBounds(
  layout: MindMapLayout,
  pad = 0,
): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  const pts = Object.values(layout.positions);
  if (pts.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (!p) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
