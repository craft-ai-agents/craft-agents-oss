import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sessionListSource = readFileSync(
  join(import.meta.dir, '../SessionList.tsx'),
  'utf8',
)

const entityListSource = readFileSync(
  join(import.meta.dir, '../../ui/entity-list.tsx'),
  'utf8',
)

const appShellSource = readFileSync(
  join(import.meta.dir, '../AppShell.tsx'),
  'utf8',
)

describe('SessionList height behavior', () => {
  test('threads auto height behavior through EntityList without flex-filling the internal scroll area', () => {
    expect(sessionListSource).toContain("heightBehavior = 'fill'")
    expect(sessionListSource).toContain('heightBehavior={heightBehavior}')
    expect(sessionListSource).toContain('heightBehavior === \'fill\' && \'flex-1\'')

    expect(entityListSource).toContain("heightBehavior = 'fill'")
    expect(entityListSource).toContain('heightBehavior === \'fill\' && \'flex-1\'')
    expect(entityListSource).toContain("<ScrollArea className={cn(heightBehavior === 'fill' && 'flex-1'")

    expect(appShellSource).toContain("renderSessionList(\n    'all-sessions-sidebar',")
    expect(appShellSource).toContain("    'auto',")
  })
})
