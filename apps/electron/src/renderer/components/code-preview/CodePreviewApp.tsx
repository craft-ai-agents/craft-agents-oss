import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { BookOpen, PenLine, XCircle } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowHeader, WindowHeaderBadge, BADGE_CONFIGS } from '@/components/ui/window-header-badge'
import { formatFilePath } from '@/lib/file-utils'
import { ShikiCodeViewer } from '@/components/shiki'
import type { CodePreviewData } from '../../../shared/types'

interface CodePreviewAppProps {
  sessionId: string
  previewId: string
}

/**
 * CodePreviewApp - Shiki-based code viewer for file content (Read/Write tools)
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

  // Editor ready callback
  const handleEditorReady = useCallback(() => {
    setIsEditorReady(true)
  }, [])

  // Theme colors
  const backgroundColor = resolvedMode === 'dark' ? '#1e1e1e' : '#ffffff'
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
      <div className="h-screen w-screen flex flex-col" style={{ backgroundColor }}>
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

        {/* Code Viewer with fade-in */}
        {data && !error && (
          <div
            className="flex-1 min-h-0 transition-opacity duration-200"
            style={{ opacity: isEditorReady ? 1 : 0, backgroundColor }}
          >
            <ShikiCodeViewer
              code={data.content}
              filePath={data.filePath}
              language={data.language}
              startLine={data.startLine || 1}
              onReady={handleEditorReady}
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
