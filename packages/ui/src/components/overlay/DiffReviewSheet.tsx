/**
 * DiffReviewSheet - Full-screen diff review overlay with @git-diff-view/react
 *
 * Features:
 * - Left sidebar with file list navigation
 * - GitHub-style diff viewer powered by @git-diff-view/react
 * - Accept All / Reject All actions
 * - Keyboard navigation support
 */

import * as React from 'react'
import { useState, useMemo, useEffect, useCallback } from 'react'
import * as ReactDOM from 'react-dom'
import { X, FileEdit, FilePlus, FileX, Check, XCircle } from 'lucide-react'
import { DiffView, DiffModeEnum } from '@git-diff-view/react'
import { generateDiffFile } from '@git-diff-view/file'
import '@git-diff-view/react/styles/diff-view.css'
import { cn } from '../../lib/utils'
import { useOverlayMode, OVERLAY_LAYOUT } from '../../lib/layout'
import { PreviewHeader } from '../ui/PreviewHeader'
import { usePlatform } from '../../context/PlatformContext'
import type { FileChange } from './MultiDiffPreviewOverlay'

export interface DiffReviewSheetProps {
  /** Whether the sheet is open */
  isOpen: boolean
  /** Callback when sheet closes */
  onClose: () => void
  /** File changes to review */
  changes: FileChange[]
  /** Callback when all changes are accepted */
  onAcceptAll: () => void
  /** Callback when all changes are rejected */
  onRejectAll: () => void
  /** Theme mode */
  theme?: 'light' | 'dark'
  /** Initially selected file index */
  initialSelectedIndex?: number
}

/**
 * Get file extension for language detection
 */
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()

  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    css: 'css',
    html: 'html',
    json: 'json',
    md: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    sh: 'shell',
    bash: 'bash',
  }

  return languageMap[ext || ''] || 'plaintext'
}

/**
 * Get file name from path
 */
function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

/**
 * Get parent directory from path
 */
function getParentDir(filePath: string): string {
  const parts = filePath.split('/')
  parts.pop()
  return parts.join('/')
}

/**
 * Determine file status badge
 */
function getFileStatus(change: FileChange): {
  label: string
  icon: React.ElementType
  color: string
} {
  if (change.toolType === 'Write' || change.original === '') {
    return {
      label: 'A',
      icon: FilePlus,
      color: 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950/30',
    }
  }

  if (change.modified === '') {
    return {
      label: 'D',
      icon: FileX,
      color: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30',
    }
  }

  return {
    label: 'M',
    icon: FileEdit,
    color: 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30',
  }
}

/**
 * DiffReviewSheet component
 */
export function DiffReviewSheet({
  isOpen,
  onClose,
  changes,
  onAcceptAll,
  onRejectAll,
  theme = 'light',
  initialSelectedIndex = 0,
}: DiffReviewSheetProps) {
  const responsiveMode = useOverlayMode()
  const isModal = responsiveMode === 'modal'
  const { onSetTrafficLightsVisible } = usePlatform()

  // Hide macOS traffic lights when overlay opens
  useEffect(() => {
    if (!isOpen) return

    onSetTrafficLightsVisible?.(false)
    return () => onSetTrafficLightsVisible?.(true)
  }, [isOpen, onSetTrafficLightsVisible])

  const isDark = theme === 'dark'

  // Filter successful changes
  const successfulChanges = useMemo(() => {
    return changes.filter(c => !c.error)
  }, [changes])

  // Selected index state
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex)

  // Reset to bounds when changes array updates
  useEffect(() => {
    if (selectedIndex >= successfulChanges.length) {
      setSelectedIndex(Math.max(0, successfulChanges.length - 1))
    }
  }, [successfulChanges.length, selectedIndex])

  // Get selected change
  const selectedChange = successfulChanges[selectedIndex]

  // Generate diff file for @git-diff-view
  const diffFile = useMemo(() => {
    if (!selectedChange) return null

    try {
      const language = getLanguageFromPath(selectedChange.filePath)
      const file = generateDiffFile(
        selectedChange.filePath,
        selectedChange.original,
        selectedChange.filePath,
        selectedChange.modified,
        language,
        language
      )

      file.initTheme(theme)
      file.init()
      file.buildSplitDiffLines()

      return file
    } catch (error) {
      console.error('Failed to generate diff file:', error)
      return null
    }
  }, [selectedChange, theme])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === 'Escape') {
        onClose()
        return
      }

      // Arrow up / k - previous file
      if ((e.key === 'ArrowUp' || e.key === 'k') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setSelectedIndex(prev => Math.max(0, prev - 1))
        return
      }

      // Arrow down / j - next file
      if ((e.key === 'ArrowDown' || e.key === 'j') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(successfulChanges.length - 1, prev + 1))
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, successfulChanges.length])

  if (!isOpen || successfulChanges.length === 0) return null

  const showSidebar = successfulChanges.length > 1

  const headerContent = (
    <>
      <span className="text-sm font-medium">
        Reviewing Changes
      </span>
      <span className="text-xs text-muted-foreground ml-2">
        {successfulChanges.length} {successfulChanges.length === 1 ? 'file' : 'files'}
      </span>
    </>
  )

  const mainContent = (
    <div className="flex h-full">
      {/* Sidebar */}
      {showSidebar && (
        <div
          className="w-[220px] flex-shrink-0 border-r overflow-y-auto"
          style={{
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
            backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
          }}
        >
          <div className="p-2 space-y-1">
            {successfulChanges.map((change, index) => {
              const status = getFileStatus(change)
              const fileName = getFileName(change.filePath)
              const parentDir = getParentDir(change.filePath)
              const isSelected = index === selectedIndex
              const StatusIcon = status.icon

              return (
                <button
                  key={change.id}
                  onClick={() => setSelectedIndex(index)}
                  className={cn(
                    "w-full text-left px-2.5 py-2 rounded-md",
                    "transition-colors",
                    "hover:bg-accent/50",
                    isSelected && "bg-accent"
                  )}
                >
                  <div className="flex items-start gap-2">
                    {/* Status badge */}
                    <span
                      className={cn(
                        "inline-flex items-center justify-center",
                        "w-5 h-5 rounded flex-shrink-0 mt-0.5",
                        "font-mono font-medium text-[10px]",
                        status.color
                      )}
                    >
                      {status.label}
                    </span>

                    {/* File path */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">
                        {fileName}
                      </div>
                      {parentDir && (
                        <div className="text-[10px] text-muted-foreground/60 truncate mt-0.5 font-mono">
                          {parentDir}
                        </div>
                      )}
                    </div>

                    {/* Selection indicator */}
                    {isSelected && (
                      <div className="w-1.5 h-1.5 rounded-full bg-accent-foreground mt-2" />
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Main diff area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* File header */}
        {selectedChange && (
          <div
            className="px-4 py-3 border-b flex items-center justify-between"
            style={{
              borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              {(() => {
                const status = getFileStatus(selectedChange)
                const StatusIcon = status.icon
                return (
                  <div className="flex items-center gap-2">
                    <StatusIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="font-mono text-sm truncate">
                      {selectedChange.filePath}
                    </span>
                  </div>
                )
              })()}
            </div>
            {!showSidebar && (
              <span className="text-xs text-muted-foreground ml-2">
                1 file
              </span>
            )}
          </div>
        )}

        {/* Diff viewer */}
        <div className="flex-1 overflow-auto">
          {diffFile ? (
            <DiffView
              diffFile={diffFile}
              diffViewMode={DiffModeEnum.Unified}
              diffViewTheme={theme}
              diffViewHighlight
              diffViewWrap
              diffViewFontSize={13}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">
                Failed to generate diff view
              </p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div
          className="px-4 py-3 border-t flex items-center justify-end gap-2"
          style={{
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
          }}
        >
          <button
            onClick={onRejectAll}
            className={cn(
              "px-4 py-2 rounded-md",
              "text-sm font-medium",
              "bg-destructive/10 hover:bg-destructive/20",
              "text-destructive",
              "transition-colors",
              "flex items-center gap-2"
            )}
          >
            <XCircle className="w-4 h-4" />
            Reject All
          </button>
          <button
            onClick={onAcceptAll}
            className={cn(
              "px-4 py-2 rounded-md",
              "text-sm font-medium",
              "bg-green-500/10 hover:bg-green-500/20",
              "text-green-600 dark:text-green-400",
              "transition-colors",
              "flex items-center gap-2"
            )}
          >
            <Check className="w-4 h-4" />
            Accept All
          </button>
        </div>
      </div>
    </div>
  )

  // Portal target
  const portalTarget = typeof document !== 'undefined'
    ? document.getElementById('overlay-portal') || document.body
    : null

  if (!portalTarget) return null

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
      onClick={(e) => {
        // Close when clicking backdrop
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className={cn(
          "flex flex-col",
          "rounded-lg overflow-hidden shadow-2xl",
          isModal ? "w-[95vw] h-[95vh]" : "w-full h-full"
        )}
        style={{
          backgroundColor: isDark ? '#1e1e1e' : '#ffffff',
          color: isDark ? '#e4e4e4' : '#1a1a1a',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <PreviewHeader
          onClose={onClose}
          theme={theme}
        >
          {headerContent}
        </PreviewHeader>

        {/* Main content */}
        {mainContent}
      </div>
    </div>,
    portalTarget
  )
}
