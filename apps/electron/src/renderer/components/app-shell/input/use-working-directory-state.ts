import * as React from 'react'

import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { getPathBasename } from '@/lib/platform'

import {
  addRecentWorkingDir,
  getRecentWorkingDirs,
  removeRecentWorkingDir,
} from './working-directory-history'

/** Threshold above which the surface should render a filter input. */
export const WORKING_DIR_FILTER_THRESHOLD = 5

export interface UseWorkingDirectoryStateInput {
  workingDirectory: string | undefined
  onWorkingDirectoryChange: (path: string) => void
  sessionFolderPath: string | undefined
  workspaceId: string | undefined
  /** Whether the consumer's surface (popover / drawer) is currently open.
   *  The hook uses this to refresh history + reset the filter on every open. */
  isOpen: boolean
  /** Called when the hook wants the consumer's surface to close
   *  (after select-recent, reset, or choose-folder). */
  onClose: () => void
}

type ServerBrowserBridge = ReturnType<typeof useDirectoryPicker>

export interface UseWorkingDirectoryStateResult {
  recentDirs: string[]
  homeDir: string
  gitBranch: string | null
  filter: string
  setFilter: (next: string) => void

  /** recentDirs minus current dir, alphabetically sorted by basename. */
  sortedRecent: string[]
  /** Whether a non-session-root folder is currently selected. */
  hasFolder: boolean
  /** Display name for the trigger badge — basename of the selected folder,
   *  or `undefined` when nothing is selected. Consumers localise their own
   *  fallback so the hook stays i18n-free. */
  folderName: string | undefined
  /** Whether the Reset action should be offered. */
  showReset: boolean
  /** Whether the surface should show a search/filter input
   *  (true when more than {@link WORKING_DIR_FILTER_THRESHOLD} sortedRecent entries). */
  showFilter: boolean

  handleSelectRecent: (path: string) => void
  handleReset: () => void
  handleRemoveRecent: (e: React.MouseEvent, path: string) => void
  handleChooseFolder: () => void

  serverBrowser: Pick<
    ServerBrowserBridge,
    'showServerBrowser' | 'serverBrowserMode' | 'cancelServerBrowser' | 'confirmServerBrowser'
  >
}

/**
 * Shared state machine for the working-directory selector. Powers both the
 * desktop popover (FreeFormInput.WorkingDirectoryBadge) and the compact
 * drawer (CompactWorkingDirectorySelector) so they cannot drift.
 *
 * The hook owns: recent-dirs list, home dir, git branch fetch, filter input
 * state, and all mutation handlers. The hook does **not** own: surface open
 * state, autofocus behaviour, or path-display formatting — those stay in
 * the consumer because they differ intentionally between surfaces.
 */
export function useWorkingDirectoryState(
  input: UseWorkingDirectoryStateInput,
): UseWorkingDirectoryStateResult {
  const {
    workingDirectory,
    onWorkingDirectoryChange,
    sessionFolderPath,
    workspaceId,
    isOpen,
    onClose,
  } = input

  const [recentDirs, setRecentDirs] = React.useState<string[]>([])
  const [homeDir, setHomeDir] = React.useState<string>('')
  const [gitBranch, setGitBranch] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState('')

  React.useEffect(() => {
    setRecentDirs(getRecentWorkingDirs(workspaceId))
    window.electronAPI?.getHomeDir?.().then((dir: string) => {
      if (dir) setHomeDir(dir)
    })
  }, [workspaceId])

  React.useEffect(() => {
    if (workingDirectory) {
      window.electronAPI?.getGitBranch?.(workingDirectory).then((branch: string | null) => {
        setGitBranch(branch)
      })
    } else {
      setGitBranch(null)
    }
  }, [workingDirectory])

  React.useEffect(() => {
    if (isOpen) {
      setFilter('')
      setRecentDirs(getRecentWorkingDirs(workspaceId))
    }
  }, [isOpen, workspaceId])

  const handleFolderSelected = React.useCallback((selectedPath: string) => {
    setRecentDirs(addRecentWorkingDir(selectedPath, workspaceId))
    onWorkingDirectoryChange(selectedPath)
  }, [onWorkingDirectoryChange, workspaceId])

  const {
    pickDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
  } = useDirectoryPicker(handleFolderSelected)

  const handleSelectRecent = React.useCallback((path: string) => {
    setRecentDirs(addRecentWorkingDir(path, workspaceId))
    onWorkingDirectoryChange(path)
    onClose()
  }, [onWorkingDirectoryChange, onClose, workspaceId])

  const handleReset = React.useCallback(() => {
    if (sessionFolderPath) {
      onWorkingDirectoryChange(sessionFolderPath)
      onClose()
    }
  }, [onWorkingDirectoryChange, onClose, sessionFolderPath])

  const handleRemoveRecent = React.useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    setRecentDirs(removeRecentWorkingDir(path, workspaceId))
  }, [workspaceId])

  const handleChooseFolder = React.useCallback(() => {
    onClose()
    pickDirectory()
  }, [onClose, pickDirectory])

  const sortedRecent = React.useMemo(
    () => deriveSortedRecent(recentDirs, workingDirectory),
    [recentDirs, workingDirectory],
  )

  const { hasFolder, folderName, showReset } = React.useMemo(
    () => deriveSelectionFlags(workingDirectory, sessionFolderPath),
    [workingDirectory, sessionFolderPath],
  )

  const showFilter = sortedRecent.length > WORKING_DIR_FILTER_THRESHOLD

  return {
    recentDirs,
    homeDir,
    gitBranch,
    filter,
    setFilter,
    sortedRecent,
    hasFolder,
    folderName,
    showReset,
    showFilter,
    handleSelectRecent,
    handleReset,
    handleRemoveRecent,
    handleChooseFolder,
    serverBrowser: {
      showServerBrowser,
      serverBrowserMode,
      cancelServerBrowser,
      confirmServerBrowser,
    },
  }
}

// — Pure helpers (exported for testing) —

/**
 * Filter out the current directory and sort alphabetically by basename.
 * Pure derivation; the surfaces use this to render their recent-folder lists.
 */
export function deriveSortedRecent(
  recentDirs: readonly string[],
  workingDirectory: string | undefined,
): string[] {
  return recentDirs
    .filter((p) => p !== workingDirectory)
    .slice()
    .sort((a, b) => {
      const nameA = getPathBasename(a).toLowerCase()
      const nameB = getPathBasename(b).toLowerCase()
      return nameA.localeCompare(nameB)
    })
}

export interface SelectionFlags {
  hasFolder: boolean
  /** Basename of the selected folder, or undefined when nothing is selected. */
  folderName: string | undefined
  showReset: boolean
}

/**
 * Derive the selection flags used to label and configure the trigger badge.
 * "No folder selected" means either no working directory at all, or the
 * working directory equals the session root.
 */
export function deriveSelectionFlags(
  workingDirectory: string | undefined,
  sessionFolderPath: string | undefined,
): SelectionFlags {
  const hasFolder = !!workingDirectory && workingDirectory !== sessionFolderPath
  const folderName = hasFolder
    ? (getPathBasename(workingDirectory!) || undefined)
    : undefined
  const showReset = hasFolder
    && !!sessionFolderPath
    && sessionFolderPath !== workingDirectory
  return { hasFolder, folderName, showReset }
}
