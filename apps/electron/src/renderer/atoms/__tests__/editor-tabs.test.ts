import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createStore } from 'jotai'
import {
  editorTabsAtom,
  activeTabIdAtom,
  hasOpenTabsAtom,
  openFileTabAtom,
  closeTabAtom,
  refreshAllTabsAtom,
  detectTurnEnd,
  type EditorTab,
} from '../editor-tabs'

function makeStore() {
  return createStore()
}

function seedTabs(store: ReturnType<typeof createStore>, tabs: EditorTab[]) {
  store.set(editorTabsAtom, tabs)
  if (tabs.length > 0) store.set(activeTabIdAtom, tabs[0].id)
}

const originalWindow = globalThis.window

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: {
      electronAPI: {
        readFile: async (path: string) => `content of ${path}`,
      },
    },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: originalWindow,
    writable: true,
    configurable: true,
  })
})

describe('editor-tabs atoms', () => {

  it('starts with empty tabs list', () => {
    const store = makeStore()
    expect(store.get(editorTabsAtom)).toEqual([])
  })

  it('hasOpenTabs is false for empty list', () => {
    const store = makeStore()
    expect(store.get(hasOpenTabsAtom)).toBe(false)
  })

  it('hasOpenTabs is true when tabs exist', () => {
    const store = makeStore()
    seedTabs(store, [{ id: 't1', type: 'file', filePath: '/foo.ts', content: 'x' }])
    expect(store.get(hasOpenTabsAtom)).toBe(true)
  })

  it('opening a new path adds a tab', async () => {
    const store = makeStore()
    await store.set(openFileTabAtom, '/src/index.ts')
    const tabs = store.get(editorTabsAtom)
    expect(tabs).toHaveLength(1)
    expect(tabs[0].filePath).toBe('/src/index.ts')
    expect(tabs[0].content).toBe('content of /src/index.ts')
    expect(tabs[0].type).toBe('file')
  })

  it('opening a new path sets it as active', async () => {
    const store = makeStore()
    await store.set(openFileTabAtom, '/src/index.ts')
    const tabs = store.get(editorTabsAtom)
    expect(store.get(activeTabIdAtom)).toBe(tabs[0].id)
  })

  it('opening a duplicate path focuses the existing tab without duplicating', async () => {
    const store = makeStore()
    await store.set(openFileTabAtom, '/src/index.ts')
    const firstId = store.get(activeTabIdAtom)
    // Open a second different file so active changes
    await store.set(openFileTabAtom, '/src/other.ts')
    expect(store.get(editorTabsAtom)).toHaveLength(2)
    // Re-open the first path
    await store.set(openFileTabAtom, '/src/index.ts')
    expect(store.get(editorTabsAtom)).toHaveLength(2)
    expect(store.get(activeTabIdAtom)).toBe(firstId)
  })

  it('closing the last tab results in an empty list', () => {
    const store = makeStore()
    seedTabs(store, [{ id: 't1', type: 'file', filePath: '/foo.ts', content: 'x' }])
    store.set(closeTabAtom, 't1')
    expect(store.get(editorTabsAtom)).toEqual([])
  })

  it('closing the last tab sets activeTabId to null', () => {
    const store = makeStore()
    seedTabs(store, [{ id: 't1', type: 'file', filePath: '/foo.ts', content: 'x' }])
    store.set(closeTabAtom, 't1')
    expect(store.get(activeTabIdAtom)).toBeNull()
  })

  it('closing active tab focuses the next tab', () => {
    const store = makeStore()
    seedTabs(store, [
      { id: 't1', type: 'file', filePath: '/a.ts', content: 'a' },
      { id: 't2', type: 'file', filePath: '/b.ts', content: 'b' },
    ])
    store.set(closeTabAtom, 't1')
    expect(store.get(editorTabsAtom)).toHaveLength(1)
    expect(store.get(activeTabIdAtom)).toBe('t2')
  })

  it('closing active last tab focuses the previous tab', () => {
    const store = makeStore()
    seedTabs(store, [
      { id: 't1', type: 'file', filePath: '/a.ts', content: 'a' },
      { id: 't2', type: 'file', filePath: '/b.ts', content: 'b' },
    ])
    store.set(activeTabIdAtom, 't2')
    store.set(closeTabAtom, 't2')
    expect(store.get(activeTabIdAtom)).toBe('t1')
  })

  it('closing non-active tab does not change active tab', () => {
    const store = makeStore()
    seedTabs(store, [
      { id: 't1', type: 'file', filePath: '/a.ts', content: 'a' },
      { id: 't2', type: 'file', filePath: '/b.ts', content: 'b' },
    ])
    store.set(activeTabIdAtom, 't2')
    store.set(closeTabAtom, 't1')
    expect(store.get(activeTabIdAtom)).toBe('t2')
    expect(store.get(editorTabsAtom)).toHaveLength(1)
  })
})

describe('detectTurnEnd', () => {
  it('returns true when transitioning from true to false', () => {
    expect(detectTurnEnd(true, false)).toBe(true)
  })

  it('returns false when false to false', () => {
    expect(detectTurnEnd(false, false)).toBe(false)
  })

  it('returns false when true to true', () => {
    expect(detectTurnEnd(true, true)).toBe(false)
  })

  it('returns false when false to true', () => {
    expect(detectTurnEnd(false, true)).toBe(false)
  })

  it('fires callback exactly twice on sequence [true, false, true, false]', () => {
    const values = [true, false, true, false]
    let count = 0
    let prev = false
    for (const next of values) {
      if (detectTurnEnd(prev, next)) count++
      prev = next
    }
    expect(count).toBe(2)
  })
})

describe('refreshAllTabsAtom', () => {
  it('updates all tab contents from disk', async () => {
    const store = makeStore()
    seedTabs(store, [
      { id: 't1', type: 'file', filePath: '/foo.ts', content: 'old' },
      { id: 't2', type: 'file', filePath: '/bar.ts', content: 'also old' },
    ])
    await store.set(refreshAllTabsAtom)
    const tabs = store.get(editorTabsAtom)
    expect(tabs[0].content).toBe('content of /foo.ts')
    expect(tabs[1].content).toBe('content of /bar.ts')
  })

  it('does nothing when no tabs are open', async () => {
    const store = makeStore()
    await store.set(refreshAllTabsAtom)
    expect(store.get(editorTabsAtom)).toEqual([])
  })
})
