import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShellSource = readFileSync(
  join(import.meta.dir, '../AppShell.tsx'),
  'utf8',
)

describe('AppShell editor panel auto-show', () => {
  test('imports hasOpenTabsAtom from editor-tabs', () => {
    expect(appShellSource).toContain('hasOpenTabsAtom')
  })

  test('subscribes to hasOpenTabsAtom via useAtomValue', () => {
    expect(appShellSource).toContain('useAtomValue(hasOpenTabsAtom)')
  })

  test('tracks previous hasOpenTabs to detect false→true transition', () => {
    expect(appShellSource).toContain('prevHasOpenTabsRef')
  })

  test('auto-shows editor panel on false→true transition only when gate is active', () => {
    expect(appShellSource).toContain('isRightSidebarContextuallyAvailable')
    expect(appShellSource).toContain('setIsEditorPanelOpen(true)')
  })
})
