import { describe, expect, test } from 'bun:test';
import {
  applyEnrichedOutline,
  buildEnrichPrompt,
  heuristicEnrichOutline,
  parseEnrichedOutlineJson,
} from '../enrich.ts';
import { addChild, createEmptyGraph, finalizeGraph } from '../graph.ts';

function sample() {
  const g = createEmptyGraph({ type: 'note', noteId: 'n' }, 'Doc');
  addChild(g, g.rootId, { id: 'a', label: 'Alpha', kind: 'heading' });
  addChild(g, 'a', { id: 'a1', label: 'Alpha', kind: 'section' });
  addChild(g, g.rootId, { id: 'b', label: 'Beta', kind: 'heading' });
  return finalizeGraph(g, 'note');
}

describe('parseEnrichedOutlineJson', () => {
  test('parses bare array', () => {
    const nodes = parseEnrichedOutlineJson('[{"label":"A","children":[{"label":"A1"}]}]');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.label).toBe('A');
    expect(nodes[0]!.children?.[0]?.label).toBe('A1');
  });

  test('parses fenced { outline }', () => {
    const raw = '```json\n{"outline":[{"label":"X"}]}\n```';
    expect(parseEnrichedOutlineJson(raw)[0]!.label).toBe('X');
  });

  test('rejects garbage', () => {
    expect(() => parseEnrichedOutlineJson('{"foo":1}')).toThrow(/outline/);
  });
});

describe('applyEnrichedOutline', () => {
  test('builds enriched graph and drops old ids', () => {
    const source = sample();
    const { graph, droppedIds } = applyEnrichedOutline({
      graph: source,
      outline: [
        {
          id: 'a',
          label: 'Alpha improved',
          children: [{ label: 'Detail' }],
        },
      ],
      now: 42,
    });
    expect(graph.derivation).toBe('enriched');
    expect(graph.derivedAt).toBe(42);
    expect(graph.entity).toEqual(source.entity);
    expect(graph.nodes.root!.children.length).toBe(1);
    expect(graph.nodes.a!.label).toBe('Alpha improved');
    expect(droppedIds).toContain('b');
    expect(graph.contentHash).toMatch(/^[0-9a-f]+$/);
  });
});

describe('heuristicEnrichOutline', () => {
  test('collapses single-child same label', () => {
    const source = sample();
    const outline = heuristicEnrichOutline(source);
    const alpha = outline.find((n) => n.label === 'Alpha');
    expect(alpha).toBeDefined();
    expect(alpha!.children?.some((c) => c.label === 'Alpha')).toBeFalsy();
    expect(outline.some((n) => n.label === 'Beta')).toBe(true);
  });
});

describe('buildEnrichPrompt', () => {
  test('includes labels', () => {
    const p = buildEnrichPrompt(sample());
    expect(p).toContain('Alpha');
    expect(p).toContain('Beta');
    expect(p).toContain('Return ONLY JSON');
  });
});
