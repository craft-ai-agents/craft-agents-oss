import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShellSource = readFileSync(join(__dirname, '../AppShell.tsx'), 'utf8')
const navDestinationsSource = readFileSync(join(__dirname, '../nav-destinations.ts'), 'utf8')
const workspaceRailSource = readFileSync(join(__dirname, '../WorkspaceIconRail.tsx'), 'utf8')
const notesPageSource = readFileSync(join(__dirname, '../../../pages/NotesPage.tsx'), 'utf8')

describe('local Notes entry points', () => {
  it('wires the primary shell sidebar and keyboard navigation to Notes', () => {
    const keyboardItems = appShellSource.slice(
      appShellSource.indexOf('const unifiedSidebarItems'),
      appShellSource.indexOf('// Toggle folder'),
    )
    const primaryLinks = appShellSource.slice(
      appShellSource.indexOf('id: "nav:projects"'),
      appShellSource.indexOf('// --- Separator before footer ---'),
    )

    expect(keyboardItems).toContain("result.push({ id: 'nav:notes', type: 'nav', action: handleNotesClick })")
    expect(keyboardItems).not.toContain("result.push({ id: 'nav:knowledge'")
    expect(primaryLinks).toContain('id: "nav:notes"')
    expect(primaryLinks).toContain('onClick: handleNotesClick')
    expect(primaryLinks).not.toContain('id: "nav:knowledge"')
  })

  it('uses the canonical local Notes route from both rail entry points', () => {
    const notesDestination = navDestinationsSource.slice(
      navDestinationsSource.indexOf("id: 'notes'"),
      navDestinationsSource.indexOf("id: 'automations'"),
    )
    const notesRailLink = workspaceRailSource.slice(
      workspaceRailSource.indexOf('if (link.kind === "notes")'),
      workspaceRailSource.indexOf('const url'),
    )

    expect(notesDestination).toContain('route: () => routes.view.notes()')
    expect(notesDestination).toContain('isActive: isNotesNavigation')
    expect(notesRailLink).toContain('navigate(routes.view.notes());')
    expect(notesRailLink).not.toContain('navigate(routes.view.knowledge());')
  })

  it('loads the local Markdown Notes surface without a knowledge-engine API', () => {
    expect(notesPageSource).toContain('window.electronAPI.listNotes(activeWorkspaceId)')
    expect(notesPageSource).not.toContain('window.electronAPI.knowledge')
  })
})
