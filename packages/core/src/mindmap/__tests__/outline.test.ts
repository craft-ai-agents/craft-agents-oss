import { describe, expect, test } from 'bun:test';
import { createEmptyGraph, finalizeGraph } from '../graph.ts';
import { headingsToTree, parseOutlineHeadings } from '../outline.ts';

describe('parseOutlineHeadings', () => {
  test('parses nested H1/H2/H3', () => {
    const md = `# Alpha
intro
## Beta
### Gamma
## Delta
`;
    const headings = parseOutlineHeadings(md);
    expect(headings).toEqual([
      { level: 1, text: 'Alpha', line: 0 },
      { level: 2, text: 'Beta', line: 2 },
      { level: 3, text: 'Gamma', line: 3 },
      { level: 2, text: 'Delta', line: 4 },
    ]);
  });

  test('ignores headings inside fenced code blocks', () => {
    const md = `# Real
\`\`\`md
# Fake
\`\`\`
## Also real
~~~
# Still fake
~~~
`;
    const headings = parseOutlineHeadings(md);
    expect(headings.map((h) => h.text)).toEqual(['Real', 'Also real']);
  });

  test('strips trailing hash run', () => {
    const headings = parseOutlineHeadings('## Title ##\n');
    expect(headings[0]).toEqual({ level: 2, text: 'Title', line: 0 });
  });

  test('skips empty title headings', () => {
    expect(parseOutlineHeadings('#\n# \n##   \n')).toEqual([]);
  });
});

describe('headingsToTree', () => {
  test('nests by level stack with heading:<line> ids', () => {
    const graph = createEmptyGraph({ type: 'note', noteId: 'n1' }, 'Doc');
    const headings = parseOutlineHeadings(`# A
## B
### C
## D
# E
`);
    const ids = headingsToTree(graph, headings, graph.rootId);
    expect(ids).toEqual(['heading:0', 'heading:1', 'heading:2', 'heading:3', 'heading:4']);

    const root = graph.nodes.root!;
    expect(root.children).toEqual(['heading:0', 'heading:4']);
    expect(graph.nodes['heading:0']!.children).toEqual(['heading:1', 'heading:3']);
    expect(graph.nodes['heading:1']!.children).toEqual(['heading:2']);
    expect(graph.nodes['heading:2']!.parentId).toBe('heading:1');
    expect(graph.edges.filter((e) => e.kind === 'parent')).toHaveLength(5);

    finalizeGraph(graph, 'note');
    expect(graph.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
