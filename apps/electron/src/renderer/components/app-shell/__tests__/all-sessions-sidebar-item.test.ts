import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAllSessionsSidebarItem } from '../all-sessions-sidebar-item'

const appShellSource = readFileSync(
  join(import.meta.dir, '../AppShell.tsx'),
  'utf8',
)

describe('createAllSessionsSidebarItem', () => {
  test('builds an expandable nav item that embeds the session list content', () => {
    const onClick = () => {}
    const onToggle = () => {}
    const expandedContent = 'embedded-session-list'

    const item = createAllSessionsSidebarItem({
      title: 'All Sessions',
      label: '3',
      isActive: true,
      onClick,
      isExpanded: true,
      onToggle,
      expandedContent,
      contextMenu: { type: 'allSessions' },
    })

    expect(item).toMatchObject({
      id: 'nav:allSessions',
      title: 'All Sessions',
      label: '3',
      variant: 'default',
      onClick,
      expandable: true,
      expanded: true,
      onToggle,
      expandedContent,
      contextMenu: { type: 'allSessions' },
    })
    expect(item).not.toHaveProperty('items')
    expect(item).not.toHaveProperty('sortable')
  })

  test('AppShell defaults All Sessions to expanded and persists collapse per workspace', () => {
    expect(appShellSource).toContain("const isAllSessionsExpanded = isExpanded('nav:allSessions')")
    expect(appShellSource).toContain("const saved = storage.get<string[] | null>(storage.KEYS.collapsedSidebarItems, null)")
    expect(appShellSource).toContain('storage.KEYS.collapsedSidebarItems, null, activeWorkspaceId')
    expect(appShellSource).toContain("storage.set(storage.KEYS.collapsedSidebarItems, [...collapsedItems], activeWorkspaceId)")
    expect(appShellSource).toContain("onToggle: () => toggleExpanded('nav:allSessions')")
  })

  test('AppShell reuses the full SessionList contract inside the All Sessions row', () => {
    const embeddedListStart = appShellSource.indexOf('const allSessionsList = (')
    const embeddedListEnd = appShellSource.indexOf('const sessionListContent =', embeddedListStart)
    const embeddedListSource = appShellSource.slice(embeddedListStart, embeddedListEnd)

    expect(embeddedListSource).toContain('<SessionList')
    expect(embeddedListSource).toContain('onDelete={handleDeleteSession}')
    expect(embeddedListSource).toContain('onArchive={onArchiveSession}')
    expect(embeddedListSource).toContain('onMarkUnread={onMarkSessionUnread}')
    expect(embeddedListSource).toContain('onSearchChange={setSearchQuery}')
    expect(embeddedListSource).toContain('sessionStatuses={effectiveSessionStatuses}')
    expect(embeddedListSource).toContain('workspaceId={activeWorkspaceId ?? undefined}')
    expect(embeddedListSource).toContain('focusedSessionId={sessionListFocusedSessionId}')
  })

  test('AppShell keeps All Sessions click navigation separate from the chevron toggle', () => {
    expect(appShellSource).toContain('const handleAllSessionsClick = useCallback(() => {')
    expect(appShellSource).toContain('navigate(routes.view.allSessions())')
    expect(appShellSource).toContain('onClick: handleAllSessionsClick')
  })
})
