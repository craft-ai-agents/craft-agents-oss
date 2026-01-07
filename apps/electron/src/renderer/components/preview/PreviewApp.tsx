import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { Save } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { ShikiCodeEditor } from '@/components/shiki'
import type { MarkdownPreviewData } from '../../../shared/types'

interface PreviewAppProps {
  previewId: string
}

/**
 * PreviewApp - Shiki-based markdown editor with toolbar
 *
 * Supports two modes:
 * - readOnly: View-only mode, no save button
 * - readWrite: Editable with save functionality
 */
export function PreviewApp({ previewId }: PreviewAppProps) {
  const { resolvedMode } = useTheme()
  const [data, setData] = useState<MarkdownPreviewData | null>(null)
  const [originalContent, setOriginalContent] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [isEditorReady, setIsEditorReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const isReadOnly = data?.mode === 'readOnly'
  const hasUnsavedChanges = !isReadOnly && content !== null && originalContent !== null && content !== originalContent

  // Fetch data on mount
  useEffect(() => {
    async function fetchData() {
      if (!previewId) {
        setError('Missing preview ID')
        return
      }

      if (!window.electronAPI?.getMarkdownPreviewData) {
        setError('API not available')
        return
      }

      try {
        const result = await window.electronAPI.getMarkdownPreviewData(previewId)
        if (!result) {
          setError('Preview data not found')
          return
        }
        setData(result.data)
        setOriginalContent(result.content)
        setContent(result.content)
      } catch (err) {
        setError(String(err))
      }
    }

    fetchData()
  }, [previewId])

  // Editor ready callback
  const handleEditorReady = useCallback(() => {
    setIsEditorReady(true)
  }, [])

  // Save handler
  const handleSave = useCallback(async () => {
    if (!hasUnsavedChanges || isSaving || content === null) return

    setIsSaving(true)
    try {
      await window.electronAPI.saveMarkdownPreview(previewId, content)
      setOriginalContent(content)
    } catch (err) {
      console.error('[PreviewApp] Save failed:', err)
    } finally {
      setIsSaving(false)
    }
  }, [previewId, content, hasUnsavedChanges, isSaving])

  // Keyboard shortcut for save (only in readWrite mode)
  useEffect(() => {
    if (isReadOnly) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, isReadOnly])

  // Theme colors
  const backgroundColor = resolvedMode === 'dark' ? '#1e1e1e' : '#ffffff'
  const toolbarBorder = resolvedMode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'

  return (
    <TooltipProvider delayDuration={0}>
      <div className="h-screen w-screen flex flex-col" style={{ backgroundColor }}>
        {/* Toolbar / Title bar */}
        <div
          className="titlebar-drag-region h-[52px] shrink-0 flex items-center justify-between px-4"
          style={{ borderBottom: `1px solid ${toolbarBorder}` }}
        >
          {/* Left side - space for traffic lights on macOS */}
          <div className="w-[70px]" />

          {/* Center - optional title or indicator */}
          <div className="flex items-center gap-2">
            {hasUnsavedChanges && (
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: resolvedMode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                  color: resolvedMode === 'dark' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)',
                }}
              >
                Edited
              </span>
            )}
          </div>

          {/* Right side - actions (only show save in readWrite mode) */}
          <div className="flex items-center gap-1 titlebar-no-drag">
            {!isReadOnly && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSave}
                    disabled={!hasUnsavedChanges || isSaving}
                    className="h-7 w-7 rounded-[4px] hover:bg-foreground/10 disabled:opacity-30"
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <span>Save</span>
                  <Kbd className="ml-2">⌘S</Kbd>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Error overlay */}
        {error && (
          <div className="flex-1 flex items-center justify-center text-destructive">
            Error: {error}
          </div>
        )}

        {/* Editor with fade-in */}
        {content !== null && !error && (
          <div
            className="flex-1 min-h-0 transition-opacity duration-200"
            style={{ opacity: isEditorReady ? 1 : 0, backgroundColor }}
          >
            <ShikiCodeEditor
              value={content}
              language="markdown"
              onChange={(value) => !isReadOnly && setContent(value)}
              readOnly={isReadOnly}
              onReady={handleEditorReady}
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
