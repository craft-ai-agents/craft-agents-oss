import * as React from 'react'
import { Copy, ExternalLink, Globe2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WebPreviewTarget } from './web-preview'

interface OutputWebPreviewProps {
  target: WebPreviewTarget
  className?: string
}

export function OutputWebPreview({ target, className }: OutputWebPreviewProps) {
  const [frameKey, setFrameKey] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    setFrameKey((key) => key + 1)
    setIsLoading(true)
  }, [target.url])

  const reload = React.useCallback(() => {
    setFrameKey((key) => key + 1)
    setIsLoading(true)
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
        {isLoading ? (
          <div className="absolute inset-x-0 top-0 z-[1] bg-background/85 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
            Loading preview...
          </div>
        ) : null}
        <iframe
          key={frameKey}
          src={target.url}
          title={target.label}
          sandbox="allow-scripts allow-forms allow-same-origin"
          referrerPolicy="no-referrer"
          className="h-full w-full border-0 bg-white"
          onLoad={() => setIsLoading(false)}
        />
      </div>
    </div>
  )
}
