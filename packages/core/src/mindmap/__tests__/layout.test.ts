import { describe, expect, test } from 'bun:test';
import { createEmptyGraph, addChild, finalizeGraph } from '../graph.ts';
import { autoLayout, layoutBounds, subtreeLeafCount, visibleChildren } from '../layout.ts';

function sampleGraph() {
  const g = createEmptyGraph({ type: 'note', noteId: 'n' }, 'Root');
  addChild(g, g.rootId, { id: 'a', label: 'A', kind: 'heading' });
  addChild(g, 'a', { id: 'a1', label: 'A1', kind: 'heading' });
  addChild(g, 'a', { id: 'a2', label: 'A2', kind: 'heading' });
  addChild(g, g.rootId, { id: 'b', label: 'B', kind: 'heading' });
  return finalizeGraph(g, 'note');
}

describe('autoLayout', () => {
  test('places root and children with increasing x by depth', () => {
    const graph = sampleGraph();
    const layout = autoLayout(graph, { hGap: 200, vGap: 50 });
    expect(layout.positions.root).toBeDefined();
    expect(layout.positions.a!.x).toBeGreaterThan(layout.positions.root!.x);
    expect(layout.positions.a1!.x).toBeGreaterThan(layout.positions.a!.x);
    expect(layout.positions.b!.x).toBe(layout.positions.a!.x);
  });

  test('siblings get distinct y', () => {
    const graph = sampleGraph();
    const layout = autoLayout(graph);
    expect(layout.positions.a!.y).not.toBe(layout.positions.b!.y);
    expect(layout.positions.a1!.y).not.toBe(layout.positions.a2!.y);
  });

  test('collapsed parent hides descendants from positions', () => {
    const graph = sampleGraph();
    graph.nodes.a!.collapsed = true;
    const layout = autoLayout(graph);
    expect(layout.positions.a).toBeDefined();
    expect(layout.positions.a1).toBeUndefined();
    expect(layout.positions.a2).toBeUndefined();
    expect(layout.collapsed).toContain('a');
    expect(layout.positions.b).toBeDefined();
  });

  test('extra collapsed option works without mutating nodes', () => {
    const graph = sampleGraph();
    const layout = autoLayout(graph, { collapsed: ['a'] });
    expect(layout.positions.a1).toBeUndefined();
    expect(graph.nodes.a!.collapsed).toBeUndefined();
  });

  test('subtreeLeafCount and visibleChildren', () => {
    const graph = sampleGraph();
    const empty = new Set<string>();
    expect(subtreeLeafCount(graph, 'a', empty)).toBe(2);
    expect(subtreeLeafCount(graph, graph.rootId, empty)).toBe(3);
    expect(visibleChildren(graph, 'a', empty)).toEqual(['a1', 'a2']);
    expect(visibleChildren(graph, 'a', new Set(['a']))).toEqual([]);
  });

  test('layoutBounds', () => {
    const graph = sampleGraph();
    const layout = autoLayout(graph);
    const b = layoutBounds(layout, 10);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
    expect(b.minX).toBeLessThanOrEqual(layout.positions.root!.x);
  });
});
