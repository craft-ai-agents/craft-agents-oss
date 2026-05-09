import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const topBarSource = readFileSync(
  join(import.meta.dir, '../TopBar.tsx'),
  'utf8',
)

describe('TopBar editor panel toggle', () => {
  test('accepts isEditorPanelToggleVisible prop', () => {
    expect(topBarSource).toContain('isEditorPanelToggleVisible')
  })

  test('accepts isEditorPanelOpen prop', () => {
    expect(topBarSource).toContain('isEditorPanelOpen')
  })

  test('accepts onEditorPanelToggle prop', () => {
    expect(topBarSource).toContain('onEditorPanelToggle')
  })

  test('renders SquareCode icon for the editor panel toggle', () => {
    expect(topBarSource).toContain('SquareCode')
  })

  test('gates the editor toggle button behind isEditorPanelToggleVisible', () => {
    expect(topBarSource).toContain('isEditorPanelToggleVisible &&')
  })
})
