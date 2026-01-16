/**
 * CodePreviewOverlay - Overlay for code file preview (Read/Write tools)
 *
 * Uses PreviewOverlay for presentation and ShikiCodeViewer for syntax highlighting.
 */

import * as React from 'react'
import { BookOpen, PenLine } from 'lucide-react'
import { PreviewOverlay } from './PreviewOverlay'
import { ShikiCodeViewer } from '../code-viewer/ShikiCodeViewer'
import { truncateFilePath } from '../code-viewer/language-map'

export interface CodePreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close */
  onClose: () => void
  /** The code content to display */
  content: string
  /** File path for language detection and display */
  filePath: string
  /** Language for syntax highlighting (auto-detected if not provided) */
  language?: string
  /** Mode: 'read' or 'write' */
  mode?: 'read' | 'write'
  /** Starting line number (default: 1) */
  startLine?: number
  /** Total lines in original file (for display) */
  totalLines?: number
  /** Number of lines shown */
  numLines?: number
  /** Theme mode */
  theme?: 'light' | 'dark'
  /** Error message if tool failed */
  error?: string
  /** Callback to open file in external editor */
  onOpenFile?: (filePath: string) => void
}

export function CodePreviewOverlay({
  isOpen,
  onClose,
  content,
  filePath,
  language,
  mode = 'read',
  startLine = 1,
  totalLines,
  numLines,
  theme = 'light',
  error,
  onOpenFile,
}: CodePreviewOverlayProps) {
  const backgroundColor = theme === 'dark' ? '#1e1e1e' : '#ffffff'

  // Build subtitle with line info
  const subtitle =
    startLine !== undefined && totalLines !== undefined && numLines !== undefined
      ? `Lines ${startLine}–${startLine + numLines - 1} of ${totalLines}`
      : undefined

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      theme={theme}
      badge={{
        icon: mode === 'write' ? PenLine : BookOpen,
        label: mode === 'write' ? 'Write' : 'Read',
        variant: mode === 'write' ? 'amber' : 'blue',
      }}
      title={truncateFilePath(filePath)}
      onTitleClick={onOpenFile ? () => onOpenFile(filePath) : undefined}
      subtitle={subtitle}
      error={error ? { label: mode === 'write' ? 'Write Failed' : 'Read Failed', message: error } : undefined}
      backgroundColor={backgroundColor}
    >
      <div className="h-full" style={{ backgroundColor }}>
        <ShikiCodeViewer
          code={content}
          filePath={filePath}
          language={language}
          startLine={startLine}
          theme={theme}
        />
      </div>
    </PreviewOverlay>
  )
}
