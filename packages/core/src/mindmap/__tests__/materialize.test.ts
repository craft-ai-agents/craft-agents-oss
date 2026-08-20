import { describe, expect, test } from 'bun:test'
import { addChild, createEmptyGraph, finalizeGraph } from '../graph.ts'
import { graphToMarkdown, materializeNoteTitle, MINDMAP_NOTES_FOLDER } from '../materialize.ts'

function sample() {
  const g = createEmptyGraph({ type: 'session', sessionId: 's1' }, 'Research')
  addChild(g, g.rootId, { id: 't1', label: 'Turn one', kind: 'turn', source: { kind: 'message', id: 'm1' } })
  addChild(g, 't1', { id: 'a1', label: 'Answer', kind: 'assistant' })
  addChild(g, g.rootId, { id: 't2', label: 'Turn two', kind: 'turn' })
  return finalizeGraph(g, 'session')
}

describe('graphToMarkdown', () => {
  test('emits H1 root and nested headings with frontmatter', () => {
    const md = graphToMarkdown(sample(), { nowIso: '2026-08-08T00:00:00.000Z' })
    expect(md).toContain('craft-mindmap: true')
    expect(md).toContain('craft-source-type: "session"')
    expect(md).toContain('craft-source-id: "s1"')
    expect(md).toContain('# Research')
    expect(md).toContain('## Turn one')
    expect(md).toContain('### Answer')
    expect(md).toContain('## Turn two')
    expect(md).toContain('<!-- source:message:m1 -->')
  })

  test('can omit frontmatter', () => {
    const md = graphToMarkdown(sample(), { frontmatter: false })
    expect(md.startsWith('# Research')).toBe(true)
    expect(md).not.toContain('craft-mindmap')
  })
})

describe('materializeNoteTitle', () => {
  test('prefixes Map:', () => {
    expect(materializeNoteTitle(sample())).toBe('Map: Research')
    expect(MINDMAP_NOTES_FOLDER).toBe('mindmaps')
  })
})
