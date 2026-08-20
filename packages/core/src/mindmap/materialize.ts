/**
 * Materialize a MindMapGraph as portable markdown (outline).
 * Used to save a pin/enriched map as a Craft note (approach B).
 */

import type { MindMapEntityRef, MindMapGraph, MindMapNodeId } from './types.ts';

export interface MaterializeMarkdownOptions {
  /** Include YAML frontmatter with provenance (default true). */
  frontmatter?: boolean;
  /** ISO timestamp override. */
  nowIso?: string;
  /** Max depth to emit (default unlimited). */
  maxDepth?: number;
}

function entityProvenance(entity: MindMapEntityRef): Record<string, string> {
  if (entity.type === 'session') {
    return { 'craft-source-type': 'session', 'craft-source-id': entity.sessionId };
  }
  if (entity.type === 'note') {
    return { 'craft-source-type': 'note', 'craft-source-id': entity.noteId };
  }
  return {
    'craft-source-type': 'knowledge',
    'craft-source-kind': entity.ref.kind,
    'craft-source-id': entity.ref.id,
  };
}

/**
 * Convert graph to ATX markdown outline.
 * Root label → H1; children → nested headings (capped at H6).
 */
export function graphToMarkdown(
  graph: MindMapGraph,
  opts: MaterializeMarkdownOptions = {},
): string {
  const withFm = opts.frontmatter !== false;
  const maxDepth = opts.maxDepth ?? 100;
  const lines: string[] = [];

  if (withFm) {
    const now = opts.nowIso ?? new Date().toISOString();
    const prov = entityProvenance(graph.entity);
    lines.push('---');
    lines.push('craft-mindmap: true');
    lines.push(`craft-content-hash: ${graph.contentHash}`);
    lines.push(`craft-derivation: ${graph.derivation}`);
    lines.push(`craft-materialized-at: ${now}`);
    for (const [k, v] of Object.entries(prov)) {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
    lines.push('---');
    lines.push('');
  }

  const root = graph.nodes[graph.rootId];
  const title = root?.label?.trim() || 'Mind map';
  lines.push(`# ${title}`);
  lines.push('');

  const walk = (id: MindMapNodeId, depth: number) => {
    if (depth > maxDepth) return;
    const node = graph.nodes[id];
    if (!node) return;
    if (id !== graph.rootId) {
      const level = Math.min(6, Math.max(2, depth + 1)); // depth1 → ## 
      const hashes = '#'.repeat(level);
      lines.push(`${hashes} ${node.label.trim() || id}`);
      if (node.source) {
        lines.push('');
        lines.push(`<!-- source:${node.source.kind}:${node.source.id} -->`);
      }
      lines.push('');
    }
    for (const child of node.children) {
      walk(child, depth + 1);
    }
  };

  walk(graph.rootId, 0);

  // trim trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  lines.push('');
  return lines.join('\n');
}

/** Suggested note title for materialize. */
export function materializeNoteTitle(graph: MindMapGraph): string {
  const base = graph.nodes[graph.rootId]?.label?.trim() || 'Mind map';
  const cleaned = base.replace(/[\\/]/g, '-').slice(0, 80);
  return `Map: ${cleaned}`;
}

/** Suggested folder under notes/ for maps. */
export const MINDMAP_NOTES_FOLDER = 'mindmaps';
