import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as storage from '@/lib/local-storage'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { RightSidebarPanel } from '../RightSidebarPanel'

// Minimal localStorage shim for tests
function makeLocalStorage() {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
  } as Storage
}

describe('RightSidebarPanel persistence', () => {
  const originalLocalStorage = globalThis.localStorage

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeLocalStorage(),
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    })
  })

  it('rightSidebarVisible key exists in storage.KEYS', () => {
    expect(storage.KEYS.rightSidebarVisible).toBe('right-sidebar-visible')
  })

  it('rightSidebarWidth key exists in storage.KEYS', () => {
    expect(storage.KEYS.rightSidebarWidth).toBe('right-sidebar-width')
  })

  it('defaults to true (open) when no value stored', () => {
    const workspaceId = 'ws-1'
    const isOpen = storage.get(storage.KEYS.rightSidebarVisible, true, workspaceId)
    expect(isOpen).toBe(true)
  })

  it('defaults to false when stored as false', () => {
    const workspaceId = 'ws-2'
    storage.set(storage.KEYS.rightSidebarVisible, false, workspaceId)
    const isOpen = storage.get(storage.KEYS.rightSidebarVisible, true, workspaceId)
    expect(isOpen).toBe(false)
  })

  it('persists and restores width per workspace', () => {
    storage.set(storage.KEYS.rightSidebarWidth, 320, 'ws-a')
    storage.set(storage.KEYS.rightSidebarWidth, 200, 'ws-b')
    expect(storage.get(storage.KEYS.rightSidebarWidth, 260, 'ws-a')).toBe(320)
    expect(storage.get(storage.KEYS.rightSidebarWidth, 260, 'ws-b')).toBe(200)
  })

  it('visibility is isolated per workspace', () => {
    storage.set(storage.KEYS.rightSidebarVisible, false, 'ws-x')
    // ws-y has no value, should fall back to default
    expect(storage.get(storage.KEYS.rightSidebarVisible, true, 'ws-y')).toBe(true)
    expect(storage.get(storage.KEYS.rightSidebarVisible, true, 'ws-x')).toBe(false)
  })

  it('uses the craft- prefix in the actual storage key', () => {
    storage.set(storage.KEYS.rightSidebarVisible, true, 'ws-z')
    const raw = globalThis.localStorage.getItem('craft-right-sidebar-visible:ws-z')
    expect(raw).toBe('true')
  })
})

describe('RightSidebarPanel collapsed layout', () => {
  const originalLocalStorage = globalThis.localStorage
  const appShellValue = {
    workspaces: [{ id: 'ws-1', rootPath: '/workspace' }],
    activeWorkspaceId: 'ws-1',
  } as AppShellContextType

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeLocalStorage(),
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    })
  })

  function renderPanel(isOpen: boolean) {
    return renderToStaticMarkup(
      createElement(
        AppShellProvider,
        { value: appShellValue },
        createElement(RightSidebarPanel, {
          workspaceId: 'ws-1',
          isOpen,
        })
      )
    )
  }

  it('renders total width as 0px when controlled closed', () => {
    const markup = renderPanel(false)

    expect(markup).toContain('width:0')
    expect(markup).not.toContain('title="Files"')
    expect(markup).not.toContain('title="Git"')
    expect(markup).not.toContain('title="Workspace"')
  })

  it('renders total width as content width plus tab strip width when controlled open', () => {
    storage.set(storage.KEYS.rightSidebarWidth, 320, 'ws-1')

    const markup = renderPanel(true)

    expect(markup).toContain('width:356')
    expect(markup).toContain('width:36')
  })

  it('does not render the old internal collapse button when controlled closed', () => {
    const markup = renderPanel(false)

    expect(markup).not.toContain('Collapse sidebar')
    expect(markup).not.toContain('Expand sidebar')
  })

  it('does not render the old internal collapse button when controlled open', () => {
    const markup = renderPanel(true)

    expect(markup).not.toContain('Collapse sidebar')
    expect(markup).not.toContain('Expand sidebar')
  })

  it('renders Files, Git, and Workspace tab icon buttons when controlled open', () => {
    const markup = renderPanel(true)

    expect(markup).toContain('title="Files"')
    expect(markup).toContain('title="Git"')
    expect(markup).toContain('title="Workspace"')
  })
})
