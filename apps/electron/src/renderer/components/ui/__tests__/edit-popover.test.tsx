import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { Window } from 'happy-dom'
import type * as React from 'react'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { EscapeInterruptProvider } from '@/context/EscapeInterruptContext'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))
mock.module(
  new URL('../../app-shell/ChatDisplay.tsx', import.meta.url).pathname,
  () => ({
    ChatDisplay: () => <div data-testid="chat-display" />,
  }),
)
mock.module(new URL('../popover.tsx', import.meta.url).pathname, () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({
    children,
    style,
  }: {
    children: React.ReactNode
    style?: React.CSSProperties
  }) => (
    <div data-slot="popover-content" style={style}>
      {children}
    </div>
  ),
}))

Object.assign(globalThis, {
  DOMMatrix: class DOMMatrix {},
  ImageData: class ImageData {},
  Path2D: class Path2D {},
})

const { EditPopover } = await import('../EditPopover')

function setupDom() {
  const window = new Window()
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    navigator: window.navigator,
  })
  Object.assign(window, {
    SyntaxError,
  })
}

function appShellContext(): AppShellContextType {
  return {
    workspaces: [],
    activeWorkspaceId: null,
    pendingPermissions: new Map(),
    pendingCredentials: new Map(),
    onCreateSession: async () => {
      throw new Error('Unexpected session creation in EditPopover layering test')
    },
    onSendMessage: () => {},
  } as AppShellContextType
}

beforeEach(() => {
  setupDom()
})

afterEach(() => {
  cleanup()
})

describe('EditPopover layering', () => {
  test('renders its popover content above dialogs and modal overlays', () => {
    render(
      <AppShellProvider value={appShellContext()}>
        <EscapeInterruptProvider>
          <EditPopover
            trigger={<button type="button">Open AI Assist</button>}
            context={{ label: 'Add Skill', filePath: '/workspace/skills' }}
          />
        </EscapeInterruptProvider>
      </AppShellProvider>,
    )

    const popoverContent = document.querySelector<HTMLElement>('[data-slot="popover-content"]')

    expect(popoverContent?.style.zIndex).toBe('var(--z-floating-menu)')
  })
})
