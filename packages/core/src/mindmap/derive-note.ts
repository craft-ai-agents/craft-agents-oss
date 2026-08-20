import { addChild, addEdge, createEmptyGraph, finalizeGraph, truncateLabel } from './graph.ts';
import { headingsToTree, parseOutlineHeadings } from './outline.ts';
import type { MindMapGraph } from './types.ts';

export interface MindMapNoteBacklink {
  id: string;
  title: string;
}

export interface MindMapNoteInput {
  noteId: string;
  title: string;
  markdown: string;
  backlinks?: MindMapNoteBacklink[];
}

export function deriveNoteMindMap(input: MindMapNoteInput): MindMapGraph {
  const rootLabel = input.title.trim() || 'Note';
  const graph = createEmptyGraph({ type: 'note', noteId: input.noteId }, rootLabel);

  const headings = parseOutlineHeadings(input.markdown);
  if (headings.length > 0) {
    headingsToTree(graph, headings, graph.rootId);
  } else {
    const body = input.markdown.trim();
    if (body) {
      addChild(graph, graph.rootId, {
        id: 'section:body',
        label: truncateLabel(body, 120),
        kind: 'section',
        source: { kind: 'section', id: 'body' },
      });
    }
  }

  for (const bl of input.backlinks ?? []) {
    const id = `backlink:${bl.id}`;
    addChild(graph, graph.rootId, {
      id,
      label: bl.title.trim() || bl.id,
      kind: 'backlink',
      source: { kind: 'note', id: bl.id },
    });
    // Secondary edge kind for renderers that style backlinks distinctly.
    addEdge(graph, graph.rootId, id, 'backlink');
  }

  return finalizeGraph(graph, 'note');
}
