import type { KnowledgeRef } from '../knowledge/refs.ts';
import { addChild, addEdge, createEmptyGraph, finalizeGraph, truncateLabel } from './graph.ts';
import { headingsToTree, parseOutlineHeadings } from './outline.ts';
import type { MindMapGraph } from './types.ts';

export interface MindMapKnowledgeChild {
  blockId: string;
  content: string;
  children?: MindMapKnowledgeChild[];
}

export interface MindMapKnowledgeBacklink {
  ref: { kind: string; id: string } | KnowledgeRef;
  title: string;
}

export interface MindMapKnowledgeInput {
  ref: KnowledgeRef;
  title: string;
  content?: string;
  children?: MindMapKnowledgeChild[];
  backlinks?: MindMapKnowledgeBacklink[];
}

function attachChildren(
  graph: MindMapGraph,
  parentId: string,
  children: MindMapKnowledgeChild[],
): void {
  for (const child of children) {
    const id = `block:${child.blockId}`;
    addChild(graph, parentId, {
      id,
      label: truncateLabel(child.content || child.blockId),
      kind: 'block',
      source: { kind: 'block', id: child.blockId },
    });
    if (child.children?.length) {
      attachChildren(graph, id, child.children);
    }
  }
}

function backlinkNodeId(bl: MindMapKnowledgeBacklink): string {
  const ref = bl.ref as { kind: string; id: string; scheme?: string };
  return `backlink:${ref.kind}:${ref.id}`;
}

export function deriveKnowledgeMindMap(input: MindMapKnowledgeInput): MindMapGraph {
  const rootLabel = input.title.trim() || 'Knowledge';
  const graph = createEmptyGraph({ type: 'knowledge', ref: input.ref }, rootLabel);

  if (input.children && input.children.length > 0) {
    attachChildren(graph, graph.rootId, input.children);
  } else if (input.content && input.content.trim()) {
    const headings = parseOutlineHeadings(input.content);
    if (headings.length > 0) {
      headingsToTree(graph, headings, graph.rootId);
    } else {
      addChild(graph, graph.rootId, {
        id: 'section:body',
        label: truncateLabel(input.content, 120),
        kind: 'section',
        source: { kind: 'section', id: 'body' },
      });
    }
  }

  for (const bl of input.backlinks ?? []) {
    const id = backlinkNodeId(bl);
    const ref = bl.ref as { kind: string; id: string };
    addChild(graph, graph.rootId, {
      id,
      label: bl.title.trim() || ref.id,
      kind: 'backlink',
      source: { kind: ref.kind, id: ref.id },
    });
    addEdge(graph, graph.rootId, id, 'backlink');
  }

  return finalizeGraph(graph, 'knowledge');
}
