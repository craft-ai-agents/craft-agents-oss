import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShellPath = join(__dirname, '../AppShell.tsx')

describe('Notes shell navigation', () => {
  const source = readFileSync(appShellPath, 'utf8')

  it('opens the workspace-local Notes surface instead of a knowledge provider', () => {
    const handler = source.slice(
      source.indexOf('const handleNotesClick'),
      source.indexOf('// Handlers for automations view'),
    )

    expect(handler).toContain('navigate(routes.view.notes())')
    expect(handler).not.toContain('navigate(routes.view.knowledge())')
  })
})
