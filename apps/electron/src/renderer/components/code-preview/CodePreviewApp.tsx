import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import loader from '@monaco-editor/loader'
import * as monaco from 'monaco-editor'
import { BookOpen, PenLine, XCircle } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowHeader, WindowHeaderBadge, BADGE_CONFIGS } from '@/components/ui/window-header-badge'
import type { CodePreviewData } from '../../../shared/types'

// Configure loader to use local monaco-editor package (not CDN)
// This is required because CSP blocks external scripts from cdn.jsdelivr.net
loader.config({ monaco })

interface CodePreviewAppProps {
  sessionId: string
  previewId: string
}

/**
 * CodePreviewApp - Monaco editor for viewing file content (Read/Write tools)
 */
export function CodePreviewApp({ sessionId, previewId }: CodePreviewAppProps) {
  const { resolvedMode } = useTheme()
  const [data, setData] = useState<CodePreviewData | null>(null)
  const [isEditorReady, setIsEditorReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch code data on mount
  useEffect(() => {
    async function fetchData() {
      if (!sessionId || !previewId) {
        setError('Missing session or preview ID')
        return
      }

      if (!window.electronAPI?.getCodePreviewData) {
        setError('API not available')
        return
      }

      try {
        const result = await window.electronAPI.getCodePreviewData(sessionId, previewId)
        if (!result) {
          setError('Code data not found')
          return
        }
        setData(result)
      } catch (err) {
        setError(String(err))
      }
    }

    fetchData()
  }, [sessionId, previewId])

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
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
    }
    return languageMap[ext || ''] || 'plaintext'
  }, [])

  // Format file path for display (show relative path if possible)
  const formatFilePath = useCallback((filePath: string): string => {
    const homeMatch = filePath.match(/^\/Users\/[^/]+\/(.+)$/)
    if (homeMatch) {
      return `~/${homeMatch[1]}`
    }
    return filePath
  }, [])

  // Monaco theme backgrounds
  const monacoBackground = resolvedMode === 'dark' ? '#1e1e1e' : '#ffffff'
  const toolbarBorder = resolvedMode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'

  // Mode badge config
  const modeConfig = data?.mode === 'write'
    ? { Icon: PenLine, label: 'Write', ...BADGE_CONFIGS.write }
    : { Icon: BookOpen, label: 'Read', ...BADGE_CONFIGS.read }

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
                Icon={modeConfig.Icon}
                label={modeConfig.label}
                bgColor={modeConfig.bgColor}
                textColor={modeConfig.textColor}
              />
              <WindowHeaderBadge
                label={formatFilePath(data.filePath)}
                onClick={handleOpenFile}
                {...(isDark ? BADGE_CONFIGS.neutralDark : BADGE_CONFIGS.neutralLight)}
              />
              {data.startLine !== undefined && data.totalLines !== undefined && (
                <WindowHeaderBadge
                  label={`Lines ${data.startLine}–${data.startLine + (data.numLines || 0) - 1} of ${data.totalLines}`}
                  {...(isDark ? BADGE_CONFIGS.dimmedDark : BADGE_CONFIGS.dimmedLight)}
                />
              )}
            </>
          )}
        </WindowHeader>

        {/* Tool error banner - shown when the Write tool failed */}
        {data?.error && (
          <div className="px-4 py-3 bg-destructive/10 border-b border-destructive/20 flex items-start gap-3">
            <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-destructive/70 mb-0.5">Write Failed</div>
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

        {/* Code Editor with fade-in */}
        {data && !error && (
          <div
            className="flex-1 min-h-0 transition-opacity duration-200"
            style={{ opacity: isEditorReady ? 1 : 0, backgroundColor: monacoBackground }}
          >
            <Editor
              height="100%"
              language={getLanguage(data.filePath, data.language)}
              theme={resolvedMode === 'dark' ? 'vs-dark' : 'vs'}
              value={data.content}
              onMount={handleEditorMount}
              loading={null}
              options={{
                // Typography
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 13,
                lineHeight: 1.6,
                wordWrap: 'on',

                // Read-only mode
                readOnly: true,

                // Layout
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                padding: { top: 16, bottom: 16 },

                // Show line numbers
                lineNumbers: 'on',
                lineNumbersMinChars: 4,

                // Hide right-side indicators
                overviewRulerLanes: 0,
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

                // Disable code-editor features
                occurrencesHighlight: 'off',
                selectionHighlight: false,
                renderWhitespace: 'selection',
                matchBrackets: 'never',

                // Disable gutter decorations
                glyphMargin: false,
                folding: true,
                lineDecorationsWidth: 0,
              }}
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
