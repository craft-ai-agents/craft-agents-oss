/**
 * DocumentViewerPage
 *
 * Displays markdown document content in the main content panel.
 * Used when viewing search results from VectorSearch.
 */

import * as React from 'react'
import { useEffect, useState, useCallback } from 'react'
import { FileText, ExternalLink, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import {
  Info_Page,
  Info_Section,
  Info_Markdown,
} from '@/components/info'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { MoreHorizontal } from 'lucide-react'

interface DocumentViewerPageProps {
  /** Absolute file path to the document */
  filePath: string
}

export default function DocumentViewerPage({ filePath }: DocumentViewerPageProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Extract filename from path for display
  const fileName = filePath.split('/').pop() || filePath

  // Load document content
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadDocument = async () => {
      try {
        const fileContent = await window.electronAPI.readFile(filePath)

        if (!isMounted) return

        if (fileContent) {
          setContent(fileContent)
        } else {
          setError('File is empty or could not be read')
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Failed to load document')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadDocument()

    return () => {
      isMounted = false
    }
  }, [filePath])

  // Handle open in external editor
  const handleOpenExternal = useCallback(() => {
    window.electronAPI.openFile(filePath)
  }, [filePath])

  // Handle reveal in Finder
  const handleRevealInFinder = useCallback(() => {
    window.electronAPI.showInFolder(filePath)
  }, [filePath])

  // Handle copy path
  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(filePath)
      toast.success('Path copied to clipboard')
    } catch (err) {
      toast.error('Failed to copy path')
    }
  }, [filePath])

  return (
    <Info_Page loading={loading} error={error ?? undefined}>
      <Info_Page.Header
        title={fileName}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <HeaderIconButton icon={<MoreHorizontal className="h-4 w-4" />} />
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end" light>
              <StyledDropdownMenuItem onClick={handleOpenExternal}>
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open in Default App</span>
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={handleRevealInFinder}>
                <FolderOpen className="h-3.5 w-3.5" />
                <span>Reveal in Finder</span>
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={handleCopyPath}>
                <FileText className="h-3.5 w-3.5" />
                <span>Copy Path</span>
              </StyledDropdownMenuItem>
            </StyledDropdownMenuContent>
          </DropdownMenu>
        }
      />

      <Info_Page.Content>
        {/* File info */}
        <Info_Section title="Document">
          <div className="px-6 py-2 text-sm text-muted-foreground">
            <code className="text-xs bg-muted/50 px-1.5 py-0.5 rounded">{filePath}</code>
          </div>
        </Info_Section>

        {/* Document content */}
        {content && (
          <Info_Section title="Content">
            <Info_Markdown mode="full" fullscreen>
              {content}
            </Info_Markdown>
          </Info_Section>
        )}
      </Info_Page.Content>
    </Info_Page>
  )
}
