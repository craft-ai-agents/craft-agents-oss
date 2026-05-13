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

const panelStackContainerSource = readFileSync(
  join(import.meta.dir, '../PanelStackContainer.tsx'),
  'utf8',
)

const panelSlotSource = readFileSync(
  join(import.meta.dir, '../PanelSlot.tsx'),
  'utf8',
)

function expectClassNameToInclude(source: string, pattern: RegExp, className: string) {
  const match = source.match(pattern)

  expect(match?.[1].split(/\s+/)).toContain(className)
}

function expectCnBlockToInclude(source: string, pattern: RegExp, className: string) {
  const match = source.match(pattern)
  const classes = Array.from(match?.[1].matchAll(/'([^']+)'/g) ?? [])
    .flatMap(([, classList]) => classList.split(/\s+/))

  expect(classes).toContain(className)
}

describe('Level 1 frame surfaces', () => {
  test('uses bg-foreground-5 on the outer shell, icon strip sidebar, and TopBar', () => {
    expectClassNameToInclude(appShellSource, /ref=\{shellRef\}\s+className="([^"]+)"/, 'bg-foreground-5')
    expectClassNameToInclude(appShellSource, /data-focus-zone="sidebar"[\s\S]*?<div className="([^"]+)"/, 'bg-foreground-5')
    expectClassNameToInclude(topBarSource, /return \(\s+<div\s+className="([^"]+)"/, 'bg-foreground-5')
  })
})

describe('Level 2 panel surfaces', () => {
  test('uses bg-background on navigator slot and bg-foreground-3 on content panel slots', () => {
    expectCnBlockToInclude(
      panelStackContainerSource,
      /data-panel-role="navigator"[\s\S]*?className=\{cn\(([\s\S]*?)\)\}/,
      'bg-background',
    )
    expectCnBlockToInclude(
      panelSlotSource,
      /data-panel-role="content"[\s\S]*?className=\{cn\(([\s\S]*?)\)\}/,
      'bg-foreground-3',
    )
  })
})
