import { describe, expect, test } from 'bun:test';
import type { MindMapGraph } from '../types.ts';
import { deriveNoteMindMap } from '../derive-note.ts';
import { createMindMapStarterGraph } from '../graph.ts';
import {
  addPinnedCustomNode,
  deletePinnedCustomNode,
  PinnedMindMapEditError,
  reparentPinnedCustomNode,
  renamePinnedCustomNode,
  type PinnedMindMapEditErrorCode,
} from '../pinned-edit.ts';
import {
  createPinnedMap,
  isStale,
  parsePinnedMap,
  serializePinnedMap,
} from '../pin.ts';

function customNodeId(graph: MindMapGraph): string {
  const id = Object.keys(graph.nodes).find((nodeId) => graph.nodes[nodeId]?.kind === 'custom');
  if (!id) throw new Error('expected custom mind map node');
  return id;
}

function expectEditError(
  action: () => unknown,
  code: PinnedMindMapEditErrorCode,
): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(PinnedMindMapEditError);
    expect((error as PinnedMindMapEditError).code).toBe(code);
  }
}

describe('pinned custom mind map edits', () => {

  test('builds an editable source-less starter pipeline without changing live history', () => {
    const live = deriveNoteMindMap({ noteId: 'note', title: 'Live', markdown: '# Derived' });
    const liveSnapshot = JSON.parse(JSON.stringify(live));
    const starter = createMindMapStarterGraph(
      { type: 'note', noteId: 'new-note' },
      {
        input: 'Input',
        plan: 'Plan',
        execute: 'Execute',
        review: 'Review',
        result: 'Result',
      },
    );

    expect(starter.derivation).toBe('pinned');
    expect(starter.nodes.root?.label).toBe('Input');
    expect(starter.nodes.root?.children).toEqual(['starter:plan']);
    expect(starter.nodes['starter:plan']?.children).toEqual(['starter:execute']);
    expect(starter.nodes['starter:execute']?.children).toEqual(['starter:review']);
    expect(starter.nodes['starter:review']?.children).toEqual(['starter:result']);
    expect(starter.nodes['starter:result']?.source).toBeUndefined();

    const editedStarter = addPinnedCustomNode(starter, 'starter:result', 'Custom next step');
    expect(editedStarter.nodes['starter:result']?.children).toContain('custom:1');
    expect(live).toEqual(liveSnapshot);
  })
  test('round-trips a source-less custom node through a pinned map', () => {
    const live = deriveNoteMindMap({ noteId: 'note', title: 'Map', markdown: '# Source' });
    const pin = createPinnedMap(live, { positions: {}, collapsed: [] }, 100);
    const withCustom = addPinnedCustomNode(pin.graph, pin.graph.rootId, '  My custom idea  ');
    const customId = customNodeId(withCustom);
    const renamed = renamePinnedCustomNode(withCustom, customId, 'Renamed custom idea');
    const restored = parsePinnedMap(
      serializePinnedMap({ ...pin, graph: renamed, updatedAt: 200 }),
    );

    expect(restored.graph.derivation).toBe('pinned');
    expect(restored.graph.nodes[customId]).toMatchObject({
      id: customId,
      label: 'Renamed custom idea',
      kind: 'custom',
      parentId: restored.graph.rootId,
    });
    expect(restored.graph.nodes[customId]?.source).toBeUndefined();
    expect(restored.graph.nodes[restored.graph.rootId]?.children).toContain(customId);
  });

  test('validates edits and never mutates the live source graph', () => {
    const live = deriveNoteMindMap({ noteId: 'note', title: 'Map', markdown: '# Source' });
    const sourceSnapshot = JSON.parse(JSON.stringify(live));

    expectEditError(
      () => addPinnedCustomNode(live, live.rootId, 'Rejected live edit'),
      'not-pinned',
    );
    expect(live).toEqual(sourceSnapshot);

    const pin = createPinnedMap(live);
    const parent = addPinnedCustomNode(pin.graph, pin.graph.rootId, 'Parent');
    const parentId = customNodeId(parent);
    const withChild = addPinnedCustomNode(parent, parentId, 'Child');
    const childId = Object.keys(withChild.nodes).find(
      (id) => id !== parentId && withChild.nodes[id]?.kind === 'custom',
    )!;

    expectEditError(
      () => renamePinnedCustomNode(withChild, parent.rootId, 'Cannot rename source root'),
      'node-not-custom',
    );
    expectEditError(
      () => addPinnedCustomNode(withChild, parentId, '   '),
      'invalid-label',
    );
    expectEditError(
      () => reparentPinnedCustomNode(withChild, parentId, childId),
      'cannot-reparent-descendant',
    );
    expect(live).toEqual(sourceSnapshot);
  });

  test('keeps custom structure for stale Keep and discards it for Rebuild', () => {
    const live = deriveNoteMindMap({ noteId: 'note', title: 'Map', markdown: '# Before' });
    const pin = createPinnedMap(live, { positions: {}, collapsed: [] }, 100);
    const keptGraph = addPinnedCustomNode(pin.graph, pin.graph.rootId, 'Pinned custom');
    const customId = customNodeId(keptGraph);
    const stalePin = { ...pin, graph: keptGraph, updatedAt: 200 };
    const changedLive = deriveNoteMindMap({ noteId: 'note', title: 'Map', markdown: '# After' });

    expect(isStale(stalePin, changedLive.contentHash)).toBe(true);
    expect(stalePin.graph.nodes[customId]?.label).toBe('Pinned custom');

    const rebuilt = createPinnedMap(
      changedLive,
      { positions: {}, collapsed: [] },
      300,
      changedLive.contentHash,
    );
    expect(isStale(rebuilt, changedLive.contentHash)).toBe(false);
    expect(rebuilt.graph.nodes[customId]).toBeUndefined();
  });

  test('reparents and deletes custom nodes without deleting their children', () => {
    const live = deriveNoteMindMap({ noteId: 'note', title: 'Map', markdown: '# Source' });
    const pin = createPinnedMap(live);
    const parent = addPinnedCustomNode(pin.graph, pin.graph.rootId, 'Parent');
    const parentId = customNodeId(parent);
    const withChild = addPinnedCustomNode(parent, parentId, 'Child');
    const childId = Object.keys(withChild.nodes).find(
      (id) => id !== parentId && withChild.nodes[id]?.kind === 'custom',
    )!;
    const moved = reparentPinnedCustomNode(withChild, childId, withChild.rootId);
    const restoredParent = reparentPinnedCustomNode(moved, parentId, childId);
    const deleted = deletePinnedCustomNode(restoredParent, parentId);

    expect(moved.nodes[childId]?.parentId).toBe(moved.rootId);
    expect(deleted.nodes[parentId]).toBeUndefined();
    expect(deleted.nodes[childId]?.parentId).toBe(deleted.rootId);
  });
});
