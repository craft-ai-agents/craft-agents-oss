import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShellSource = readFileSync(
  join(import.meta.dir, '../AppShell.tsx'),
  'utf8',
)

function getEditorPanelAutoShowEffectSource() {
  const refIndex = appShellSource.indexOf('const prevHasOpenTabsRef')
  const effectStart = appShellSource.indexOf('useEffect(() => {', refIndex)
  const effectEnd = appShellSource.indexOf(
    'const isPanelStackRightSidebarVisible',
    effectStart,
  )

  expect(refIndex).toBeGreaterThan(-1)
  expect(effectStart).toBeGreaterThan(-1)
  expect(effectEnd).toBeGreaterThan(effectStart)

  return appShellSource.slice(effectStart, effectEnd)
}

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

  test('auto-shows editor panel on false→true transition independent of the render gate', () => {
    const effectSource = getEditorPanelAutoShowEffectSource()
    const dependencyList = effectSource.match(/\}, \[([^\]]*)\]\)/)?.[1]

    expect(effectSource).toContain('if (hasOpenTabs && !prevHasOpenTabsRef.current)')
    expect(effectSource).toContain('setIsEditorPanelOpen(true)')
    expect(dependencyList).toBe('hasOpenTabs')
    expect(effectSource).not.toContain('isRightSidebarContextuallyAvailable')
  })

  test('gates the rendered editor panel and top bar toggle behind session detail availability', () => {
    expect(appShellSource).toContain('isEditorPanelToggleVisible={isRightSidebarContextuallyAvailable}')
    expect(appShellSource).toContain('isRightSidebarContextuallyAvailable && (\n          <EditorDetailPanel')
  })
})
