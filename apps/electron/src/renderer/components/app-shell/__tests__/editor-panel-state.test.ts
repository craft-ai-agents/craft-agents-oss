import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import * as storage from '@/lib/local-storage'
import {
  loadEditorPanelOpenPreference,
  persistEditorPanelOpenPreference,
} from '../editor-panel-state'

function makeLocalStorage() {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
  } as Storage
}

describe('editor panel AppShell state', () => {
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

  test('editorPanelVisible key exists in storage.KEYS', () => {
    expect(storage.KEYS.editorPanelVisible).toBe('editor-panel-visible')
  })

  test('loads and persists the open preference per workspace using the editorPanelVisible key', () => {
    persistEditorPanelOpenPreference(false, 'ws-a')
    persistEditorPanelOpenPreference(true, 'ws-b')

    expect(loadEditorPanelOpenPreference('ws-a')).toBe(false)
    expect(loadEditorPanelOpenPreference('ws-b')).toBe(true)
    expect(globalThis.localStorage.getItem('craft-editor-panel-visible:ws-a')).toBe('false')
  })

  test('defaults to true (open) when no value stored', () => {
    expect(loadEditorPanelOpenPreference('ws-new')).toBe(true)
  })

  test('visibility is isolated per workspace', () => {
    persistEditorPanelOpenPreference(false, 'ws-x')
    expect(loadEditorPanelOpenPreference('ws-y')).toBe(true)
    expect(loadEditorPanelOpenPreference('ws-x')).toBe(false)
  })
})
