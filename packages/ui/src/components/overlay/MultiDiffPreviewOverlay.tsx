/**
 * MultiDiffPreviewOverlay - Overlay for multiple file changes (Edit/Write tools)
 *
 * Features:
 * - Sidebar navigation when multiple files changed
 * - Consolidated view (group by file) or individual changes
 * - Unified diff viewer for each change
 * - Focused change support (jump to specific change)
 */

import * as React from 'react'
import { useState, useMemo, useCallback, useEffect, type ReactNode } from 'react'
import * as ReactDOM from 'react-dom'
import { PencilLine, FilePlus, X, ChevronDown, Check } from 'lucide-react'
import { ShikiDiffViewer } from '../code-viewer/ShikiDiffViewer'
import { truncateFilePath } from '../code-viewer/language-map'
import { useOverlayMode, OVERLAY_LAYOUT } from '../../lib/layout'
import { PreviewHeader, PreviewHeaderBadge } from '../ui/PreviewHeader'
import { usePlatform } from '../../context/PlatformContext'

/**
 * A single file change (Edit or Write)
 */
export interface FileChange {
  /** Unique ID for this change */
  id: string
  /** Absolute file path */
  filePath: string
  /** Tool type: Edit or Write */
  toolType: 'Edit' | 'Write'
  /** For Edit: the old_string; For Write: empty or previous content if available */
  original: string
  /** For Edit: the new_string; For Write: the written content */
  modified: string
  /** Error message if the tool failed */
  error?: string
}

export interface MultiDiffPreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close */
  onClose: () => void
  /** List of file changes to display */
  changes: FileChange[]
  /** Whether to consolidate changes by file path (default: true) */
  consolidated?: boolean
  /** ID of change to focus on initially */
  focusedChangeId?: string
  /** Theme mode */
  theme?: 'light' | 'dark'
  /** Callback to open file in external editor */
  onOpenFile?: (filePath: string) => void
}

// ============================================
// Sidebar Components
// ============================================

interface SidebarEntry {
  key: string
  filePath: string
  changes: FileChange[]
  toolType?: 'Edit' | 'Write'
}

function createSidebarEntries(changes: FileChange[], consolidated: boolean): SidebarEntry[] {
  // Filter out errored changes for display
  const successfulChanges = changes.filter(c => !c.error)

  if (!consolidated) {
    return successfulChanges.map(change => ({
      key: change.id,
      filePath: change.filePath,
      changes: [change],
      toolType: change.toolType,
    }))
  }

  // Group by file path
  const byPath = new Map<string, FileChange[]>()
  for (const change of successfulChanges) {
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

function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

function getParentDir(filePath: string): string {
  const parts = filePath.split('/')
  if (parts.length <= 2) return ''
  return parts.slice(-3, -1).join('/')
}

interface SidebarItemProps {
  entry: SidebarEntry
  isSelected: boolean
  onClick: () => void
  theme: 'light' | 'dark'
}

function SidebarItem({ entry, isSelected, onClick, theme }: SidebarItemProps) {
  const fileName = getFileName(entry.filePath)
  const parentDir = getParentDir(entry.filePath)
  const changeCount = entry.changes.length

  const isDark = theme === 'dark'
  const textColor = isDark ? '#e4e4e4' : '#1a1a1a'
  const mutedColor = isDark ? '#888888' : '#666666'

  return (
    <button
      onClick={onClick}
      title={entry.filePath}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left rounded-md transition-colors"
      style={{
        color: textColor,
        backgroundColor: isSelected
          ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)')
          : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.backgroundColor = 'transparent'
        }
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{fileName}</div>
        {parentDir && (
          <div className="text-[10px] truncate" style={{ color: mutedColor }}>
            {parentDir}
          </div>
        )}
      </div>
      {changeCount > 1 && (
        <span className="text-xs shrink-0" style={{ color: mutedColor }}>
          ({changeCount})
        </span>
      )}
    </button>
  )
}

interface SidebarProps {
  entries: SidebarEntry[]
  selectedKey: string | null
  onSelect: (key: string) => void
  theme: 'light' | 'dark'
}

function Sidebar({ entries, selectedKey, onSelect, theme }: SidebarProps) {
  const isDark = theme === 'dark'
  const mutedColor = isDark ? '#888888' : '#666666'

  return (
    <div className="space-y-0.5">
      <div
        className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
        style={{ color: mutedColor }}
      >
        Changes
      </div>
      {entries.map(entry => (
        <SidebarItem
          key={entry.key}
          entry={entry}
          isSelected={selectedKey === entry.key}
          onClick={() => onSelect(entry.key)}
          theme={theme}
        />
      ))}
    </div>
  )
}

// ============================================
// View Mode Dropdown (Snippet vs Full File)
// ============================================

interface ViewModeDropdownProps {
  viewMode: 'snippet' | 'full'
  onViewModeChange: (mode: 'snippet' | 'full') => void
  disabled?: boolean
  theme: 'light' | 'dark'
}

function ViewModeDropdown({ viewMode, onViewModeChange, disabled, theme }: ViewModeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const isDark = theme === 'dark'

  return (
    <div className="relative ml-auto">
      <button
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 h-[26px] px-2.5 rounded-[6px] text-[13px] font-medium transition-colors"
        style={{
          backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
          color: isDark ? '#e4e4e4' : '#1a1a1a',
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'wait' : 'pointer',
        }}
      >
        {viewMode === 'full' ? 'Full File' : 'Snippet'}
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown menu */}
          <div
            className="absolute right-0 top-full mt-1 z-20 py-1 rounded-lg shadow-lg min-w-[120px]"
            style={{
              backgroundColor: isDark ? '#2a2a2a' : '#ffffff',
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
            }}
          >
            <button
              onClick={() => { onViewModeChange('snippet'); setIsOpen(false) }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-sm transition-colors"
              style={{ color: isDark ? '#e4e4e4' : '#1a1a1a' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              Snippet
              <Check className={`w-3.5 h-3.5 ${viewMode !== 'snippet' ? 'opacity-0' : ''}`} />
            </button>
            <button
              onClick={() => { onViewModeChange('full'); setIsOpen(false) }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-sm transition-colors"
              style={{ color: isDark ? '#e4e4e4' : '#1a1a1a' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              Full File
              <Check className={`w-3.5 h-3.5 ${viewMode !== 'full' ? 'opacity-0' : ''}`} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ============================================
// Main Component
// ============================================

export function MultiDiffPreviewOverlay({
  isOpen,
  onClose,
  changes,
  consolidated = true,
  focusedChangeId,
  theme = 'light',
  onOpenFile,
}: MultiDiffPreviewOverlayProps) {
  const responsiveMode = useOverlayMode()
  const isModal = responsiveMode === 'modal'
  const { onSetTrafficLightsVisible } = usePlatform()

  // Hide macOS traffic lights when overlay opens, restore when it closes
  useEffect(() => {
    if (!isOpen) return

    onSetTrafficLightsVisible?.(false)
    return () => onSetTrafficLightsVisible?.(true)
  }, [isOpen, onSetTrafficLightsVisible])

  const isDark = theme === 'dark'
  const backgroundColor = isDark ? '#1e1e1e' : '#ffffff'
  const textColor = isDark ? '#e4e4e4' : '#1a1a1a'
  const sidebarBg = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)'

  // Create sidebar entries
  const sidebarEntries = useMemo(() => {
    return createSidebarEntries(changes, consolidated)
  }, [changes, consolidated])

  // Selection state
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    // If focusedChangeId provided, find and select it
    if (focusedChangeId) {
      if (!consolidated) {
        return focusedChangeId
      }
      // In consolidated mode, find the file that contains this change
      const change = changes.find(c => c.id === focusedChangeId)
      if (change) {
        return change.filePath
      }
    }
    // Default to first entry
    return sidebarEntries[0]?.key || null
  })

  // View mode state (snippet vs full file)
  // Note: Full file mode requires reading from filesystem which isn't available in overlay
  // So we only support snippet mode in the overlay version
  const [viewMode] = useState<'snippet' | 'full'>('snippet')

  // Reset selection when focusedChangeId changes (user clicked a specific change)
  // Note: We intentionally don't include selectedKey to avoid resetting user selections
  useEffect(() => {
    if (focusedChangeId) {
      if (!consolidated) {
        setSelectedKey(focusedChangeId)
      } else {
        const change = changes.find(c => c.id === focusedChangeId)
        if (change) {
          setSelectedKey(change.filePath)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedChangeId])

  // Reset to first entry if current selection becomes invalid (e.g., changes array updated)
  useEffect(() => {
    if (sidebarEntries.length > 0) {
      setSelectedKey(prevKey => {
        // Keep current selection if it's still valid
        if (prevKey && sidebarEntries.find(e => e.key === prevKey)) {
          return prevKey
        }
        // Otherwise select first entry
        return sidebarEntries[0]?.key || null
      })
    }
  }, [sidebarEntries])

  // Get selected entry
  const selectedEntry = useMemo(() => {
    if (!selectedKey) return null
    return sidebarEntries.find(e => e.key === selectedKey) || null
  }, [sidebarEntries, selectedKey])

  // Compute combined diff for the selected entry
  const combinedDiff = useMemo(() => {
    if (!selectedEntry) return { original: '', modified: '' }

    const entryChanges = selectedEntry.changes
    if (entryChanges.length === 1) {
      const firstChange = entryChanges[0]
      return {
        original: firstChange?.original ?? '',
        modified: firstChange?.modified ?? '',
      }
    }

    // Multiple changes to same file - combine with separator
    const separator = '\n\n// ───────────────────────────────────────\n\n'
    return {
      original: entryChanges.map(c => c.original).join(separator),
      modified: entryChanges.map(c => c.modified).join(separator),
    }
  }, [selectedEntry])

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleSelectEntry = useCallback((key: string) => {
    setSelectedKey(key)
  }, [])

  if (!isOpen) return null

  // Determine if we should show sidebar
  const showSidebar = sidebarEntries.length > 1

  // Build header content
  const headerContent = (
    <>
      {selectedEntry && (
        <>
          {(() => {
            const hasWrite = selectedEntry.changes.some(c => c.toolType === 'Write')
            const IconComponent = hasWrite ? FilePlus : PencilLine
            const label = hasWrite ? 'Write' : 'Edit'
            const variant = hasWrite ? 'green' : 'orange'
            return (
              <PreviewHeaderBadge
                icon={IconComponent}
                label={selectedEntry.changes.length > 1 ? `${selectedEntry.changes.length} ${label}s` : label}
                variant={variant as any}
              />
            )
          })()}
          <PreviewHeaderBadge
            label={truncateFilePath(selectedEntry.filePath)}
            onClick={onOpenFile ? () => onOpenFile(selectedEntry.filePath) : undefined}
            shrinkable
          />
        </>
      )}
      {!selectedEntry && sidebarEntries.length > 0 && (
        <span className="text-sm" style={{ color: isDark ? '#888' : '#666' }}>
          {sidebarEntries.length} file{sidebarEntries.length !== 1 ? 's' : ''}
        </span>
      )}
    </>
  )

  const mainContent = (
    <div className="flex h-full">
      {/* Sidebar */}
      {showSidebar && (
        <div
          className="w-64 shrink-0 h-full overflow-y-auto"
          style={{
            backgroundColor: sidebarBg,
            borderRight: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
          }}
        >
          <div className="px-2 py-2">
            <Sidebar
              entries={sidebarEntries}
              selectedKey={selectedKey}
              onSelect={handleSelectEntry}
              theme={theme}
            />
          </div>
        </div>
      )}

      {/* Main diff area */}
      <div className="flex-1 min-w-0 h-full" style={{ backgroundColor }}>
        {selectedEntry ? (
          <ShikiDiffViewer
            key={selectedKey}
            original={combinedDiff.original}
            modified={combinedDiff.modified}
            filePath={selectedEntry.filePath}
            diffStyle="unified"
            theme={theme}
          />
        ) : (
          <div
            className="h-full flex items-center justify-center"
            style={{ color: isDark ? '#888' : '#666' }}
          >
            Select a file to view changes
          </div>
        )}
      </div>
    </div>
  )

  // Fullscreen mode - covers entire viewport
  if (!isModal) {
    return ReactDOM.createPortal(
      <div
        className="fixed inset-0 z-fullscreen flex flex-col"
        style={{ backgroundColor, color: textColor }}
      >
        <PreviewHeader onClose={onClose} height={54}>
          {headerContent}
        </PreviewHeader>
        <div className="flex-1 min-h-0">
          {mainContent}
        </div>
      </div>,
      document.body
    )
  }

  // Modal mode
  return ReactDOM.createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${OVERLAY_LAYOUT.modalBackdropClass}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex flex-col overflow-hidden smooth-corners"
        style={{
          backgroundColor,
          color: textColor,
          width: '90vw',
          maxWidth: OVERLAY_LAYOUT.modalMaxWidth,
          height: `${OVERLAY_LAYOUT.modalMaxHeightPercent}vh`,
          borderRadius: 16,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        }}
      >
        <PreviewHeader onClose={onClose} height={48}>
          {headerContent}
        </PreviewHeader>
        <div className="flex-1 min-h-0">
          {mainContent}
        </div>
      </div>
    </div>,
    document.body
  )
}
