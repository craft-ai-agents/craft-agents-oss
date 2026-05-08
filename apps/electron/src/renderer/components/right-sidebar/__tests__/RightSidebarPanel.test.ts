import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as storage from '@/lib/local-storage'
import { getWorkspaceFilesCwdPath } from '../RightSidebarPanel'

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

describe('getWorkspaceFilesCwdPath', () => {
  it('returns the focused session working directory when it is inside the workspace', () => {
    expect(getWorkspaceFilesCwdPath('/workspace/src', '/workspace')).toBe('/workspace/src')
  })

  it('falls back when the focused session working directory is not a valid CWD root', () => {
    expect(getWorkspaceFilesCwdPath('/other/src', '/workspace')).toBeUndefined()
    expect(getWorkspaceFilesCwdPath('none', '/workspace')).toBeUndefined()
    expect(getWorkspaceFilesCwdPath(undefined, '/workspace')).toBeUndefined()
  })
})
