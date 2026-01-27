/**
 * PDFPreviewOverlay - In-app PDF preview for the link interceptor.
 *
 * Loads a PDF via data URL (from READ_FILE_DATA_URL IPC) and embeds it
 * using Chromium's built-in PDF viewer. File path badge provides "Open"
 * and "Reveal in Finder" via PlatformContext (dual-trigger menu).
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import { FileText } from 'lucide-react'
import { PreviewOverlay } from './PreviewOverlay'
import { CopyButton } from './CopyButton'

export interface PDFPreviewOverlayProps {
  isOpen: boolean
  onClose: () => void
  /** Absolute file path for the PDF */
  filePath: string
  /** Async loader that returns a data URL (data:application/pdf;base64,...) */
  loadDataUrl: (path: string) => Promise<string>
  theme?: 'light' | 'dark'
}

export function PDFPreviewOverlay({
  isOpen,
  onClose,
  filePath,
  loadDataUrl,
  theme = 'light',
}: PDFPreviewOverlayProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load the PDF data when the overlay opens or the path changes
  useEffect(() => {
    if (!isOpen || !filePath) return

    let cancelled = false
    setIsLoading(true)
    setError(null)
    setDataUrl(null)

    loadDataUrl(filePath)
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load PDF')
          setIsLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [isOpen, filePath, loadDataUrl])

  // Copy path button as header action
  const headerActions = (
    <CopyButton content={filePath} title="Copy path" />
  )

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      theme={theme}
      typeBadge={{
        icon: FileText,
        label: 'PDF',
        variant: 'orange',
      }}
      filePath={filePath}
      error={error ? { label: 'Load Failed', message: error } : undefined}
      headerActions={headerActions}
    >
      <div className="h-full flex flex-col">
        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-muted-foreground text-sm">Loading PDF...</span>
          </div>
        )}
        {/* Embed PDF using Chromium's built-in PDF viewer */}
        {dataUrl && (
          <embed
            src={dataUrl}
            type="application/pdf"
            className="flex-1 w-full min-h-0"
          />
        )}
      </div>
    </PreviewOverlay>
  )
}
