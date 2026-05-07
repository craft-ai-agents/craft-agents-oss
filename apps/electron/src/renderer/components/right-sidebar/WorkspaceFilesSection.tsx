import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionFile } from '../../../shared/types'
import { cn } from '@/lib/utils'
import { useAppShellContext } from '@/context/AppShellContext'
import { getFileIcon, FileThumbnail } from './file-tree-shared'

type GetWorkspaceFiles = (workspaceId: string, dirPath?: string) => Promise<SessionFile[]>

export interface WorkspaceFilesSectionProps {
  workspaceId?: string
  workspacePath?: string
  className?: string
}

export function loadWorkspaceRootFiles(
  workspaceId: string,
  getWorkspaceFiles: GetWorkspaceFiles = window.electronAPI.getWorkspaceFiles,
): Promise<SessionFile[]> {
  return getWorkspaceFiles(workspaceId, undefined)
}

function WorkspaceFileRow({
  file,
  onOpenFile,
}: {
  file: SessionFile
  onOpenFile: (path: string) => void
}) {
  const isDirectory = file.type === 'directory'

  return (
    <button
      type="button"
      onClick={() => {
        if (!isDirectory) onOpenFile(file.path)
      }}
      onDoubleClick={() => {
        if (!isDirectory) onOpenFile(file.path)
      }}
      className={cn(
        "group flex w-full min-w-0 overflow-hidden items-center gap-2 rounded-[6px] py-[5px] text-[13px] select-none outline-none text-left",
        "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        "hover:bg-sidebar-hover transition-colors px-2"
      )}
      title={file.path}
    >
      <span className="relative h-3.5 w-3.5 shrink-0 flex items-center justify-center">
        {isDirectory ? getFileIcon(file) : <FileThumbnail file={file} />}
      </span>
      <span className="flex-1 min-w-0 truncate">{file.name}</span>
    </button>
  )
}

export function WorkspaceFilesSection({ workspaceId, workspacePath, className }: WorkspaceFilesSectionProps) {
  const { onOpenFile } = useAppShellContext()
  const [files, setFiles] = useState<SessionFile[]>([])
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
            {files.map((file) => (
              <WorkspaceFileRow
                key={file.path}
                file={file}
                onOpenFile={onOpenFile}
              />
            ))}
          </nav>
        )}
      </div>
    </div>
  )
}
