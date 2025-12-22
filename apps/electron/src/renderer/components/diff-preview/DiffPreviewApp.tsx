import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import loader from '@monaco-editor/loader'
import * as monaco from 'monaco-editor'
import { PencilLine } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowHeader, WindowHeaderBadge, BADGE_CONFIGS } from '@/components/ui/window-header-badge'
import type { DiffPreviewData } from '../../../shared/types'

// Configure loader to use local monaco-editor package (not CDN)
// This is required because CSP blocks external scripts from cdn.jsdelivr.net
loader.config({ monaco })

interface DiffPreviewAppProps {
  sessionId: string
  diffId: string
}

/**
 * DiffPreviewApp - Monaco diff editor for viewing file changes
 */
export function DiffPreviewApp({ sessionId, diffId }: DiffPreviewAppProps) {
  const { resolvedMode } = useTheme()
  const [data, setData] = useState<DiffPreviewData | null>(null)
  const [isEditorReady, setIsEditorReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch diff data on mount
  useEffect(() => {
    async function fetchData() {
      if (!sessionId || !diffId) {
        setError('Missing session or diff ID')
        return
      }

      if (!window.electronAPI?.getDiffPreviewData) {
        setError('API not available')
        return
      }

      try {
        const result = await window.electronAPI.getDiffPreviewData(sessionId, diffId)
        if (!result) {
          setError('Diff data not found')
          return
        }
        setData(result)
      } catch (err) {
        setError(String(err))
      }
    }

    fetchData()
  }, [sessionId, diffId])

  // Monaco mounted callback
  const handleEditorMount = useCallback(() => {
    requestAnimationFrame(() => {
      setIsEditorReady(true)
    })
  }, [])

  // Detect language from file extension
  const getLanguage = useCallback((filePath: string, explicit?: string): string => {
    if (explicit) return explicit

    const ext = filePath.split('.').pop()?.toLowerCase()
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      json: 'json',
      md: 'markdown',
      py: 'python',
      rb: 'ruby',
      rs: 'rust',
      go: 'go',
      java: 'java',
      kt: 'kotlin',
      swift: 'swift',
      css: 'css',
      scss: 'scss',
      less: 'less',
      html: 'html',
      xml: 'xml',
      yaml: 'yaml',
      yml: 'yaml',
      sh: 'shell',
      bash: 'shell',
      sql: 'sql',
      graphql: 'graphql',
      dockerfile: 'dockerfile',
      toml: 'toml',
    }
    return languageMap[ext || ''] || 'plaintext'
  }, [])

  // Format file path for display (show relative path if possible)
  const formatFilePath = useCallback((filePath: string): string => {
    // Try to show a shorter path by finding common patterns
    const homeMatch = filePath.match(/^\/Users\/[^/]+\/(.+)$/)
    if (homeMatch) {
      return `~/${homeMatch[1]}`
    }
    return filePath
  }, [])

  // Monaco theme backgrounds
  const monacoBackground = resolvedMode === 'dark' ? '#1e1e1e' : '#ffffff'
  const toolbarBorder = resolvedMode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'

  // Open file in default macOS app
  const handleOpenFile = useCallback(() => {
    if (data?.filePath) {
      window.electronAPI?.openFile(data.filePath)
    }
  }, [data?.filePath])

  const isDark = resolvedMode === 'dark'

  return (
    <TooltipProvider delayDuration={0}>
      <div className="h-screen w-screen flex flex-col" style={{ backgroundColor: monacoBackground }}>
        <WindowHeader borderColor={toolbarBorder}>
          {data && (
            <>
              <WindowHeaderBadge
                Icon={PencilLine}
                label="Edit"
                {...BADGE_CONFIGS.edit}
              />
              <WindowHeaderBadge
                label={formatFilePath(data.filePath)}
                onClick={handleOpenFile}
                {...(isDark ? BADGE_CONFIGS.neutralDark : BADGE_CONFIGS.neutralLight)}
              />
            </>
          )}
        </WindowHeader>

        {/* Error overlay */}
        {error && (
          <div className="flex-1 flex items-center justify-center text-destructive">
            Error: {error}
          </div>
        )}

        {/* Diff Editor with fade-in */}
        {data && !error && (
          <div
            className="flex-1 min-h-0 transition-opacity duration-200"
            style={{ opacity: isEditorReady ? 1 : 0, backgroundColor: monacoBackground }}
          >
            <DiffEditor
              height="100%"
              language={getLanguage(data.filePath, data.language)}
              theme={resolvedMode === 'dark' ? 'vs-dark' : 'vs'}
              original={data.original}
              modified={data.modified}
              onMount={handleEditorMount}
              loading={null}
              options={{
                // Typography
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 13,
                lineHeight: 1.6,

                // Layout
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                padding: { top: 16, bottom: 16 },

                // Diff-specific options
                renderSideBySide: false,
                enableSplitViewResizing: true,
                renderOverviewRuler: true,

                // Read-only mode (diffs are for viewing only)
                readOnly: true,

                // Hide right-side indicators
                overviewRulerLanes: 3,
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                renderLineHighlight: 'none',

                // Clean scrollbar
                scrollbar: {
                  vertical: 'auto',
                  horizontal: 'auto',
                  verticalScrollbarSize: 10,
                  horizontalScrollbarSize: 10,
                  useShadows: false,
                },

                // Show line numbers for context
                lineNumbers: 'on',
                lineNumbersMinChars: 4,

                // Disable code-editor features
                occurrencesHighlight: 'off',
                selectionHighlight: false,
                renderWhitespace: 'selection',
                matchBrackets: 'never',
              }}
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
