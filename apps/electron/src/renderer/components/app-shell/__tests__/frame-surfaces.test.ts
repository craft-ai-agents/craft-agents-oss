import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShellSource = readFileSync(
  join(import.meta.dir, '../AppShell.tsx'),
  'utf8',
)

const sessionListSource = readFileSync(
  join(import.meta.dir, '../SessionList.tsx'),
  'utf8',
)

const entityListSource = readFileSync(
  join(import.meta.dir, '../../ui/entity-list.tsx'),
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

  test('reserves sidebar scroll gutter before All Sessions expansion overflows', () => {
    expectClassNameToInclude(
      appShellSource,
      /Primary Nav: All Sessions[\s\S]*?<div className="([^"]+)"/,
      '[scrollbar-gutter:stable]',
    )
  })

  test('keeps the embedded All Sessions list flush with an outer scroll boundary', () => {
    const match = appShellSource.match(
      /createAllSessionsSidebarItem\(\{[\s\S]*?expandedContent:\s*\(\s*<div className="([^"]+)"/,
    )
    const classes = match?.[1].split(/\s+/) ?? []

    expect(classes).toContain('overflow-y-auto')
    expect(classes).toContain('max-h-[min(560px,calc(100vh-150px))]')
    expect(classes).not.toContain('overflow-hidden')
    expect(classes).not.toContain('h-[min(560px,calc(100vh-150px))]')
    expect(classes).not.toContain('min-h-[260px]')
    expect(classes).not.toContain('rounded-[6px]')
    expect(classes).not.toContain('bg-background/70')
  })

  test('renders the embedded All Sessions list with auto height so the wrapper owns overflow', () => {
    expect(appShellSource).toMatch(
      /<SessionList[\s\S]*key=\{key\}[\s\S]*heightBehavior=\{heightBehavior\}[\s\S]*const allSessionsList = renderSessionList\(\s*'all-sessions-sidebar',[\s\S]*'auto',\s*\)/,
    )
  })

  test('keeps fill-parent layout as the SessionList default while auto mode uses natural height', () => {
    expect(sessionListSource).toMatch(/heightBehavior = 'fill'/)
    expect(sessionListSource).toMatch(
      /<div className=\{cn\('flex flex-col min-h-0', heightBehavior === 'fill' && 'flex-1'\)\}>/,
    )
    expect(entityListSource).toMatch(/heightBehavior = 'fill'/)
    expect(entityListSource).toMatch(
      /<ScrollArea className=\{cn\(heightBehavior === 'fill' && 'flex-1', scrollAreaClassName\)\}/,
    )
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
