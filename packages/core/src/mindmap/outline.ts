/**
 * Fence-safe ATX heading outline for mind-map derive.
 * Ported from apps/electron/.../outline-parser.ts (no markdown library).
 */

import { addChild } from './graph.ts';
import type { MindMapGraph, MindMapNodeId } from './types.ts';

export interface OutlineHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** 0-based source line number */
  line: number;
}

/** `#`…`######`, at least one space, title, optional closing hash run (CommonMark ATX). */
const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;

/** Opening/closing fence marker: ``` or ~~~ (with optional info string). */
const FENCE_RE = /^[ \t]*(```+|~~~)/;

/** Hard cap so very long documents stay cheap to index and render. */
export const MAX_OUTLINE_HEADINGS = 100;

export function parseOutlineHeadings(
  markdown: string,
  maxHeadings = MAX_OUTLINE_HEADINGS,
): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  let inFence = false;
  const lines = markdown.split('\n');
  for (let line = 0; line < lines.length && headings.length < maxHeadings; line++) {
    const text = lines[line] ?? '';
    if (FENCE_RE.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = HEADING_RE.exec(text);
    if (!match) continue;
    const title = (match[2] ?? '').trim();
    if (!title) continue;
    headings.push({
      level: match[1]!.length as OutlineHeading['level'],
      text: title,
      line,
    });
  }
  return headings;
}

/**
 * Attach heading nodes under rootId using a level stack.
 * Node ids: `heading:<line>`.
 */
export function headingsToTree(
  graph: MindMapGraph,
  headings: OutlineHeading[],
  rootId: MindMapNodeId,
): MindMapNodeId[] {
  const stack: Array<{ level: number; id: MindMapNodeId }> = [{ level: 0, id: rootId }];
  const ids: MindMapNodeId[] = [];

  for (const heading of headings) {
    while (stack.length > 1 && stack[stack.length - 1]!.level >= heading.level) {
      stack.pop();
    }
    const parentId = stack[stack.length - 1]!.id;
    const id: MindMapNodeId = `heading:${heading.line}`;
    addChild(graph, parentId, {
      id,
      label: heading.text,
      kind: 'heading',
      level: heading.level,
      source: { kind: 'heading', id: String(heading.line) },
      meta: { line: heading.line },
    });
    stack.push({ level: heading.level, id });
    ids.push(id);
  }
  return ids;
}
