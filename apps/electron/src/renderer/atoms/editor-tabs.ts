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
