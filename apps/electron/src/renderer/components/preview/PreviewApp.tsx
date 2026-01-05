import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import loader from '@monaco-editor/loader'
import * as monaco from 'monaco-editor'
import { Save } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import type { MarkdownPreviewData } from '../../../shared/types'

// Configure loader to use local monaco-editor package (not CDN)
// This is required because CSP blocks external scripts from cdn.jsdelivr.net
loader.config({ monaco })

interface PreviewAppProps {
  previewId: string
}

/**
 * PreviewApp - Monaco markdown editor with toolbar
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

  // Monaco mounted callback
  const handleEditorMount = useCallback(() => {
    requestAnimationFrame(() => {
      setIsEditorReady(true)
    })
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

  // Monaco theme backgrounds
  const monacoBackground = resolvedMode === 'dark' ? '#1e1e1e' : '#ffffff'
  const toolbarBorder = resolvedMode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'

  return (
    <TooltipProvider delayDuration={0}>
      <div className="h-screen w-screen flex flex-col" style={{ backgroundColor: monacoBackground }}>
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
            className="flex-1 min-h-0 transition-opacity duration-200 pl-6"
            style={{ opacity: isEditorReady ? 1 : 0, backgroundColor: monacoBackground }}
          >
            <Editor
              height="100%"
              language="markdown"
              theme={resolvedMode === 'dark' ? 'vs-dark' : 'vs'}
              value={content}
              onChange={(value) => !isReadOnly && setContent(value ?? '')}
              onMount={handleEditorMount}
              loading={null}
              options={{
                // Typography
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 14,
                lineHeight: 1.6,
                wordWrap: 'on',

                // Read-only mode
                readOnly: isReadOnly,
                domReadOnly: isReadOnly,

                // Clean layout
                minimap: { enabled: false },
                lineNumbers: 'off',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                padding: { top: 24, bottom: 24 },

                // Hide right-side indicators
                overviewRulerLanes: 0,
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                renderLineHighlight: 'none',

                // Clean scrollbar
                scrollbar: {
                  vertical: 'auto',
                  horizontal: 'hidden',
                  verticalScrollbarSize: 8,
                  useShadows: false,
                },

                // Disable gutter decorations
                glyphMargin: false,
                folding: false,
                lineDecorationsWidth: 0,
                lineNumbersMinChars: 0,

                // Disable code-editor features (markdown-focused)
                occurrencesHighlight: 'off',
                selectionHighlight: false,
                renderWhitespace: 'none',
                matchBrackets: 'never',

                // Editing behavior
                tabSize: 2,
                insertSpaces: true,
                autoClosingBrackets: 'never',
                autoClosingQuotes: 'never',
                autoSurround: 'never',
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                acceptSuggestionOnEnter: 'off',
                wordBasedSuggestions: 'off',
              }}
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
