import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Globe, Loader2, AlertCircle } from 'lucide-react'

interface BrowserViewProps {
  url: string | null
}

// Check if running in browser mode (no Electron)
const isBrowserMode = () => {
  try {
    return window.electronAPI?.getVersions?.()?.electron === 'browser-mock'
  } catch {
    return true
  }
}

/**
 * Validates and normalizes a URL for the webview.
 */
function sanitizeUrl(url: string): string {
  let sanitized = url.trim()

  if (!sanitized.startsWith('http://') && !sanitized.startsWith('https://')) {
    sanitized = 'https://' + sanitized
  }

  try {
    const parsed = new URL(sanitized)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'https://craft.do'
    }
    return sanitized
  } catch {
    return 'https://craft.do'
  }
}

export function BrowserView({ url }: BrowserViewProps) {
  const [browserUrl, setBrowserUrl] = useState<string>(() =>
    url ? sanitizeUrl(url) : 'https://craft.do'
  )
  const [displayUrl, setDisplayUrl] = useState<string>(browserUrl)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const webviewRef = useRef<Electron.WebviewTag | HTMLIFrameElement>(null)
  const browserMode = useMemo(() => isBrowserMode(), [])

  // Update when url prop changes
  useEffect(() => {
    if (url) {
      const sanitized = sanitizeUrl(url)
      setBrowserUrl(sanitized)
      setDisplayUrl(sanitized)
      setError(null)
    }
  }, [url])

  // Set up webview event listeners (Electron only)
  useEffect(() => {
    if (browserMode) return

    const webview = webviewRef.current as Electron.WebviewTag | null
    if (!webview) return

    const handleDidNavigate = (event: Electron.DidNavigateEvent) => {
      setDisplayUrl(event.url)
      setError(null)
      setIsLoading(false)
    }

    const handleDidFailLoad = (event: Electron.DidFailLoadEvent) => {
      if (event.errorCode === -3) return // Ignore aborted loads
      setError(`Failed to load: ${event.errorDescription}`)
      setIsLoading(false)
    }

    const handleDidStartLoading = () => {
      setError(null)
      setIsLoading(true)
    }

    const handleDidStopLoading = () => {
      setIsLoading(false)
    }

    webview.addEventListener('did-navigate', handleDidNavigate)
    webview.addEventListener('did-navigate-in-page', handleDidNavigate as any)
    webview.addEventListener('did-fail-load', handleDidFailLoad)
    webview.addEventListener('did-start-loading', handleDidStartLoading)
    webview.addEventListener('did-stop-loading', handleDidStopLoading)

    return () => {
      webview.removeEventListener('did-navigate', handleDidNavigate)
      webview.removeEventListener('did-navigate-in-page', handleDidNavigate as any)
      webview.removeEventListener('did-fail-load', handleDidFailLoad)
      webview.removeEventListener('did-start-loading', handleDidStartLoading)
      webview.removeEventListener('did-stop-loading', handleDidStopLoading)
    }
  }, [browserMode])

  const handleNavigate = () => {
    const sanitized = sanitizeUrl(displayUrl)
    setBrowserUrl(sanitized)
    setDisplayUrl(sanitized)
    setError(null)
    if (webviewRef.current) {
      (webviewRef.current as any).src = sanitized
    }
  }

  if (!url) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
        <div className="size-16 bg-muted rounded-2xl flex items-center justify-center mb-4">
          <Globe className="size-8 text-muted-foreground/50" />
        </div>
        <p className="font-medium text-foreground">No URL loaded</p>
        <p className="text-sm mt-1">Click a URL in the chat to view it here</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* URL bar */}
      <div className="p-3 bg-muted/50 border-b shrink-0">
        <div className="flex items-center gap-2 bg-background border rounded-lg px-3 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring transition-all">
          {isLoading ? (
            <Loader2 className="size-4 text-muted-foreground animate-spin shrink-0" />
          ) : (
            <Globe className="size-4 text-muted-foreground shrink-0" />
          )}
          <Input
            type="text"
            value={displayUrl}
            onChange={(e) => setDisplayUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleNavigate()
              }
            }}
            className="border-0 shadow-none p-0 h-auto text-sm focus-visible:ring-0"
            placeholder="Enter website URL..."
          />
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="px-4 py-3 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive flex items-center gap-2 shrink-0">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Webview/iframe */}
      <div className="flex-1 bg-white relative">
        {browserMode ? (
          <iframe
            ref={webviewRef as React.RefObject<HTMLIFrameElement>}
            src={browserUrl}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title="Browser panel"
          />
        ) : (
          <webview
            ref={webviewRef as React.RefObject<Electron.WebviewTag>}
            src={browserUrl}
            className="w-full h-full"
            style={{ display: 'flex' }}
            partition="persist:browser-panel"
            // @ts-expect-error - Valid webview attributes
            allowpopups={false}
            disablewebsecurity={false}
          />
        )}
      </div>
    </div>
  )
}
