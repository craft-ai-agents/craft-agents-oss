/**
 * CodePreviewOverlay - Overlay for code file preview (Read/Write tools)
 *
 * Uses PreviewOverlay for presentation and ShikiCodeViewer for syntax highlighting.
 * File path badge provides "Open" / "Reveal in Finder" via PlatformContext.
 */

import * as React from 'react'
import { BookOpen, PenLine } from 'lucide-react'
import { PreviewOverlay } from './PreviewOverlay'
import { ContentFrame } from './ContentFrame'
import { ShikiCodeViewer } from '../code-viewer/ShikiCodeViewer'

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
  /** Render inline without dialog (for playground) */
  embedded?: boolean
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
  embedded,
}: CodePreviewOverlayProps) {
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
      typeBadge={{
        icon: mode === 'write' ? PenLine : BookOpen,
        label: mode === 'write' ? 'Write' : 'Read',
        variant: mode === 'write' ? 'amber' : 'blue',
      }}
      filePath={filePath}
      subtitle={subtitle}
      error={error ? { label: mode === 'write' ? 'Write Failed' : 'Read Failed', message: error } : undefined}
      embedded={embedded}
      className="bg-foreground-3"
    >
      <ContentFrame title="Code" fitContent minWidth={850}>
        <div>
          <ShikiCodeViewer
            code={content}
            filePath={filePath}
            language={language}
            startLine={startLine}
            theme={theme}
          />
        </div>
      </ContentFrame>
    </PreviewOverlay>
  )
}
