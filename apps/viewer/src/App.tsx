/**
 * G4 OS Session Viewer
 *
 * A minimal web app for viewing G4 OS session transcripts.
 * Users can upload session JSON files or view shared sessions via URL.
 *
 * Routes:
 * - / - Upload interface
 * - /s/{id} - View shared session
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import type { StoredSession } from '@g4os/core'
import {
  SessionViewer,
  GenericOverlay,
  CodePreviewOverlay,
  MultiDiffPreviewOverlay,
  TerminalPreviewOverlay,
  JSONPreviewOverlay,
  DocumentFormattedMarkdownOverlay,
  TooltipProvider,
  extractOverlayData,
  detectLanguage,
  type PlatformActions,
  type ActivityItem,
  type OverlayData,
  type FileChange,
} from '@g4os/ui'
import { Header } from './components/Header'

/** Default session ID for development */
const DEV_SESSION_ID = 'tz5-13I84pwK_he'

/** Extract session ID from URL path /s/{id} */
function getSessionIdFromUrl(): string | null {
  const path = window.location.pathname
  const match = path.match(/^\/s\/([a-zA-Z0-9_-]+)$/)
  if (match) return match[1]

  // In development, redirect root to default session
  if (import.meta.env.DEV && path === '/') {
    window.history.replaceState({}, '', `/s/${DEV_SESSION_ID}`)
    return DEV_SESSION_ID
  }

  return null
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
  // State for multi-diff overlay (Edit/Write activities shown as diffs)
  const [multiDiffState, setMultiDiffState] = useState<{ changes: FileChange[] } | null>(null)

  // Handle activity click - Edit/Write opens multi-diff, others use extractOverlayData
  const handleActivityClick = useCallback((activity: ActivityItem) => {
    if (activity.toolName === 'Edit' || activity.toolName === 'Write') {
      const input = activity.toolInput as Record<string, unknown> | undefined
      const filePath = (input?.file_path as string) || (input?.path as string) || 'unknown'
      const change: FileChange = {
        id: activity.id,
        filePath,
        toolType: activity.toolName,
        original: activity.toolName === 'Edit' ? ((input?.old_string as string) || '') : '',
        modified: activity.toolName === 'Edit'
          ? ((input?.new_string as string) || '')
          : ((input?.content as string) || ''),
        error: activity.error || undefined,
      }
      setMultiDiffState({ changes: [change] })
    } else {
      setOverlayActivity(activity)
    }
  }, [])

  const handleCloseOverlay = useCallback(() => {
    setOverlayActivity(null)
    setMultiDiffState(null)
  }, [])

  // Extract overlay data using shared parser (non-Edit/Write tools only)
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
    <TooltipProvider>
    <div className="h-full flex flex-col bg-foreground-2 text-foreground">
      <Header
        hasSession={!!session}
        sessionTitle={session?.name}
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
              className="px-4 py-2 rounded-md bg-background text-foreground shadow-sm border border-border hover:bg-foreground/5 transition-colors"
            >
              Go back
            </button>
          </div>
        </div>
      ) : session ? (
        <SessionViewer
          session={session}
          mode="readonly"
          platformActions={platformActions}
          defaultExpanded={false}
          className="flex-1 min-h-0"
          onActivityClick={handleActivityClick}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="text-4xl mb-4 opacity-20 select-none">
              <svg className="w-16 h-16 mx-auto rounded-2xl" viewBox="0 0 524 524" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="524" height="524" rx="115" fill="url(#g4os-home-bg)" />
                <path d="M236.424 392L246.694 373.213C246.888 372.889 247.05 372.501 247.083 372.08C247.18 370.817 246.273 369.683 245.042 369.488C224.112 366.347 204.641 357.18 188.766 343.026C188.312 342.605 187.729 342.41 187.146 342.41C186.53 342.41 185.915 342.637 185.429 343.123L151.605 376.906L146.065 371.367L179.856 337.584C180.764 336.677 180.796 335.22 179.954 334.248C165.763 318.377 156.562 298.91 153.42 277.954C153.29 277.176 152.804 276.497 152.091 276.14C151.767 275.978 151.378 275.881 151.022 275.881C150.633 275.881 150.212 275.978 149.856 276.172L131 286.538V236.365L149.888 246.633C150.245 246.827 150.666 246.924 151.054 246.924C151.411 246.924 151.8 246.827 152.124 246.665C152.836 246.309 153.322 245.629 153.452 244.851C160.58 198.112 198.259 160.54 245.042 153.479C246.305 153.284 247.213 152.151 247.115 150.888C247.083 150.434 246.921 150.013 246.694 149.689L236.456 131H286.641L276.435 149.721C276.209 150.045 276.047 150.467 276.014 150.888C275.917 152.151 276.792 153.284 278.055 153.479C293.736 155.876 308.899 161.738 322.149 170.548L306.858 185.836C298.304 187.65 288.617 191.375 278.768 196.655C262.925 205.141 246.759 217.385 232.082 232.057C226.38 237.726 221.035 243.653 216.142 249.71C214.523 247.377 213.032 245.013 211.607 242.713C216.239 237.11 221.229 231.636 226.445 226.453C234.415 218.485 242.871 211.165 251.553 204.688C252.202 204.202 252.558 203.424 252.526 202.615C252.493 201.805 252.04 201.06 251.359 200.639C249.027 199.213 246.661 197.886 244.329 196.655C238.983 193.805 220.386 184.476 204.77 184.476C198.162 184.476 193.075 186.225 189.641 189.626C182.934 196.331 182.772 210.291 189.22 227.943C196.121 246.763 209.727 267.492 227.579 286.343C228.033 286.829 228.648 287.088 229.296 287.088H229.329C229.977 287.088 230.592 286.829 231.045 286.375L243.875 273.549C244.62 272.804 244.815 271.638 244.297 270.699C242.806 267.881 241.996 264.706 241.996 261.532C241.996 250.779 250.744 242.033 261.5 242.033C264.707 242.033 267.883 242.811 270.669 244.333C271.025 244.527 271.414 244.625 271.803 244.625C272.418 244.625 273.066 244.365 273.519 243.912L286.382 231.085C286.835 230.632 287.094 229.984 287.094 229.336C287.094 228.689 286.803 228.041 286.349 227.62C282.137 223.636 277.796 219.846 273.423 216.283C275.787 214.729 278.185 213.239 280.583 211.846C284.47 215.085 288.326 218.518 292.084 222.049C292.538 222.502 293.153 222.729 293.769 222.729C294.384 222.729 295 222.502 295.485 222.016L350.401 167.147C350.854 166.694 351.113 166.079 351.113 165.431C351.113 164.783 350.854 164.167 350.401 163.714L337.96 151.276L387.172 141.494L343.208 185.448C342.301 186.355 342.269 187.812 343.111 188.784C357.236 204.623 366.406 223.992 369.58 244.851C369.71 245.629 370.196 246.341 370.909 246.698C371.265 246.892 371.654 246.957 372.043 246.957C372.431 246.957 372.787 246.859 373.144 246.665L392 236.301V286.44L373.144 276.011C372.787 275.816 372.366 275.719 371.978 275.719C371.298 275.719 370.617 276.011 370.163 276.529C369.84 276.918 369.645 277.371 369.58 277.857C369.483 278.732 359.116 355.82 277.828 369.423C276.565 369.618 275.691 370.752 275.82 372.015C275.885 372.727 276.241 373.343 276.759 373.732L286.641 391.903H236.424V392Z" fill="#B9915B"/>
                <defs>
                  <linearGradient id="g4os-home-bg" x1="0" y1="-142.5" x2="618" y2="931" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#D9D9D9" />
                    <stop offset="1" stopColor="white" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">G4 OS Session Viewer</h2>
            <p className="text-sm text-foreground/50 leading-relaxed">
              To view a shared conversation, use the <strong>Share</strong> option in the G4 OS app. A link will be generated and copied to your clipboard.
            </p>
          </div>
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
          command={overlayData.command}
        />
      )}

      {/* Multi-diff preview overlay for Edit/Write tools */}
      {multiDiffState && (
        <MultiDiffPreviewOverlay
          isOpen={true}
          onClose={handleCloseOverlay}
          changes={multiDiffState.changes}
          consolidated={false}
          theme={theme}
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

      {/* JSON preview overlay for tools returning JSON data */}
      {overlayData?.type === 'json' && (
        <JSONPreviewOverlay
          isOpen={!!overlayActivity}
          onClose={handleCloseOverlay}
          data={overlayData.data}
          title={overlayData.title}
          theme={theme}
          error={overlayData.error}
        />
      )}

      {/* Document overlay for formatted markdown content (Write tool on .md/.txt, WebSearch results) */}
      {overlayData?.type === 'document' && (
        <DocumentFormattedMarkdownOverlay
          isOpen={!!overlayActivity}
          onClose={handleCloseOverlay}
          content={overlayData.content}
          filePath={overlayData.filePath}
          typeBadge={{ label: overlayData.toolName, variant: 'default' }}
          onOpenUrl={platformActions.onOpenUrl}
          error={overlayData.error}
        />
      )}

      {/* Generic overlay for unknown tools - route markdown to fullscreen viewer */}
      {overlayData?.type === 'generic' && (
        detectLanguage(overlayData.content) === 'markdown' ? (
          <DocumentFormattedMarkdownOverlay
            isOpen={!!overlayActivity}
            onClose={handleCloseOverlay}
            content={overlayData.content}
            onOpenUrl={platformActions.onOpenUrl}
            error={overlayData.error}
          />
        ) : (
          <GenericOverlay
            isOpen={!!overlayActivity}
            onClose={handleCloseOverlay}
            content={overlayData.content}
            title={overlayData.title}
            theme={theme}
          />
        )
      )}
    </div>
    </TooltipProvider>
  )
}
