/**
 * Craft Agent Session Viewer
 *
 * A minimal web app for viewing Craft Agent session transcripts.
 * Users can upload session JSON files or view shared sessions via URL.
 *
 * Routes:
 * - / - Upload interface
 * - /s/{id} - View shared session
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import type { StoredSession } from '@craft-agent/core'
import {
  ChatView,
  GenericOverlay,
  CodePreviewOverlay,
  DiffPreviewOverlay,
  TerminalPreviewOverlay,
  extractOverlayData,
  type PlatformActions,
  type ActivityItem,
  type OverlayData,
} from '@craft-agent/ui'
import { SessionUpload } from './components/SessionUpload'
import { Header } from './components/Header'

/** Extract session ID from URL path /s/{id} */
function getSessionIdFromUrl(): string | null {
  const path = window.location.pathname
  const match = path.match(/^\/s\/([a-zA-Z0-9_-]+)$/)
  return match ? match[1] : null
}

export function App() {
  const [session, setSession] = useState<StoredSession | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(() => getSessionIdFromUrl())
  const [isDark, setIsDark] = useState(() => {
    // Check system preference on mount
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  // Fetch session from API when we have a session ID
  useEffect(() => {
    if (!sessionId) return

    const fetchSession = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`/s/api/${sessionId}`)
        if (!response.ok) {
          if (response.status === 404) {
            setError('Session not found')
          } else {
            setError('Failed to load session')
          }
          return
        }

        const data = await response.json()
        setSession(data)
      } catch (err) {
        console.error('Failed to fetch session:', err)
        setError('Failed to load session')
      } finally {
        setIsLoading(false)
      }
    }

    fetchSession()
  }, [sessionId])

  // Handle browser navigation
  useEffect(() => {
    const handlePopState = () => {
      const newId = getSessionIdFromUrl()
      setSessionId(newId)
      if (!newId) {
        setSession(null)
        setError(null)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Apply dark mode class to html element
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  const handleSessionLoad = useCallback((loadedSession: StoredSession) => {
    setSession(loadedSession)
  }, [])

  const handleClear = useCallback(() => {
    setSession(null)
    setSessionId(null)
    setError(null)
    // Update URL to root
    window.history.pushState({}, '', '/')
  }, [])

  const toggleTheme = useCallback(() => {
    setIsDark(prev => !prev)
  }, [])

  // State for overlay
  const [overlayActivity, setOverlayActivity] = useState<ActivityItem | null>(null)

  // Handle activity click - show in overlay
  const handleActivityClick = useCallback((activity: ActivityItem) => {
    setOverlayActivity(activity)
  }, [])

  const handleCloseOverlay = useCallback(() => {
    setOverlayActivity(null)
  }, [])

  // Extract overlay data using shared parser
  const overlayData: OverlayData | null = useMemo(() => {
    if (!overlayActivity) return null
    return extractOverlayData(overlayActivity)
  }, [overlayActivity])

  // Platform actions for the viewer (limited functionality)
  const platformActions: PlatformActions = {
    onOpenUrl: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    onCopyToClipboard: async (text) => {
      await navigator.clipboard.writeText(text)
    },
  }

  const theme = isDark ? 'dark' : 'light'

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      <Header
        hasSession={!!session}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onClear={handleClear}
      />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center text-muted-foreground">
            <div className="animate-pulse">Loading session...</div>
          </div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="text-destructive mb-4">{error}</div>
            <button
              onClick={handleClear}
              className="px-4 py-2 rounded-md bg-accent text-accent-foreground hover:opacity-90 transition-opacity"
            >
              Go back
            </button>
          </div>
        </div>
      ) : session ? (
        <ChatView
          session={session}
          mode="readonly"
          platformActions={platformActions}
          defaultExpanded={true}
          className="flex-1 min-h-0"
          onActivityClick={handleActivityClick}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center p-8">
          <SessionUpload onSessionLoad={handleSessionLoad} />
        </div>
      )}

      {/* Code preview overlay for Read/Write tools */}
      {overlayData?.type === 'code' && (
        <CodePreviewOverlay
          isOpen={!!overlayActivity}
          onClose={handleCloseOverlay}
          content={overlayData.content}
          filePath={overlayData.filePath}
          mode={overlayData.mode}
          startLine={overlayData.startLine}
          totalLines={overlayData.totalLines}
          numLines={overlayData.numLines}
          theme={theme}
          error={overlayData.error}
        />
      )}

      {/* Diff preview overlay for Edit tool */}
      {overlayData?.type === 'diff' && (
        <DiffPreviewOverlay
          isOpen={!!overlayActivity}
          onClose={handleCloseOverlay}
          original={overlayData.original}
          modified={overlayData.modified}
          filePath={overlayData.filePath}
          theme={theme}
          error={overlayData.error}
        />
      )}

      {/* Terminal preview overlay for Bash/Grep/Glob tools */}
      {overlayData?.type === 'terminal' && (
        <TerminalPreviewOverlay
          isOpen={!!overlayActivity}
          onClose={handleCloseOverlay}
          command={overlayData.command}
          output={overlayData.output}
          exitCode={overlayData.exitCode}
          toolType={overlayData.toolType}
          description={overlayData.description}
          theme={theme}
        />
      )}

      {/* Generic overlay for unknown tools */}
      {overlayData?.type === 'generic' && (
        <GenericOverlay
          isOpen={!!overlayActivity}
          onClose={handleCloseOverlay}
          content={overlayData.content}
          title={overlayData.title}
        />
      )}
    </div>
  )
}
