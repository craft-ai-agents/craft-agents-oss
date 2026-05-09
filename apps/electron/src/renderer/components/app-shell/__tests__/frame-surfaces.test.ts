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

function expectClassNameToInclude(source: string, pattern: RegExp, className: string) {
  const match = source.match(pattern)

  expect(match?.[1].split(/\s+/)).toContain(className)
}

describe('Level 1 frame surfaces', () => {
  test('uses bg-foreground-5 on the outer shell, icon strip sidebar, and TopBar', () => {
    expectClassNameToInclude(appShellSource, /ref=\{shellRef\}\s+className="([^"]+)"/, 'bg-foreground-5')
    expectClassNameToInclude(appShellSource, /\) : \(\s+<div className="([^"]+)"/, 'bg-foreground-5')
    expectClassNameToInclude(topBarSource, /return \(\s+<div\s+className="([^"]+)"/, 'bg-foreground-5')
  })
})
