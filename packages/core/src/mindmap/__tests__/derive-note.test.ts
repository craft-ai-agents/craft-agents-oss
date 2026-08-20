import { describe, expect, test } from 'bun:test';
import { deriveNoteMindMap } from '../derive-note.ts';

describe('deriveNoteMindMap', () => {
  test('builds outline tree from headings', () => {
    const graph = deriveNoteMindMap({
      noteId: 'n1',
      title: 'Specs',
      markdown: `# Intro
## Details
body
# Outro
`,
    });

    expect(graph.derivation).toBe('note');
    expect(graph.entity).toEqual({ type: 'note', noteId: 'n1' });
    expect(graph.nodes.root!.label).toBe('Specs');
    expect(graph.nodes.root!.children).toEqual(['heading:0', 'heading:3']);
    expect(graph.nodes['heading:0']!.children).toEqual(['heading:1']);
    expect(graph.nodes['heading:1']!.label).toBe('Details');
  });

  test('no headings → section:body truncated', () => {
    const body = 'plain note without headings\nsecond line';
    const graph = deriveNoteMindMap({
      noteId: 'n2',
      title: 'Scratch',
      markdown: body,
    });

    expect(graph.nodes.root!.children).toEqual(['section:body']);
    expect(graph.nodes['section:body']!.kind).toBe('section');
    expect(graph.nodes['section:body']!.label).toBe('plain note without headings');
  });

  test('backlinks as backlink:<id> under root with backlink edge', () => {
    const graph = deriveNoteMindMap({
      noteId: 'n3',
      title: 'Main',
      markdown: '# Only',
      backlinks: [
        { id: 'other', title: 'Other note' },
        { id: 'x', title: '' },
      ],
    });

    expect(graph.nodes.root!.children).toContain('backlink:other');
    expect(graph.nodes['backlink:other']!.kind).toBe('backlink');
    expect(graph.nodes['backlink:other']!.label).toBe('Other note');
    expect(graph.nodes['backlink:x']!.label).toBe('x');

    const blEdges = graph.edges.filter((e) => e.kind === 'backlink');
    expect(blEdges.some((e) => e.to === 'backlink:other')).toBe(true);
  });
});
