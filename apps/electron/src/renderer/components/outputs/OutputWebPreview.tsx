import * as React from 'react'
import { Copy, ExternalLink, Globe2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WebPreviewTarget } from './web-preview'

const WEB_PREVIEW_LOAD_TIMEOUT_MS = 8000

interface OutputWebPreviewProps {
  target: WebPreviewTarget
  className?: string
}

export function OutputWebPreview({ target, className }: OutputWebPreviewProps) {
  const [frameKey, setFrameKey] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setFrameKey((key) => key + 1)
    setIsLoading(true)
    setLoadError(null)
  }, [target.url])

  React.useEffect(() => {
    if (!isLoading) return
    const timeout = window.setTimeout(() => {
      setIsLoading(false)
      setLoadError('Preview did not finish loading.')
    }, WEB_PREVIEW_LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [frameKey, isLoading])

  const reload = React.useCallback(() => {
    setFrameKey((key) => key + 1)
    setIsLoading(true)
    setLoadError(null)
  }, [])

  const copyUrl = React.useCallback(() => {
    navigator.clipboard?.writeText(target.url).catch(() => {})
  }, [target.url])

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col overflow-hidden rounded-md border border-border/55 bg-background/80', className)}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/45 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Globe2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-foreground">{target.label}</div>
            <div className="truncate text-[10px] text-muted-foreground">{target.displayHost}</div>
          </div>
        </div>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Reload preview" onClick={reload}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Copy preview URL" onClick={copyUrl}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Open preview externally" onClick={() => window.electronAPI.openUrl(target.url)}>
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        {isLoading && !loadError ? (
          <div className="absolute inset-x-0 top-0 z-[2] bg-background/85 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
            Loading preview...
          </div>
        ) : null}
        {loadError ? (
          <div className="absolute inset-0 z-[2] flex items-center justify-center bg-background/92 p-4 text-center backdrop-blur">
            <div className="max-w-sm rounded-md border border-border/60 bg-background p-4 shadow-modal-small">
              <div className="text-sm font-medium text-foreground">Preview unavailable</div>
              <div className="mt-1 text-xs text-muted-foreground">{loadError}</div>
              <div className="mt-3 flex justify-center gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={reload}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => window.electronAPI.openUrl(target.url)}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open external
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        <iframe
          key={frameKey}
          src={target.url}
          title={target.label}
          sandbox="allow-scripts allow-forms allow-same-origin"
          referrerPolicy="no-referrer"
          className="h-full w-full border-0 bg-white"
          onLoad={() => {
            setIsLoading(false)
            setLoadError(null)
          }}
          onError={() => {
            setIsLoading(false)
            setLoadError('Preview failed to load.')
          }}
        />
      </div>
    </div>
  )
}
