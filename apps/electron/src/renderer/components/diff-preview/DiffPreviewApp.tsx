import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import loader from '@monaco-editor/loader'
import * as monaco from 'monaco-editor'
import { PencilLine, XCircle } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowHeader, WindowHeaderBadge, BADGE_CONFIGS } from '@/components/ui/window-header-badge'
import { getLanguageFromPath, formatFilePath } from '@/lib/file-utils'
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

        {/* Tool error banner - shown when the Edit tool failed */}
        {data?.error && (
          <div className="px-4 py-3 bg-destructive/10 border-b border-destructive/20 flex items-start gap-3">
            <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-destructive/70 mb-0.5">Edit Failed</div>
              <p className="text-sm text-destructive whitespace-pre-wrap break-words">{data.error}</p>
            </div>
          </div>
        )}

        {/* Fetch error overlay */}
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
              language={getLanguageFromPath(data.filePath, data.language)}
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
