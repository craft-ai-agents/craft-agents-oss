import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ExternalLink, FolderOpen, Loader2 } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
} from '@/components/ui/styled-context-menu'
import type { SessionFile } from '../../../shared/types'
import { cn } from '@/lib/utils'
import { useAppShellContext } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import { getFileIcon, FileThumbnail } from './file-tree-shared'

type GetWorkspaceFiles = (workspaceId: string, dirPath?: string) => Promise<SessionFile[]>

/** Tracks the fetched and currently expanded folders in the workspace file tree. */
export interface WorkspaceFilesTreeState {
  /** Cached children for every directory that has already been fetched. */
  childrenByDirPath: Map<string, SessionFile[]>
  /** Directory paths that should render their cached children. */
  expandedPaths: Set<string>
}

/** A flattened tree row with the depth needed for indentation. */
export interface WorkspaceVisibleTreeRow {
  file: SessionFile
  depth: number
}

/** Props for the workspace-backed file browser section. */
export interface WorkspaceFilesSectionProps {
  workspaceId?: string
  workspacePath?: string
  className?: string
}

function createEmptyWorkspaceFilesTreeState(): WorkspaceFilesTreeState {
  return {
    childrenByDirPath: new Map(),
    expandedPaths: new Set(),
  }
}

/** Loads the top-level files for a workspace. */
export function loadWorkspaceRootFiles(
  workspaceId: string,
  getWorkspaceFiles: GetWorkspaceFiles = window.electronAPI.getWorkspaceFiles,
): Promise<SessionFile[]> {
  return getWorkspaceFiles(workspaceId, undefined)
}

/** Expands a directory, fetching its children only when they are not cached yet. */
export async function expandWorkspaceDirectory(
  state: WorkspaceFilesTreeState,
  workspaceId: string,
  dirPath: string,
  getWorkspaceFiles: GetWorkspaceFiles = window.electronAPI.getWorkspaceFiles,
): Promise<WorkspaceFilesTreeState> {
  const childrenByDirPath = new Map(state.childrenByDirPath)
  const expandedPaths = new Set(state.expandedPaths)

  if (!childrenByDirPath.has(dirPath)) {
    childrenByDirPath.set(dirPath, await getWorkspaceFiles(workspaceId, dirPath))
  }
  expandedPaths.add(dirPath)

  return { childrenByDirPath, expandedPaths }
}

/** Collapses a directory while preserving its cached children. */
export function collapseWorkspaceDirectory(
  state: WorkspaceFilesTreeState,
  dirPath: string,
): WorkspaceFilesTreeState {
  const expandedPaths = new Set(state.expandedPaths)
  expandedPaths.delete(dirPath)
  return {
    childrenByDirPath: new Map(state.childrenByDirPath),
    expandedPaths,
  }
}

/** Flattens the cached workspace tree into the visible row order. */
export function getWorkspaceVisibleTree(
  rootFiles: SessionFile[],
  state: WorkspaceFilesTreeState,
): WorkspaceVisibleTreeRow[] {
  const rows: WorkspaceVisibleTreeRow[] = []

  const visit = (files: SessionFile[], depth: number) => {
    for (const file of files) {
      rows.push({ file, depth })
      if (file.type !== 'directory' || !state.expandedPaths.has(file.path)) continue

      const children = state.childrenByDirPath.get(file.path)
      if (children) {
        visit(children, depth + 1)
      }
    }
  }

  visit(rootFiles, 0)
  return rows
}

/** Actions used when opening workspace tree entries. */
export interface WorkspaceEntryOpenActions {
  onOpenFile: (path: string) => void
  openFile: (path: string) => void
}

/** Actions used when a workspace tree entry is clicked. */
export interface WorkspaceEntryActivationActions {
  onOpenFile: (path: string) => void
  onToggleDirectory: (file: SessionFile) => void
}

/** Handles a single-click activation for files and directories. */
export function activateWorkspaceEntry(file: SessionFile, actions: WorkspaceEntryActivationActions): void {
  if (file.type === 'directory') {
    actions.onToggleDirectory(file)
    return
  }

  actions.onOpenFile(file.path)
}

/** Handles a double-click activation without toggling directories. */
export function doubleActivateWorkspaceEntry(
  file: SessionFile,
  actions: Pick<WorkspaceEntryActivationActions, 'onOpenFile'>,
): void {
  if (file.type !== 'directory') {
    actions.onOpenFile(file.path)
  }
}

/** Opens files through the app shell and directories through the platform file manager. */
export function openWorkspaceEntry(file: SessionFile, actions: WorkspaceEntryOpenActions): void {
  if (file.type === 'directory') {
    actions.openFile(file.path)
    return
  }

  actions.onOpenFile(file.path)
}

function WorkspaceFileIcon({
  file,
  isExpanded,
  isLoading,
}: {
  file: SessionFile
  isExpanded: boolean
  isLoading: boolean
}) {
  if (isLoading) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
  }

  if (file.type !== 'directory') {
    return <FileThumbnail file={file} />
  }

  return (
    <>
      <span className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity duration-150">
        {getFileIcon(file, isExpanded)}
      </span>
      <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            isExpanded && "rotate-90"
          )}
        />
      </span>
    </>
  )
}

function WorkspaceFileRow({
  file,
  depth,
  isExpanded,
  isLoading,
  onOpenFile,
  onToggleDirectory,
}: {
  file: SessionFile
  depth: number
  isExpanded: boolean
  isLoading: boolean
  onOpenFile: (path: string) => void
  onToggleDirectory: (file: SessionFile) => void
}) {
  const { t } = useTranslation()
  const fileManagerName = getFileManagerName()

  const handleClick = () => {
    activateWorkspaceEntry(file, { onOpenFile, onToggleDirectory })
  }

  const handleContextOpen = () => {
    openWorkspaceEntry(file, {
      onOpenFile,
      openFile: (path) => window.electronAPI.openFile(path),
    })
  }

  const handleShowInFolder = () => {
    window.electronAPI.showInFolder(file.path)
  }

  const buttonElement = (
    <button
      type="button"
      onClick={handleClick}
      onDoubleClick={() => {
        doubleActivateWorkspaceEntry(file, { onOpenFile })
      }}
      className={cn(
        "group flex w-full min-w-0 overflow-hidden items-center gap-2 rounded-[6px] py-[5px] text-[13px] select-none outline-none text-left",
        "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        "hover:bg-sidebar-hover transition-colors px-2"
      )}
      style={{ paddingLeft: `${8 + depth * 20}px` }}
      title={file.path}
    >
      <span className="relative h-3.5 w-3.5 shrink-0 flex items-center justify-center">
        <WorkspaceFileIcon file={file} isExpanded={isExpanded} isLoading={isLoading} />
      </span>
      <span className="flex-1 min-w-0 truncate">{file.name}</span>
    </button>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {buttonElement}
      </ContextMenuTrigger>
      <StyledContextMenuContent>
        <StyledContextMenuItem onSelect={handleContextOpen}>
          <ExternalLink className="h-3.5 w-3.5" />
          {t("chat.openFile")}
        </StyledContextMenuItem>
        <StyledContextMenuItem onSelect={handleShowInFolder}>
          <FolderOpen className="h-3.5 w-3.5" />
          {t("chat.showInFileManager", { fileManager: fileManagerName })}
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

export function WorkspaceFilesSection({ workspaceId, workspacePath, className }: WorkspaceFilesSectionProps) {
  const { onOpenFile } = useAppShellContext()
  const [files, setFiles] = useState<SessionFile[]>([])
  const [treeState, setTreeState] = useState<WorkspaceFilesTreeState>(createEmptyWorkspaceFilesTreeState)
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const mountedRef = useRef(true)

  const loadFiles = useCallback(async () => {
    if (!workspaceId) {
      setFiles([])
      return
    }

    setIsLoading(true)
    try {
      const workspaceFiles = await loadWorkspaceRootFiles(workspaceId)
      if (mountedRef.current) {
        setFiles(workspaceFiles)
        setTreeState(createEmptyWorkspaceFilesTreeState())
        setLoadingPaths(new Set())
      }
    } catch (error) {
      console.error('Failed to load workspace files:', error)
      if (mountedRef.current) {
        setFiles([])
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [workspaceId])

  useEffect(() => {
    mountedRef.current = true
    void loadFiles()
    return () => {
      mountedRef.current = false
    }
  }, [loadFiles])

  const handleToggleDirectory = useCallback((file: SessionFile) => {
    if (!workspaceId || file.type !== 'directory') return

    if (treeState.expandedPaths.has(file.path)) {
      setTreeState((prev) => collapseWorkspaceDirectory(prev, file.path))
      return
    }

    if (treeState.childrenByDirPath.has(file.path)) {
      setTreeState((prev) => ({
        childrenByDirPath: new Map(prev.childrenByDirPath),
        expandedPaths: new Set(prev.expandedPaths).add(file.path),
      }))
      return
    }

    setLoadingPaths((prev) => new Set(prev).add(file.path))
    void window.electronAPI.getWorkspaceFiles(workspaceId, file.path)
      .then((children) => {
        if (mountedRef.current) {
          setTreeState((prev) => {
            const childrenByDirPath = new Map(prev.childrenByDirPath)
            const expandedPaths = new Set(prev.expandedPaths)
            childrenByDirPath.set(file.path, children)
            expandedPaths.add(file.path)
            return { childrenByDirPath, expandedPaths }
          })
        }
      })
      .catch((error) => {
        console.error('Failed to load workspace directory:', error)
      })
      .finally(() => {
        if (mountedRef.current) {
          setLoadingPaths((prev) => {
            const next = new Set(prev)
            next.delete(file.path)
            return next
          })
        }
      })
  }, [treeState, workspaceId])

  if (!workspaceId) {
    return null
  }

  return (
    <div className={cn('flex flex-col h-full min-h-0', className)}>
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0 select-none">
        <span className="text-xs font-medium text-muted-foreground">Workspace</span>
        {workspacePath && (
          <button
            type="button"
            onClick={() => window.electronAPI.showInFolder(workspacePath)}
            className="text-xs text-foreground/50 hover:text-foreground/80 hover:underline underline-offset-2 transition-colors"
          >
            View
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-2 min-h-0">
        {files.length === 0 ? (
          <div className="px-4 text-muted-foreground select-none">
            <p className="text-xs">
              {isLoading ? 'Loading...' : 'No workspace files'}
            </p>
          </div>
        ) : (
          <nav className="grid gap-0.5 px-2">
            {getWorkspaceVisibleTree(files, treeState).map(({ file, depth }) => (
              <WorkspaceFileRow
                key={file.path}
                file={file}
                depth={depth}
                isExpanded={treeState.expandedPaths.has(file.path)}
                isLoading={loadingPaths.has(file.path)}
                onOpenFile={onOpenFile}
                onToggleDirectory={handleToggleDirectory}
              />
            ))}
          </nav>
        )}
      </div>
    </div>
  )
}
