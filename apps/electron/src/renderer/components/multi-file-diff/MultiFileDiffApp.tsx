import * as React from 'react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import loader from '@monaco-editor/loader'
import * as monaco from 'monaco-editor'
import { ChevronDown, FilePlus, PencilLine, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/ThemeContext'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem } from '@/components/ui/styled-dropdown'
import { WindowHeader, WindowHeaderBadge, BADGE_CONFIGS } from '@/components/ui/window-header-badge'
import { getLanguageFromPath, formatFilePath } from '@/lib/file-utils'
import type { MultiFileDiffData, FileChange } from '../../../shared/types'

// Configure loader to use local monaco-editor package (not CDN)
loader.config({ monaco })

interface MultiFileDiffAppProps {
  sessionId: string
  turnId: string
}

/**
 * Get just the filename from a path
 */
function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

/**
 * Get parent directory path (last 2-3 segments for context)
 */
function getParentDir(filePath: string): string {
  const parts = filePath.split('/')
  if (parts.length <= 2) return ''
  // Return last 2-3 directory segments for context
  return parts.slice(-3, -1).join('/')
}

/**
 * Sidebar entry - either a consolidated file (multiple changes) or a single change
 */
interface SidebarEntry {
  /** Unique key for selection - filePath in consolidated mode, change.id in ungrouped mode */
  key: string
  filePath: string
  changes: FileChange[]
  /** Tool type badge for ungrouped mode */
  toolType?: 'Edit' | 'Write'
}

/**
 * Create sidebar entries - either consolidated by file or ungrouped (one per change)
 */
function createSidebarEntries(changes: FileChange[], consolidated: boolean): SidebarEntry[] {
  if (!consolidated) {
    // Ungrouped mode: each change is its own entry
    return changes.map(change => ({
      key: change.id,
      filePath: change.filePath,
      changes: [change],
      toolType: change.toolType,
    }))
  }

  // Consolidated mode: group by file path
  const byPath = new Map<string, FileChange[]>()
  for (const change of changes) {
    const existing = byPath.get(change.filePath) || []
    existing.push(change)
    byPath.set(change.filePath, existing)
  }

  return Array.from(byPath.entries()).map(([filePath, fileChanges]) => ({
    key: filePath,
    filePath,
    changes: fileChanges,
  }))
}

interface SidebarItemProps {
  entry: SidebarEntry
  isSelected: boolean
  onClick: () => void
}

function SidebarItem({ entry, isSelected, onClick }: SidebarItemProps) {
  const fileName = getFileName(entry.filePath)
  const parentDir = getParentDir(entry.filePath)
  const changeCount = entry.changes.length

  return (
    <button
      onClick={onClick}
      title={entry.filePath}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-left rounded-md transition-colors",
        isSelected
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{fileName}</div>
        {parentDir && (
          <div className="text-[10px] text-muted-foreground/50 truncate">{parentDir}</div>
        )}
      </div>
      {/* Consolidated mode: show edit count. Ungrouped mode: show tool type */}
      {entry.toolType ? (
        <span className="text-[10px] text-muted-foreground/50 shrink-0">
          {entry.toolType}
        </span>
      ) : changeCount > 1 && (
        <span className="text-xs text-muted-foreground/70 shrink-0">
          ({changeCount} edits)
        </span>
      )}
    </button>
  )
}

interface SidebarProps {
  entries: SidebarEntry[]
  selectedKey: string | null
  onSelect: (key: string) => void
}

function Sidebar({ entries, selectedKey, onSelect }: SidebarProps) {
  return (
    <div className="space-y-0.5">
      {entries.map(entry => (
        <SidebarItem
          key={entry.key}
          entry={entry}
          isSelected={selectedKey === entry.key}
          onClick={() => onSelect(entry.key)}
        />
      ))}
    </div>
  )
}

/**
 * MultiFileDiffApp - Shows all file changes in a turn with VS Code-style file tree + diff viewer
 */
export function MultiFileDiffApp({ sessionId, turnId }: MultiFileDiffAppProps) {
  const { resolvedMode } = useTheme()
  const [data, setData] = useState<MultiFileDiffData | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [isEditorReady, setIsEditorReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'snippet' | 'full'>('snippet')
  const [fullFileContent, setFullFileContent] = useState<{ original: string; modified: string } | null>(null)
  const [isLoadingFullFile, setIsLoadingFullFile] = useState(false)

  // Create sidebar entries - consolidated by file or ungrouped (one per change)
  const sidebarEntries = useMemo(() => {
    if (!data) return []
    // Filter out failed changes - they have nothing to show
    const successfulChanges = data.changes.filter(c => !c.error)
    // consolidated defaults to true if not specified
    const isConsolidated = data.consolidated !== false
    return createSidebarEntries(successfulChanges, isConsolidated)
  }, [data])

  // Fetch data on mount
  useEffect(() => {
    async function fetchData() {
      if (!sessionId || !turnId) {
        setError('Missing session or turn ID')
        return
      }

      if (!window.electronAPI?.getMultiFileDiffData) {
        setError('API not available')
        return
      }

      try {
        const result = await window.electronAPI.getMultiFileDiffData(sessionId, turnId)
        if (!result) {
          setError('Multi-file diff data not found')
          return
        }
        setData(result)

        // Determine initial selection
        const successfulChanges = result.changes.filter(c => !c.error)
        const isConsolidated = result.consolidated !== false

        if (result.focusedChangeId) {
          // Focus specific change (ungrouped mode)
          setSelectedKey(result.focusedChangeId)
        } else if (successfulChanges.length > 0) {
          // Default to first entry
          const key = isConsolidated ? successfulChanges[0].filePath : successfulChanges[0].id
          setSelectedKey(key)
        }
      } catch (err) {
        setError(String(err))
      }
    }

    fetchData()
  }, [sessionId, turnId])

  // Get currently selected entry
  const selectedEntry = useMemo(() => {
    if (!selectedKey) return null
    return sidebarEntries.find(e => e.key === selectedKey) || null
  }, [sidebarEntries, selectedKey])

  // Compute the combined diff for selected entry (handles multiple edits in consolidated mode)
  const combinedDiff = useMemo(() => {
    if (!selectedEntry) return { original: '', modified: '' }

    const changes = selectedEntry.changes

    // If single change, use it directly
    if (changes.length === 1) {
      return {
        original: changes[0].original,
        modified: changes[0].modified,
      }
    }

    // For multiple changes, each edit is an independent snippet from different parts
    // of the file. Concatenate them with separators to show all changes.
    const separator = '\n\n// ───────────────────────────────────────\n\n'
    const originals: string[] = []
    const modifieds: string[] = []

    for (const change of changes) {
      originals.push(change.original)
      modifieds.push(change.modified)
    }

    return {
      original: originals.join(separator),
      modified: modifieds.join(separator),
    }
  }, [selectedEntry])

  // Load full file content when switching to full view mode
  useEffect(() => {
    if (viewMode !== 'full' || !selectedEntry) {
      setFullFileContent(null)
      return
    }

    async function loadFullFile() {
      if (!selectedEntry) return

      setIsLoadingFullFile(true)
      try {
        const currentContent = await window.electronAPI?.readFileForDiff(selectedEntry.filePath)

        if (currentContent === null) {
          // File doesn't exist or can't be read - fall back to snippet view
          setViewMode('snippet')
          return
        }

        // For multiple edits, reconstruct the original by reversing all edits
        // Current file is "after all edits", we need to undo them to get "before"
        let originalContent = currentContent
        const changes = selectedEntry.changes

        // Apply edits in reverse to reconstruct original
        for (let i = changes.length - 1; i >= 0; i--) {
          const change = changes[i]
          if (change.toolType === 'Edit') {
            // Reverse the edit: replace new_string with old_string
            originalContent = originalContent.replace(change.modified, change.original)
          } else {
            // Write tool - before was empty
            originalContent = ''
            break
          }
        }

        setFullFileContent({ original: originalContent, modified: currentContent })
      } catch (err) {
        console.error('Failed to load full file:', err)
        setViewMode('snippet')
      } finally {
        setIsLoadingFullFile(false)
      }
    }

    loadFullFile()
  }, [viewMode, selectedEntry])

  // Monaco mounted callback
  const handleEditorMount = useCallback(() => {
    requestAnimationFrame(() => {
      setIsEditorReady(true)
    })
  }, [])

  // Handle sidebar entry selection
  const handleSelectEntry = useCallback((key: string) => {
    setSelectedKey(key)
    setFullFileContent(null) // Reset full file content when switching entries
  }, [])

  // Open file in default app
  const handleOpenFile = useCallback(() => {
    if (selectedEntry?.filePath) {
      window.electronAPI?.openFile(selectedEntry.filePath)
    }
  }, [selectedEntry?.filePath])

  // Theme colors
  const isDark = resolvedMode === 'dark'
  const monacoBackground = isDark ? '#1e1e1e' : '#ffffff'
  const sidebarBackground = isDark ? '#252526' : '#f3f3f3'
  const toolbarBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'

  // Determine what to show in the diff editor
  const diffOriginal = viewMode === 'full' && fullFileContent
    ? fullFileContent.original
    : combinedDiff.original
  const diffModified = viewMode === 'full' && fullFileContent
    ? fullFileContent.modified
    : combinedDiff.modified

  // Is this ungrouped mode (each change shown separately)?
  const isUngroupedMode = data?.consolidated === false

  return (
    <TooltipProvider delayDuration={0}>
      <div className="h-screen w-screen flex flex-col" style={{ backgroundColor: monacoBackground }}>
        {/* Header */}
        <WindowHeader borderColor={toolbarBorder}>
          {selectedEntry && (
            <>
              {/* Show tool type badge based on what changes are in this entry */}
              {(() => {
                const hasWrite = selectedEntry.changes.some(c => c.toolType === 'Write')
                const Icon = hasWrite ? FilePlus : PencilLine
                const label = hasWrite ? 'Write' : 'Edit'
                const config = hasWrite ? BADGE_CONFIGS.write : BADGE_CONFIGS.edit
                return (
                  <WindowHeaderBadge
                    Icon={Icon}
                    label={selectedEntry.changes.length > 1 ? `${selectedEntry.changes.length} ${label}s` : label}
                    {...config}
                  />
                )
              })()}
              <WindowHeaderBadge
                label={formatFilePath(selectedEntry.filePath)}
                onClick={handleOpenFile}
                {...(isDark ? BADGE_CONFIGS.neutralDark : BADGE_CONFIGS.neutralLight)}
              />

              {/* View mode dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    disabled={isLoadingFullFile}
                    className={cn(
                      "titlebar-no-drag ml-auto flex items-center gap-1 h-[26px] px-2.5 rounded-[6px] font-sans text-[13px] font-medium shadow-minimal cursor-pointer transition-colors",
                      isLoadingFullFile && "opacity-50 cursor-wait"
                    )}
                    style={{
                      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
                      color: isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)',
                    }}
                  >
                    {viewMode === 'full' ? 'Full File' : 'Snippet'}
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <StyledDropdownMenuContent align="end" sideOffset={4}>
                  <StyledDropdownMenuItem onClick={() => setViewMode('snippet')} className="justify-between">
                    Snippet
                    <Check className={cn("w-3.5 h-3.5", viewMode !== 'snippet' && "opacity-0")} />
                  </StyledDropdownMenuItem>
                  <StyledDropdownMenuItem onClick={() => setViewMode('full')} className="justify-between">
                    Full File
                    <Check className={cn("w-3.5 h-3.5", viewMode !== 'full' && "opacity-0")} />
                  </StyledDropdownMenuItem>
                </StyledDropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          {!selectedEntry && data && (
            <span className="text-sm text-muted-foreground">
              {sidebarEntries.length} {isUngroupedMode ? 'change' : 'file'}{sidebarEntries.length !== 1 ? 's' : ''}
            </span>
          )}
        </WindowHeader>

        {/* Fetch error overlay */}
        {error && (
          <div className="flex-1 flex items-center justify-center text-destructive">
            Error: {error}
          </div>
        )}

        {/* Main content: Sidebar + Editor */}
        {data && !error && (
          <div className="flex-1 flex min-h-0">
            {/* Sidebar */}
            <div
              className="w-64 shrink-0 border-r overflow-y-auto"
              style={{
                backgroundColor: sidebarBackground,
                borderColor: toolbarBorder
              }}
            >
              <div className="p-2">
                <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {isUngroupedMode ? 'Changes' : 'Changed Files'} ({sidebarEntries.length})
                </div>
                <Sidebar
                  entries={sidebarEntries}
                  selectedKey={selectedKey}
                  onSelect={handleSelectEntry}
                />
              </div>
            </div>

            {/* Diff editor */}
            <div className="flex-1 min-w-0">
              {selectedEntry ? (
                <div
                  className="h-full transition-opacity duration-200"
                  style={{
                    opacity: isEditorReady && !isLoadingFullFile ? 1 : 0.3,
                    backgroundColor: monacoBackground
                  }}
                >
                  <DiffEditor
                    height="100%"
                    language={getLanguageFromPath(selectedEntry.filePath)}
                    theme={isDark ? 'vs-dark' : 'vs'}
                    original={diffOriginal}
                    modified={diffModified}
                    onMount={handleEditorMount}
                    loading={null}
                    options={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 13,
                      lineHeight: 1.6,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      padding: { top: 16, bottom: 16 },
                      renderSideBySide: false,
                      enableSplitViewResizing: true,
                      renderOverviewRuler: true,
                      readOnly: true,
                      overviewRulerLanes: 3,
                      overviewRulerBorder: false,
                      hideCursorInOverviewRuler: true,
                      renderLineHighlight: 'none',
                      scrollbar: {
                        vertical: 'auto',
                        horizontal: 'auto',
                        verticalScrollbarSize: 10,
                        horizontalScrollbarSize: 10,
                        useShadows: false,
                      },
                      lineNumbers: 'on',
                      lineNumbersMinChars: 4,
                      occurrencesHighlight: 'off',
                      selectionHighlight: false,
                      renderWhitespace: 'selection',
                      matchBrackets: 'never',
                    }}
                  />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  Select a file to view changes
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
