import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { Window } from 'happy-dom'
import * as React from 'react'
import type { LlmConnectionWithStatus } from '@craft-agent/shared/config'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

const DropdownTestContext = React.createContext<{
  open: boolean
  setOpen: (open: boolean) => void
} | null>(null)

mock.module('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children, onOpenChange }: { children: React.ReactNode; onOpenChange?: (open: boolean) => void }) => {
    const [open, setOpenState] = React.useState(false)
    const setOpen = (nextOpen: boolean) => {
      setOpenState(nextOpen)
      onOpenChange?.(nextOpen)
    }
    return (
      <DropdownTestContext.Provider value={{ open, setOpen }}>
        {children}
      </DropdownTestContext.Provider>
    )
  },
  DropdownMenuTrigger: ({ children }: { children: React.ReactElement }) => {
    const ctx = React.useContext(DropdownTestContext)
    return React.cloneElement(children, {
      'aria-expanded': ctx?.open ?? false,
      onClick: () => ctx?.setOpen(true),
      onPointerDown: () => ctx?.setOpen(true),
    })
  },
}))

mock.module('@/components/ui/styled-dropdown', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  StyledDropdownMenuContent: ({ children }: { children: React.ReactNode }) => {
    const ctx = React.useContext(DropdownTestContext)
    return ctx?.open ? <div role="menu">{children}</div> : null
  },
  StyledDropdownMenuItem: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick}>{children}</button>
  ),
  StyledDropdownMenuSeparator: () => <hr />,
  StyledDropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StyledDropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

Object.assign(globalThis, {
  DOMMatrix: class DOMMatrix {},
  ImageData: class ImageData {},
  Path2D: class Path2D {},
})

const { ConnectionRow, sortLlmConnectionsForSettings } = await import('../AiSettingsPage')

afterAll(() => {
  mock.restore()
})

function setupDom() {
  const window = new Window()
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
    Element: window.Element,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    PointerEvent: window.PointerEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    navigator: window.navigator,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
  })
  Object.assign(window, {
    SyntaxError,
    electronAPI: {
      getPiProviderBaseUrl: async () => undefined,
    },
  })
}

beforeEach(() => {
  setupDom()
})

afterEach(() => {
  cleanup()
})

function connection(overrides: Partial<LlmConnectionWithStatus>): LlmConnectionWithStatus {
  return {
    slug: 'anthropic-api',
    name: 'Anthropic',
    providerType: 'anthropic',
    authType: 'api_key',
    createdAt: 1,
    isAuthenticated: true,
    isDefault: false,
    ...overrides,
  }
}

function getText(view: ReturnType<typeof render>, fallbackKey: string, ...translated: string[]) {
  for (const label of translated) {
    const element = view.queryByText(label)
    if (element) return element
  }
  return view.queryByText(fallbackKey)
}

describe('Settings AI environment connection', () => {
  it('pins environment connections before defaults and named connections', () => {
    const sorted = sortLlmConnectionsForSettings([
      connection({ slug: 'z-custom', name: 'Z Custom' }),
      connection({ slug: 'default-api', name: 'Default API', isDefault: true }),
      connection({
        slug: 'env-provider',
        name: 'Environment',
        providerType: 'pi_compat',
        authType: 'none',
        baseUrl: 'https://env.example.test/v1',
        isDefault: true,
        isEnvironmentConnection: true,
      }),
    ])

    expect(sorted.map((item) => item.slug)).toEqual(['env-provider', 'default-api', 'z-custom'])
  })

  it('shows Validate Connection and Mid-stream submenu in the environment connection action menu', async () => {
    const onSetMidStreamBehavior = mock(() => {})
    const view = render(
      <ConnectionRow
        connection={connection({
          slug: 'env-provider',
          name: 'Environment',
          providerType: 'pi_compat',
          authType: 'none',
          baseUrl: 'https://env.example.test/v1',
          isDefault: true,
          isEnvironmentConnection: true,
          midStreamBehavior: 'queue',
        })}
        isLastConnection={false}
        onRenameClick={() => {}}
        onDelete={() => {}}
        onSetDefault={() => {}}
        onValidate={() => {}}
        onEdit={() => {}}
        onSetMidStreamBehavior={onSetMidStreamBehavior}
        validationState="idle"
      />,
    )

    expect(view.getByText((content) => content.includes('env.example.test'))).toBeTruthy()
    expect(getText(view, 'common.builtIn', 'Built-in', 'Built in')).toBeTruthy()
    expect(view.getAllByText('Environment')).toHaveLength(1)

    fireEvent.pointerDown(view.getByRole('button'), { button: 0, ctrlKey: false })

    await waitFor(() => {
      expect(getText(view, 'settings.ai.validateConnection', 'Validate Connection')).toBeTruthy()
    })
    expect(getText(view, 'settings.ai.midStream.title', 'Mid-stream behavior', 'Mid-stream sends')).toBeTruthy()
    expect(getText(view, 'settings.ai.midStream.steer', 'Steer', 'Steer immediately')).toBeTruthy()
    expect(getText(view, 'settings.ai.midStream.queue', 'Queue', 'Queue until ready')).toBeTruthy()
    expect(view.container.querySelectorAll('svg.lucide-check')).toHaveLength(1)

    fireEvent.click(getText(view, 'settings.ai.midStream.steer', 'Steer', 'Steer immediately')!)
    expect(onSetMidStreamBehavior).toHaveBeenCalledWith('steer')

    expect(getText(view, 'common.rename', 'Rename')).toBeNull()
    expect(getText(view, 'common.edit', 'Edit')).toBeNull()
    expect(getText(view, 'common.delete', 'Delete')).toBeNull()
    expect(getText(view, 'settings.ai.setAsDefault', 'Set as Default')).toBeNull()
  })
})
