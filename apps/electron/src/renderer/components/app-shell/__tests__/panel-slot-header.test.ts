import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const panelSlotSource = readFileSync(
  join(import.meta.dir, '../PanelSlot.tsx'),
  'utf8',
)

describe('PanelSlot header actions', () => {
  test('does not inject a close button into the panel header', () => {
    expect(panelSlotSource).not.toContain('rightSidebarButton: closeButton')
    expect(panelSlotSource).not.toContain('const closeButton')
    expect(panelSlotSource).not.toContain('icon={<X')
  })

  test('keeps the compact back button as the leading header action', () => {
    expect(panelSlotSource).toContain('leadingAction: backButton')
    expect(panelSlotSource).toContain('icon={<ChevronLeft')
  })
})
