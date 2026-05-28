import { atom } from 'jotai'
import type { GitCommit } from '../../shared/types'

interface FileEditorTab {
  id: string
  type: 'file'
  filePath: string
  content: string
}

interface GitWorkingTreeDiffTab {
  id: string
  type: 'git-diff'
  filePath: string
  patch: string
}

interface GitCommitDetailTab {
  id: string
  type: 'git-commit'
  hash: string
  commit: GitCommit
}

/** Open editor tab variants shown in the editor detail panel. */
export type EditorTab = FileEditorTab | GitWorkingTreeDiffTab | GitCommitDetailTab

/** Ordered list of open editor tabs. */
export const editorTabsAtom = atom<EditorTab[]>([])

/** ID of the focused editor tab, or null when no tabs are open. */
export const activeTabIdAtom = atom<string | null>(null)

/** True when the editor panel has at least one tab to display. */
export const hasOpenTabsAtom = atom((get) => get(editorTabsAtom).length > 0)

function createTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Opens a file tab, focusing the existing tab when filePath is already open. */
export const openFileTabAtom = atom(null, async (get, set, filePath: string) => {
  const tabs = get(editorTabsAtom)
  const existing = tabs.find((t) => t.type === 'file' && t.filePath === filePath)
  if (existing) {
    set(activeTabIdAtom, existing.id)
    return
  }
  const content = await window.electronAPI.readFile(filePath)
  const id = createTabId()
  set(editorTabsAtom, [...tabs, { id, type: 'file', filePath, content }])
  set(activeTabIdAtom, id)
})

/** Returns true only when prev is true and next is false (agent turn just ended). */
export function detectTurnEnd(prev: boolean, next: boolean): boolean {
  return prev && !next
}

/**
 * Returns paths that appeared after the session file watcher has a baseline.
 * A null previous set means the watcher has not been primed yet, so the
 * current file list becomes the baseline without opening editor tabs.
 */
export function getNewSessionFilePaths(previous: ReadonlySet<string> | null, current: readonly string[]): string[] {
  if (!previous) return []
  return current.filter((path) => !previous.has(path))
}

/** Re-reads the content of all open file tabs from disk and updates the atom. */
export const refreshAllTabsAtom = atom(null, async (get, set) => {
  const tabs = get(editorTabsAtom)
  if (tabs.length === 0) return
  const refreshed = await Promise.all(
    tabs.map(async (tab) => {
      if (tab.type !== 'file') return tab
      const content = await window.electronAPI.readFile(tab.filePath)
      return { ...tab, content }
    })
  )
  set(editorTabsAtom, refreshed)
})

/** Opens a working-tree diff tab, focusing the existing tab when filePath is already open. */
export const openWorkingTreeDiffTabAtom = atom(
  null,
  async (get, set, { workspacePath, filePath }: { workspacePath: string; filePath: string }) => {
    const tabs = get(editorTabsAtom)
    const existing = tabs.find((t) => t.type === 'git-diff' && t.filePath === filePath)
    if (existing) {
      set(activeTabIdAtom, existing.id)
      return
    }

    const patch = await window.electronAPI.getGitFileDiff(workspacePath, filePath)
    const id = createTabId()
    set(editorTabsAtom, [...tabs, { id, type: 'git-diff', filePath, patch }])
    set(activeTabIdAtom, id)
  }
)

/** Opens a commit detail tab, focusing the existing tab when hash is already open. */
export const openCommitTabAtom = atom(
  null,
  async (get, set, { workspacePath, hash }: { workspacePath: string; hash: string }) => {
    const tabs = get(editorTabsAtom)
    const existing = tabs.find((t) => t.type === 'git-commit' && t.hash === hash)
    if (existing) {
      set(activeTabIdAtom, existing.id)
      return
    }

    const commit = await window.electronAPI.getGitCommitDetail(workspacePath, hash)
    if (!commit) return

    const id = createTabId()
    set(editorTabsAtom, [...tabs, { id, type: 'git-commit', hash, commit }])
    set(activeTabIdAtom, id)
  }
)

/** Closes a tab and focuses the nearest remaining tab when the active tab was closed. */
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
