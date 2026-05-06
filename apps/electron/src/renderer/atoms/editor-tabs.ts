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

export type EditorTab = FileEditorTab | GitWorkingTreeDiffTab | GitCommitDetailTab

export const editorTabsAtom = atom<EditorTab[]>([])

export const activeTabIdAtom = atom<string | null>(null)

export const hasOpenTabsAtom = atom((get) => get(editorTabsAtom).length > 0)

/** Open a file tab. If a tab for filePath already exists, focus it; otherwise load + append. */
export const openFileTabAtom = atom(null, async (get, set, filePath: string) => {
  const tabs = get(editorTabsAtom)
  const existing = tabs.find((t) => t.type === 'file' && t.filePath === filePath)
  if (existing) {
    set(activeTabIdAtom, existing.id)
    return
  }
  const content = await window.electronAPI.readFile(filePath)
  const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  set(editorTabsAtom, [...tabs, { id, type: 'file', filePath, content }])
  set(activeTabIdAtom, id)
})

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
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set(editorTabsAtom, [...tabs, { id, type: 'git-diff', filePath, patch }])
    set(activeTabIdAtom, id)
  }
)

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

    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set(editorTabsAtom, [...tabs, { id, type: 'git-commit', hash, commit }])
    set(activeTabIdAtom, id)
  }
)

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
