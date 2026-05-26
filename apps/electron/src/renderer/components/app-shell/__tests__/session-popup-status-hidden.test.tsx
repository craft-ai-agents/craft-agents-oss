import { describe, expect, mock, test } from 'bun:test'
import '../../../__tests__/mock-i18n'
import { setupI18n } from '@craft-agent/shared/i18n'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'

import type { SessionMeta } from '@/atoms/sessions'
import { SessionListProvider, type SessionListContextValue } from '@/context/SessionListContext'

setupI18n([initReactI18next])

const navigateMock = mock(() => {})
let latestEntityRowMouseDown: ((event: React.MouseEvent) => void) | undefined

mock.module('@/lib/navigate', () => ({
  navigate: navigateMock,
  routes: {
    view: {
      allSessions: (sessionId?: string) => sessionId ? `allSessions/session/${sessionId}` : 'allSessions',
    },
  },
}))

mock.module('@/components/ui/menu-context', () => ({
  useMenuComponents: () => ({
    MenuItem: ({
      children,
      variant,
    }: {
      children: React.ReactNode
      variant?: string
    }) => <div data-menu-item={variant ?? 'default'}>{children}</div>,
    Separator: () => <hr />,
    Sub: ({ children }: { children: React.ReactNode }) => <section data-sub>{children}</section>,
    SubTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
    SubContent: ({ children }: { children: React.ReactNode }) => <div data-sub-content>{children}</div>,
  }),
}))

mock.module('@/components/ui/drawer', () => ({
  Drawer: ({ children }: { children: React.ReactNode }) => <div data-drawer>{children}</div>,
  DrawerTrigger: ({ children }: { children: React.ReactNode }) => <div data-drawer-trigger>{children}</div>,
  DrawerContent: ({ children }: { children: React.ReactNode }) => <div data-drawer-content>{children}</div>,
  DrawerHeader: ({ children }: { children: React.ReactNode }) => <div data-drawer-header>{children}</div>,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

mock.module('@/hooks/useSessionMenuActions', () => ({
  useSessionMenuActions: () => ({
    appliedLabelIds: new Set<string>(),
    toggleLabel: () => {},
    share: () => {},
    showInFinder: () => {},
    copyPath: () => {},
    refreshTitle: () => {},
    openSharedInBrowser: () => {},
    copySharedLink: () => {},
    updateShare: () => {},
    revokeShare: () => {},
  }),
}))

mock.module('@/context/AppShellContext', () => ({
  useAppShellContext: () => ({
    workspaces: [],
    isCompactMode: false,
  }),
}))

mock.module('@/context/ThemeContext', () => ({
  useTheme: () => ({ isDark: false }),
}))

mock.module('@craft-agent/ui', () => ({
  Spinner: () => <span data-testid="spinner" />,
}))

mock.module('@/components/messaging/MessagingSessionMenuItem', () => ({
  useMessagingConnect: () => () => {},
}))

mock.module('@/actions', () => ({
  useActionLabel: () => ({ hotkey: 'Cmd+G' }),
}))

mock.module('@/components/ui/entity-row', () => ({
  EntityRow: ({
    icon,
    title,
    menuContent,
    onMouseDown,
  }: {
    icon?: React.ReactNode
    title?: React.ReactNode
    menuContent?: React.ReactNode
    onMouseDown?: (event: React.MouseEvent) => void
  }) => {
    latestEntityRowMouseDown = onMouseDown
    return <article>
      <div data-slot="icon">{icon}</div>
      <div data-slot="title">{title}</div>
      <div data-slot="menu">{menuContent}</div>
    </article>
  },
}))

const { SessionMenu } = await import('../SessionMenu')
const { CompactSessionMenu } = await import('../CompactSessionMenu')
const { SessionItem } = await import('../SessionItem')

function StatusDot(_props: { bare?: boolean }) {
  return <span>status-dot</span>
}

function DoneDot(_props: { bare?: boolean }) {
  return <span>done-dot</span>
}

function session(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'session-1',
    name: 'Session One',
    sessionStatus: 'in-progress',
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    lastMessageAt: undefined,
    isArchived: false,
    isFlagged: false,
    labels: [],
    messages: [],
    ...overrides,
  } as SessionMeta
}

const sessionStatuses = [
  {
    id: 'in-progress',
    label: 'In Progress',
    resolvedColor: 'var(--success)',
    icon: <StatusDot />,
    iconColorable: true,
  },
  {
    id: 'done',
    label: 'Done',
    resolvedColor: 'var(--muted)',
    icon: <DoneDot />,
    iconColorable: true,
  },
]

function menuProps() {
  return {
    item: session(),
    onRename: () => {},
    onFlag: () => {},
    onUnflag: () => {},
    onArchive: () => {},
    onUnarchive: () => {},
    onMarkUnread: () => {},
    onOpenInNewWindow: () => {},
    onDelete: async () => true,
  }
}

function listContext(): SessionListContextValue {
  return {
    onRenameClick: () => {},
    onSessionStatusChange: () => {},
    onFlag: () => {},
    onUnflag: () => {},
    onArchive: () => {},
    onUnarchive: () => {},
    onMarkUnread: () => {},
    onDelete: async () => true,
    onSelectSessionById: () => {},
    onOpenInNewWindow: () => {},
    onFocusZone: () => {},
    onKeyDown: () => {},
    sessionStatuses,
    isMultiSelectActive: false,
    contentSearchResults: new Map(),
  }
}

function renderSessionItemWithContext(contextOverrides: Partial<SessionListContextValue> = {}) {
  latestEntityRowMouseDown = undefined
  renderToStaticMarkup(
    <SessionListProvider value={{ ...listContext(), ...contextOverrides }}>
      <SessionItem
        item={session()}
        index={0}
        itemProps={{ onKeyDown: () => {} }}
        isSelected={false}
        isFirstInGroup
        isInMultiSelect={false}
        onSelect={() => {}}
      />
    </SessionListProvider>,
  )
}

function dispatchSessionItemMouseDown(event: Partial<React.MouseEvent>) {
  expect(latestEntityRowMouseDown).toBeDefined()
  latestEntityRowMouseDown!(event as React.MouseEvent)
}

describe('session popup status controls', () => {
  test('omits the workflow status submenu from the shared session menu', () => {
    const html = renderToStaticMarkup(<SessionMenu {...menuProps()} />)

    expect(html).not.toContain('Status')
    expect(html).not.toContain('In Progress')
    expect(html).not.toContain('Done')
    expect(html).toContain('Rename')
    expect(html).toContain('Archive')
    expect(html).toContain('Open in New Window')
    expect(html).toContain('Delete')
  })

  test('omits open in new panel from the shared session menu', () => {
    const html = renderToStaticMarkup(<SessionMenu {...menuProps()} />)

    expect(html).not.toContain('Open in New Panel')
    expect(html).toContain('Open in New Window')
  })

  test('omits open in new panel from the compact session menu', () => {
    const html = renderToStaticMarkup(
      <CompactSessionMenu
        title="Session One"
        item={session()}
        sessionStatuses={sessionStatuses}
        onRename={() => {}}
        onFlag={() => {}}
        onUnflag={() => {}}
        onArchive={() => {}}
        onUnarchive={() => {}}
        onMarkUnread={() => {}}
        onSessionStatusChange={() => {}}
        onOpenInNewWindow={() => {}}
        onDelete={() => {}}
      />,
    )

    expect(html).not.toContain('Open in New Panel')
    expect(html).toContain('Open in New Window')
  })

  test('omits the clickable status picker button from the session list row', () => {
    const html = renderToStaticMarkup(
      <SessionListProvider value={listContext()}>
        <SessionItem
          item={session()}
          index={0}
          itemProps={{ onKeyDown: () => {} }}
          isSelected={false}
          isFirstInGroup
          isInMultiSelect={false}
          onSelect={() => {}}
        />
      </SessionListProvider>,
    )

    expect(html).not.toContain('Change todo state')
    expect(html).not.toContain('aria-haspopup="menu"')
    expect(html).not.toContain('status-dot')
    expect(html).toContain('Session One')
  })

  test('opens a session in a new window on Cmd+Shift+Click without pushing a panel', () => {
    const openInNewWindow = mock(() => {})
    const preventDefault = mock(() => {})

    navigateMock.mockClear()
    renderSessionItemWithContext({ onOpenInNewWindow: openInNewWindow })

    dispatchSessionItemMouseDown({
      button: 0,
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      preventDefault,
    } as unknown as React.MouseEvent)

    expect(preventDefault).toHaveBeenCalled()
    expect(openInNewWindow).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }))
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
