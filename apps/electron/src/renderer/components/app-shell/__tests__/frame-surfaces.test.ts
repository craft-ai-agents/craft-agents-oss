import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShellSource = readFileSync(
  join(import.meta.dir, '../AppShell.tsx'),
  'utf8',
)

const topBarSource = readFileSync(
  join(import.meta.dir, '../TopBar.tsx'),
  'utf8',
)

describe('Level 1 frame surfaces', () => {
  test('uses bg-foreground-5 on the outer shell, icon strip sidebar, and TopBar', () => {
    expect(appShellSource).toContain('className="flex items-stretch relative bg-foreground-5"')
    expect(appShellSource).toContain('className="flex h-full flex-col select-none bg-foreground-5"')
    expect(topBarSource).toContain('className="fixed top-0 left-0 right-0 h-[48px] z-panel titlebar-drag-region bg-foreground-5"')
  })
})
