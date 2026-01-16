/**
 * DiffPreviewOverlay - Overlay for diff preview (Edit tool)
 *
 * Uses PreviewOverlay for presentation and ShikiDiffViewer for diff display.
 */

import * as React from 'react'
import { PencilLine } from 'lucide-react'
import { PreviewOverlay } from './PreviewOverlay'
import { ShikiDiffViewer } from '../code-viewer/ShikiDiffViewer'
import { truncateFilePath } from '../code-viewer/language-map'

export interface DiffPreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close */
  onClose: () => void
  /** Original content (before edit) */
  original: string
  /** Modified content (after edit) */
  modified: string
  /** File path for language detection and display */
  filePath: string
  /** Language for syntax highlighting (auto-detected if not provided) */
  language?: string
  /** Diff style: 'unified' or 'split' */
  diffStyle?: 'unified' | 'split'
  /** Theme mode */
  theme?: 'light' | 'dark'
  /** Error message if tool failed */
  error?: string
  /** Callback to open file in external editor */
  onOpenFile?: (filePath: string) => void
}

export function DiffPreviewOverlay({
  isOpen,
  onClose,
  original,
  modified,
  filePath,
  language,
  diffStyle = 'unified',
  theme = 'light',
  error,
  onOpenFile,
}: DiffPreviewOverlayProps) {
  const backgroundColor = theme === 'dark' ? '#1e1e1e' : '#ffffff'

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      theme={theme}
      badge={{
        icon: PencilLine,
        label: 'Edit',
        variant: 'orange',
      }}
      title={truncateFilePath(filePath)}
      onTitleClick={onOpenFile ? () => onOpenFile(filePath) : undefined}
      error={error ? { label: 'Edit Failed', message: error } : undefined}
      backgroundColor={backgroundColor}
    >
      <div className="h-full" style={{ backgroundColor }}>
        <ShikiDiffViewer
          original={original}
          modified={modified}
          filePath={filePath}
          language={language}
          diffStyle={diffStyle}
          theme={theme}
        />
      </div>
    </PreviewOverlay>
  )
}
