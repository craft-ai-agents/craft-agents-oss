import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRegisterModal } from '@/context/ModalContext'
import type { DirectoryListingResult } from '../../shared/types'
import { FolderIcon, FolderSymlinkIcon, ChevronRightIcon, ServerIcon, FolderSearchIcon } from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import type { WorkspaceCreationTarget } from '../../shared/types'
import { cn } from '@/lib/utils'

/**
 * Detect paths that are clearly from the wrong platform.
 * The server directory browser runs against the server's filesystem,
 * so Windows-style paths are invalid when the server is macOS/Linux and vice versa.
 * We infer the server platform from the home directory path.
 */
function isWrongPlatformPath(path: string, serverHomePath: string | null): boolean {
  if (!serverHomePath) return false
  const serverIsUnix = serverHomePath.startsWith('/')
  if (serverIsUnix) {
    return /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')
  }
  // Server is Windows — reject Unix absolute paths
  return path.startsWith('/')
}

interface ServerDirectoryBrowserProps {
  open: boolean
  mode: 'browse' | 'manual'
  onSelect: (path: string) => void
  onCancel: () => void
  initialPath?: string
  presentation?: 'dialog' | 'inline'
  target?: WorkspaceCreationTarget | null
}

export function ServerDirectoryBrowser({
  open,
  mode,
  onSelect,
  onCancel,
  initialPath,
  presentation = 'dialog',
  target,
}: ServerDirectoryBrowserProps) {
  useRegisterModal(open && presentation === 'dialog', onCancel)

  const [listing, setListing] = useState<DirectoryListingResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null)
  const [serverHomePath, setServerHomePath] = useState<string | null>(null)
  const [effectiveMode, setEffectiveMode] = useState<'browse' | 'manual'>(mode)
  const inputRef = useRef<HTMLInputElement>(null)

  // Navigate to a directory (for browse mode)
  const navigateTo = useCallback(async (dirPath: string) => {
    setLoading(true)
    setError(null)
    setSelectedEntry(null)
    try {
      const result = target
        ? await window.electronAPI.listServerDirectoryForTarget(target, dirPath)
        : await window.electronAPI.listServerDirectory(dirPath)
      setListing(result)
      setPathInput(result.currentPath)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list directory'
      const normalized = message.toLowerCase()
      const unsupported = normalized.includes('unknown channel')
        || normalized.includes('not available')
        || normalized.includes('not supported')
        || normalized.includes('method not found')

      if (unsupported) {
        setEffectiveMode('manual')
        setListing(null)
        setPathInput(dirPath)
        setError('Directory browsing is unavailable on this server. Enter a path manually.')
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Load initial directory when opened
  useEffect(() => {
    if (!open) {
      // Reset state when closed
      setListing(null)
      setError(null)
      setSelectedEntry(null)
      setPathInput('')
      setServerHomePath(null)
      setEffectiveMode(mode)
      return
    }

    const init = async () => {
      // Always fetch server home dir — needed for platform detection in both modes
      const homeDir = target
        ? await window.electronAPI.getHomeDirForTarget(target)
        : await window.electronAPI.getHomeDir()
      setServerHomePath(homeDir)
      setEffectiveMode(mode)

      if (mode === 'browse') {
        // Only use initialPath if it matches the server's platform
        const useInitial = initialPath && !isWrongPlatformPath(initialPath, homeDir)
        void navigateTo(useInitial ? initialPath : homeDir)
      }
    }
    void init()
  }, [open, mode, initialPath, navigateTo, target])

  // Handle path input submission (Enter key or navigate button)
  const handlePathSubmit = useCallback(() => {
    const trimmed = pathInput.trim()
    if (!trimmed) return

    // Client-side rejection of wrong-platform paths (avoids round-trip)
    if (isWrongPlatformPath(trimmed, serverHomePath)) {
      setError('This looks like a path from a different OS. Enter a path that exists on the server.')
      return
    }

    if (effectiveMode === 'browse') {
      void navigateTo(trimmed)
    } else {
      // Manual mode — just select the path
      onSelect(trimmed)
    }
  }, [pathInput, effectiveMode, navigateTo, onSelect, serverHomePath])

  // Handle selecting the current directory (or highlighted entry)
  const handleSelect = useCallback(() => {
    if (effectiveMode === 'manual') {
      handlePathSubmit()
      return
    }

    if (selectedEntry) {
      onSelect(selectedEntry)
    } else if (listing) {
      onSelect(listing.currentPath)
    } else if (pathInput.trim()) {
      onSelect(pathInput.trim())
    }
  }, [effectiveMode, selectedEntry, listing, pathInput, onSelect, handlePathSubmit])

  // Handle double-click on an entry to navigate into it
  const handleEntryDoubleClick = useCallback((entryPath: string) => {
    void navigateTo(entryPath)
  }, [navigateTo])

  // Handle single-click to select an entry
  const handleEntryClick = useCallback((entryPath: string) => {
    setSelectedEntry(prev => prev === entryPath ? null : entryPath)
  }, [])

  // Browse mode content
  const renderBrowseMode = () => (
    <>
      {/* Path input */}
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={pathInput}
          onChange={e => setPathInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handlePathSubmit()
          }}
          placeholder="Enter path..."
          className="flex-1 font-mono text-xs"
        />
        <Button variant="outline" size="sm" onClick={handlePathSubmit} disabled={loading}>
          Go
        </Button>
      </div>

      {/* Breadcrumbs */}
      {listing && (
        <div className="flex items-center gap-0.5 text-xs text-muted-foreground overflow-x-auto py-1 min-h-[24px]">
          {listing.breadcrumbs.map((crumb, i) => (
            <span key={crumb.path} className="flex items-center gap-0.5 shrink-0">
              {i > 0 && <ChevronRightIcon className="size-3 text-muted-foreground/50" />}
              <button
                type="button"
                onClick={() => navigateTo(crumb.path)}
                className="hover:text-foreground hover:underline transition-colors px-0.5"
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Directory listing */}
      <div className="border border-foreground/10 rounded-md overflow-hidden flex-1 min-h-0">
        <div className="overflow-y-auto max-h-[300px]">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Spinner className="text-sm" />
              Loading...
            </div>
          )}

          {error && (
            <div className="px-3 py-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && listing?.truncated && (
            <div className="border-b border-foreground/10 px-3 py-2 text-xs text-muted-foreground">
              Showing the first {listing.entries.length} folders out of {listing.totalEntries}. Narrow the path if the folder you want is missing.
            </div>
          )}

          {!loading && !error && listing && listing.entries.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              No subdirectories. Use the path input above to navigate.
            </div>
          )}

          {!loading && !error && listing && listing.entries.map(entry => (
            <button
              key={entry.path}
              type="button"
              onClick={() => handleEntryClick(entry.path)}
              onDoubleClick={() => handleEntryDoubleClick(entry.path)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors hover:bg-foreground/5 ${
                selectedEntry === entry.path ? 'bg-foreground/5' : ''
              }`}
            >
              {entry.isSymlink
                ? <FolderSymlinkIcon className="size-4 shrink-0 text-muted-foreground" />
                : <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
              }
              <span className="truncate">{entry.name}</span>
              {entry.isSymlink && (
                <span className="text-xs text-muted-foreground/60 shrink-0">symlink</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  )

  // Manual mode content
  const renderManualMode = () => (
    <>
      <p className="text-sm text-muted-foreground">
        Enter the full path on the server:
      </p>
      <Input
        ref={inputRef}
        value={pathInput}
        onChange={e => setPathInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleSelect()
        }}
        placeholder="/Users/username/projects/my-project"
        className="font-mono text-xs"
        autoFocus
      />
    </>
  )

  const content = (
    <>
      <DialogHeader>
        <DialogTitle>Select Server Directory</DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        {effectiveMode === 'browse' ? renderBrowseMode() : renderManualMode()}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={handleSelect}
          disabled={effectiveMode === 'manual' ? !pathInput.trim() : (!listing && !pathInput.trim())}
        >
          Select
        </Button>
      </DialogFooter>
    </>
  )

  if (!open) return null

  if (presentation === 'inline') {
    return (
      <div className="w-full rounded-2xl border border-border/50 bg-muted/35 p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background shadow-minimal">
                {target?.mode === 'remote'
                  ? <ServerIcon className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                  : <FolderSearchIcon className="h-4 w-4 text-muted-foreground" />
                }
              </span>
              <span>Select a folder</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {effectiveMode === 'browse'
                ? 'Browse directories on the selected server and choose the folder you want to use.'
                : 'Enter the full path for a folder on the selected server.'
              }
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel} className="shrink-0">
            Close
          </Button>
        </div>

        <div className="flex flex-col gap-3">
          {effectiveMode === 'browse' ? renderBrowseMode() : renderManualMode()}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleSelect}
            disabled={effectiveMode === 'manual' ? !pathInput.trim() : (!listing && !pathInput.trim())}
          >
            Use folder
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) onCancel() }}>
      <DialogContent
        className="z-[var(--z-floating-menu)] max-w-lg"
        overlayClassName="z-[var(--z-floating-backdrop)]"
      >
        {content}
      </DialogContent>
    </Dialog>
  )
}
