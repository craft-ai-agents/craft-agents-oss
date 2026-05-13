import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShellSource = readFileSync(
  join(import.meta.dir, '../AppShell.tsx'),
  'utf8',
)

describe('AppShell skills sidebar navigation', () => {
  test('renders local skills and marketplace as flat top-level sidebar items', () => {
    expect(appShellSource).not.toContain("id: 'nav:skills'")
    expect(appShellSource).not.toContain('id: "nav:skills"')

    expect(appShellSource).toContain("result.push({ id: 'nav:local-skills'")
    expect(appShellSource).toContain("result.push({ id: 'nav:marketplace'")

    expect(appShellSource).toContain('id: "nav:local-skills"')
    expect(appShellSource).toContain('title: t("sidebar.skills")')
    expect(appShellSource).toContain('variant: isLocalSkillsNav ? "default" : "ghost"')

    expect(appShellSource).toContain('id: "nav:marketplace"')
    expect(appShellSource).toContain('title: t("sidebar.marketplace")')
    expect(appShellSource).toContain('variant: isSkillMarketplaceNav ? "default" : "ghost"')
  })

  test('does not render marketplace in the middle navigator panel', () => {
    const contentStart = appShellSource.indexOf('{isSourcesNavigation(navState) && (')
    const contentEnd = appShellSource.indexOf('{isSettingsNavigation(navState) && (', contentStart)

    expect(contentStart).toBeGreaterThan(-1)
    expect(contentEnd).toBeGreaterThan(contentStart)

    const navigatorContentSource = appShellSource.slice(contentStart, contentEnd)
    expect(navigatorContentSource).toContain('{isLocalSkillsNav && activeWorkspaceId && (')
    expect(navigatorContentSource).not.toContain('isSkillMarketplaceNav')
  })
})
