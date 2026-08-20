import { describe, expect, test } from 'bun:test';
import { deriveKnowledgeMindMap } from '../derive-knowledge.ts';
import type { KnowledgeRef } from '../../knowledge/refs.ts';

const docRef: KnowledgeRef = {
  scheme: 'siyuan',
  kind: 'document',
  id: 'doc-1',
};

describe('deriveKnowledgeMindMap', () => {
  test('prefers children tree when non-empty', () => {
    const graph = deriveKnowledgeMindMap({
      ref: docRef,
      title: 'Handbook',
      content: '# Would be ignored',
      children: [
        {
          blockId: 'b1',
          content: 'Parent block',
          children: [{ blockId: 'b2', content: 'Child block\nmore' }],
        },
      ],
    });

    expect(graph.derivation).toBe('knowledge');
    expect(graph.entity).toEqual({ type: 'knowledge', ref: docRef });
    expect(graph.nodes.root!.children).toEqual(['block:b1']);
    expect(graph.nodes['block:b1']!.kind).toBe('block');
    expect(graph.nodes['block:b1']!.children).toEqual(['block:b2']);
    expect(graph.nodes['block:b2']!.label).toBe('Child block');
    // content outline not used when children present
    expect(graph.nodes['heading:0']).toBeUndefined();
  });

  test('falls back to outline(content) when no children', () => {
    const graph = deriveKnowledgeMindMap({
      ref: docRef,
      title: 'Doc',
      content: `# Top
## Nested
`,
    });

    expect(graph.nodes.root!.children).toEqual(['heading:0']);
    expect(graph.nodes['heading:0']!.children).toEqual(['heading:1']);
  });

  test('no children and no headings → section:body', () => {
    const graph = deriveKnowledgeMindMap({
      ref: docRef,
      title: 'Plain',
      content: 'just text',
    });
    expect(graph.nodes['section:body']!.label).toBe('just text');
  });

  test('backlinks secondary under root', () => {
    const graph = deriveKnowledgeMindMap({
      ref: docRef,
      title: 'Doc',
      children: [{ blockId: 'b1', content: 'x' }],
      backlinks: [
        {
          ref: { kind: 'document', id: 'doc-2' },
          title: 'Sibling',
        },
      ],
    });

    expect(graph.nodes.root!.children).toContain('backlink:document:doc-2');
    expect(graph.nodes['backlink:document:doc-2']!.label).toBe('Sibling');
    expect(graph.edges.some((e) => e.kind === 'backlink' && e.to === 'backlink:document:doc-2')).toBe(
      true,
    );
  });
});
