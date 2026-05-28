import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const editorDetailPanelSource = readFileSync(
  join(import.meta.dir, '../EditorDetailPanel.tsx'),
  'utf8',
)

describe('EditorDetailPanel isOpen prop', () => {
  test('accepts isOpen prop in its exported interface', () => {
    expect(editorDetailPanelSource).toContain('isOpen')
  })

  test('returns null when isOpen is false', () => {
    expect(editorDetailPanelSource).toContain('if (!isOpen)')
  })
})

function getEditorPanelOuterMotionDiv() {
  const match = editorDetailPanelSource.match(
    /<motion\.div\s+key="editor-panel"([\s\S]*?)>\s*<div/,
  )

  expect(match).not.toBeNull()
  return match?.[1] ?? ''
}

describe('EditorDetailPanel layout', () => {
  test('lets flex stretch size the outer panel while preserving vertical overflow spacing', () => {
    const outerMotionDiv = getEditorPanelOuterMotionDiv()
    const className = outerMotionDiv.match(/className="([^"]+)"/)?.[1] ?? ''
    const classes = className.split(/\s+/)

    expect(classes).toContain('shrink-0')
    expect(classes).toContain('flex')
    expect(classes).not.toContain('h-full')
    expect(outerMotionDiv).toContain('paddingBlock: PANEL_STACK_VERTICAL_OVERFLOW')
    expect(outerMotionDiv).toContain('marginBlock: -PANEL_STACK_VERTICAL_OVERFLOW')
    expect(outerMotionDiv).toContain('marginBottom: -6')
    expect(outerMotionDiv).toContain('paddingBottom: 6')
  })
})
