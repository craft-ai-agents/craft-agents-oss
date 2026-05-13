import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function readSibling(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

describe('FreeFormInput label menu integration', () => {
  test('does not wire the inline # label menu into the freeform input path', () => {
    const freeFormInput = readSibling('../FreeFormInput.tsx')
    const chatInputZone = readSibling('../ChatInputZone.tsx')

    expect(freeFormInput).not.toContain('useInlineLabelMenu')
    expect(freeFormInput).not.toContain('InlineLabelMenu')
    expect(freeFormInput).not.toContain('onLabelAdd')
    expect(chatInputZone).not.toContain('onLabelAdd')
  })
})
