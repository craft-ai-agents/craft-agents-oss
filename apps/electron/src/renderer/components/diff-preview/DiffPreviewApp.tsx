import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { PencilLine, XCircle } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WindowHeader, WindowHeaderBadge, BADGE_CONFIGS } from '@/components/ui/window-header-badge'
import { formatFilePath } from '@/lib/file-utils'
import { ShikiDiffViewer } from '@/components/shiki'
import type { DiffPreviewData } from '../../../shared/types'

interface DiffPreviewAppProps {
  sessionId: string
  diffId: string
}

/**
 * DiffPreviewApp - Shiki-based diff viewer for file changes
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

  // Editor ready callback
  const handleEditorReady = useCallback(() => {
    setIsEditorReady(true)
  }, [])

  // Theme colors
  const backgroundColor = resolvedMode === 'dark' ? '#1e1e1e' : '#ffffff'
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
      <div className="h-screen w-screen flex flex-col" style={{ backgroundColor }}>
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

        {/* Diff Viewer with fade-in */}
        {data && !error && (
          <div
            className="flex-1 min-h-0 transition-opacity duration-200"
            style={{ opacity: isEditorReady ? 1 : 0, backgroundColor }}
          >
            <ShikiDiffViewer
              original={data.original}
              modified={data.modified}
              filePath={data.filePath}
              language={data.language}
              diffStyle="unified"
              onReady={handleEditorReady}
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
