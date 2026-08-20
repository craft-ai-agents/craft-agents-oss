/**
 * parseOutline — extract ATX headings from SiYuan document markdown, feeding the
 * KnowledgeInspector OUTLINE section. Deliberately dependency-free (contract W2-INSP):
 * no markdown library is pulled in for a heading index. Not a full CommonMark parser —
 * setext headings and container-aware constructs are out of scope for an outline list.
 */

export interface OutlineHeading {
  /** Heading depth 1–6, from the length of the leading `#` run. */
  level: 1 | 2 | 3 | 4 | 5 | 6
  /** Heading text with the closing hash run stripped and ends trimmed. */
  text: string
  /** 0-based source line number — doubles as a stable React key. */
  line: number
}

/** `#`…`######`, at least one space, title, optional closing hash run (CommonMark ATX). */
const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/

/** Opening/closing fence marker: ``` or ~~~ (with optional info string). */
const FENCE_RE = /^[ \t]*(```+|~~~)/

/** Hard cap so very long documents stay cheap to index and render. */
export const MAX_OUTLINE_HEADINGS = 100

export function parseOutline(markdown: string, maxHeadings = MAX_OUTLINE_HEADINGS): OutlineHeading[] {
  const headings: OutlineHeading[] = []
  let inFence = false
  const lines = markdown.split('\n')
  for (let line = 0; line < lines.length && headings.length < maxHeadings; line++) {
    const text = lines[line]
    if (FENCE_RE.test(text)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = HEADING_RE.exec(text)
    if (!match) continue
    const title = match[2].trim()
    if (!title) continue
    headings.push({ level: match[1].length as OutlineHeading['level'], text: title, line })
  }
  return headings
}
