import { describe, it, expect } from 'bun:test'
import type { Editor } from '@tiptap/core'
import { createSlashCommandItems, filterSlashCommandItems } from '../TiptapSlashMenu'

function createMockEditor() {
  const calls: string[] = []

  const chainApi = {
    focus: () => {
      calls.push('focus')
      return chainApi
    },
    setParagraph: () => {
      calls.push('setParagraph')
      return chainApi
    },
    toggleHeading: ({ level }: { level: number }) => {
      calls.push(`toggleHeading:${level}`)
      return chainApi
    },
    toggleBulletList: () => {
      calls.push('toggleBulletList')
      return chainApi
    },
    toggleOrderedList: () => {
      calls.push('toggleOrderedList')
      return chainApi
    },
    toggleBlockquote: () => {
      calls.push('toggleBlockquote')
      return chainApi
    },
    setHorizontalRule: () => {
      calls.push('setHorizontalRule')
      return chainApi
    },
    toggleCodeBlock: () => {
      calls.push('toggleCodeBlock')
      return chainApi
    },
    setCodeBlock: ({ language }: { language: string }) => {
      calls.push(`setCodeBlock:${language}`)
      return chainApi
    },
    run: () => {
      calls.push('run')
      return true
    },
  }

  const editor = {
    can: () => ({
      setCodeBlock: () => true,
    }),
    chain: () => chainApi,
  }

  return {
    editor: editor as unknown as Editor,
    calls,
  }
}

describe('tiptap slash menu', () => {
  it('filters by title, description, and aliases', () => {
    const { editor } = createMockEditor()
    const items = createSlashCommandItems(editor)

    expect(filterSlashCommandItems(items, 'heading').some((item) => item.id === 'heading-1')).toBe(true)
    expect(filterSlashCommandItems(items, 'divider').some((item) => item.id === 'horizontal-rule')).toBe(true)
    expect(filterSlashCommandItems(items, 'flow').some((item) => item.id === 'mermaid-code-block')).toBe(true)
  })

  it('returns all items for empty query and includes icons', () => {
    const { editor } = createMockEditor()
    const items = createSlashCommandItems(editor)
    const filtered = filterSlashCommandItems(items, '   ')

    expect(filtered.length).toBe(items.length)
    expect(filtered.every((item) => item.icon.length > 0)).toBe(true)
    expect(filtered.some((item) => (item as { group: string }).group === 'Visual')).toBe(false)
  })

  it('maps commands to expected chain calls', () => {
    const { editor, calls } = createMockEditor()
    const items = createSlashCommandItems(editor)

    const heading = items.find((item) => item.id === 'heading-1')
    heading?.run(editor)
    expect(calls.slice(-3)).toEqual(['focus', 'toggleHeading:1', 'run'])

    const mermaid = items.find((item) => item.id === 'mermaid-code-block')
    mermaid?.run(editor)
    expect(calls.slice(-3)).toEqual(['focus', 'setCodeBlock:mermaid', 'run'])
  })
})
