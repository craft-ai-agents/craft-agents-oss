import { describe, it, expect } from 'bun:test'
import { createStore } from 'jotai'
import {
  lineCommentQueueAtom,
  addLineCommentAtom,
  clearLineCommentsAtom,
  formatLineCommentsMessage,
  type LineComment,
} from '../line-comments'

function makeStore() {
  return createStore()
}

describe('line-comments atoms', () => {
  it('starts with empty queue', () => {
    const store = makeStore()
    expect(store.get(lineCommentQueueAtom)).toEqual([])
  })

  it('addLineComment appends to the queue', () => {
    const store = makeStore()
    const comment: LineComment = {
      filePath: '/src/foo.ts',
      lineNumber: 5,
      lineContent: 'const x = 1',
      text: 'rename this variable',
    }
    store.set(addLineCommentAtom, comment)
    expect(store.get(lineCommentQueueAtom)).toHaveLength(1)
    expect(store.get(lineCommentQueueAtom)[0]).toEqual(comment)
  })

  it('addLineComment appends multiple comments in order', () => {
    const store = makeStore()
    const c1: LineComment = { filePath: '/a.ts', lineNumber: 1, lineContent: 'a', text: 'first' }
    const c2: LineComment = { filePath: '/b.ts', lineNumber: 2, lineContent: 'b', text: 'second' }
    store.set(addLineCommentAtom, c1)
    store.set(addLineCommentAtom, c2)
    const q = store.get(lineCommentQueueAtom)
    expect(q).toHaveLength(2)
    expect(q[0]).toEqual(c1)
    expect(q[1]).toEqual(c2)
  })

  it('clearLineComments empties the queue', () => {
    const store = makeStore()
    store.set(addLineCommentAtom, { filePath: '/a.ts', lineNumber: 1, lineContent: 'a', text: 'x' })
    store.set(clearLineCommentsAtom)
    expect(store.get(lineCommentQueueAtom)).toEqual([])
  })
})

describe('formatLineCommentsMessage', () => {
  it('groups comments by file and formats them correctly', () => {
    const comments: LineComment[] = [
      { filePath: '/src/foo.ts', lineNumber: 10, lineContent: 'const x = 1', text: 'rename this' },
      { filePath: '/src/bar.ts', lineNumber: 3, lineContent: 'import React from', text: 'remove unused import' },
      { filePath: '/src/foo.ts', lineNumber: 25, lineContent: 'return null', text: 'handle error case' },
    ]
    const result = formatLineCommentsMessage(comments)

    // Both files should appear as headers
    expect(result).toContain('/src/foo.ts')
    expect(result).toContain('/src/bar.ts')

    // Line numbers should appear
    expect(result).toContain('10')
    expect(result).toContain('3')
    expect(result).toContain('25')

    // Line content (as code snippet) should appear
    expect(result).toContain('const x = 1')
    expect(result).toContain('import React from')
    expect(result).toContain('return null')

    // Comment text should appear
    expect(result).toContain('rename this')
    expect(result).toContain('remove unused import')
    expect(result).toContain('handle error case')

    // foo.ts should appear before bar.ts (first-seen order)
    expect(result.indexOf('/src/foo.ts')).toBeLessThan(result.indexOf('/src/bar.ts'))
  })

  it('returns empty string for empty array', () => {
    expect(formatLineCommentsMessage([])).toBe('')
  })

  it('handles a single comment', () => {
    const comments: LineComment[] = [
      { filePath: '/app.ts', lineNumber: 7, lineContent: 'export default App', text: 'add JSDoc' },
    ]
    const result = formatLineCommentsMessage(comments)
    expect(result).toContain('/app.ts')
    expect(result).toContain('7')
    expect(result).toContain('export default App')
    expect(result).toContain('add JSDoc')
  })
})
