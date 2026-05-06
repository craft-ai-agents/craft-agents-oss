import { atom } from 'jotai'

export interface LineComment {
  filePath: string
  lineNumber: number
  lineContent: string
  text: string
}

export const lineCommentQueueAtom = atom<LineComment[]>([])

export const addLineCommentAtom = atom(null, (get, set, comment: LineComment) => {
  set(lineCommentQueueAtom, [...get(lineCommentQueueAtom), comment])
})

export const clearLineCommentsAtom = atom(null, (_get, set) => {
  set(lineCommentQueueAtom, [])
})

/** Group comments by file and produce a structured prefix block. Returns '' for empty input. */
export function formatLineCommentsMessage(comments: LineComment[]): string {
  if (comments.length === 0) return ''

  const byFile = new Map<string, LineComment[]>()
  for (const c of comments) {
    const existing = byFile.get(c.filePath)
    if (existing) {
      existing.push(c)
    } else {
      byFile.set(c.filePath, [c])
    }
  }

  const sections: string[] = []
  for (const [filePath, fileComments] of byFile) {
    const lines = [`File: ${filePath}`]
    for (const c of fileComments) {
      lines.push(`  Line ${c.lineNumber}: \`${c.lineContent}\``)
      lines.push(`  Comment: ${c.text}`)
    }
    sections.push(lines.join('\n'))
  }

  return sections.join('\n\n')
}
