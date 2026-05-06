import { atom } from 'jotai'

export interface EditorTab {
  id: string
  type: 'file'
  filePath: string
  content: string
}

export const editorTabsAtom = atom<EditorTab[]>([])

export const activeTabIdAtom = atom<string | null>(null)

export const hasOpenTabsAtom = atom((get) => get(editorTabsAtom).length > 0)

/** Open a file tab. If a tab for filePath already exists, focus it; otherwise load + append. */
export const openFileTabAtom = atom(null, async (get, set, filePath: string) => {
  const tabs = get(editorTabsAtom)
  const existing = tabs.find((t) => t.filePath === filePath)
  if (existing) {
    set(activeTabIdAtom, existing.id)
    return
  }
  const content = await window.electronAPI.readFile(filePath)
  const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  set(editorTabsAtom, [...tabs, { id, type: 'file', filePath, content }])
  set(activeTabIdAtom, id)
})

/** Returns true only when prev is true and next is false (agent turn just ended). */
export function detectTurnEnd(prev: boolean, next: boolean): boolean {
  return prev && !next
}

/** Re-reads the content of all open file tabs from disk and updates the atom. */
export const refreshAllTabsAtom = atom(null, async (get, set) => {
  const tabs = get(editorTabsAtom)
  if (tabs.length === 0) return
  const refreshed = await Promise.all(
    tabs.map(async (tab) => {
      const content = await window.electronAPI.readFile(tab.filePath)
      return { ...tab, content }
    })
  )
  set(editorTabsAtom, refreshed)
})

/** Close a tab by ID. If it was active, focus the nearest remaining tab. */
export const closeTabAtom = atom(null, (get, set, tabId: string) => {
  const tabs = get(editorTabsAtom)
  const activeId = get(activeTabIdAtom)
  const index = tabs.findIndex((t) => t.id === tabId)
  const remaining = tabs.filter((t) => t.id !== tabId)
  set(editorTabsAtom, remaining)

  if (activeId === tabId) {
    if (remaining.length === 0) {
      set(activeTabIdAtom, null)
    } else {
      const nextIndex = Math.min(index, remaining.length - 1)
      set(activeTabIdAtom, remaining[nextIndex].id)
    }
  }
})
