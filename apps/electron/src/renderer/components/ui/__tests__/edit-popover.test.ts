import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const editPopoverSource = readFileSync(
  join(import.meta.dir, '../EditPopover.tsx'),
  'utf8',
)

describe('EditPopover layering', () => {
  test('renders its popover content above dialogs and modal overlays', () => {
    expect(editPopoverSource).toContain("zIndex: 'var(--z-floating-menu)'")
  })
})
