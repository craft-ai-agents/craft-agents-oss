/**
 * Web app entry point.
 * Sets up the web API (window.electronAPI) via HTTP/WebSocket,
 * then renders the same React app as the Electron renderer.
 */

// IMPORTANT: Import web API first to set up window.electronAPI before React renders
import './api.js'

import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { Provider as JotaiProvider, useAtomValue } from 'jotai'
// Import the original App and related files from the electron renderer via @ alias
import App from '@/App'
import { ThemeProvider } from '@/context/ThemeContext'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { Toaster } from '@/components/ui/sonner'
import '@/index.css'

/**
 * Minimal fallback UI shown when the entire React tree crashes.
 */
function CrashFallback() {
  return (
    <div className="flex flex-col items-center justify-center h-screen font-sans text-foreground/50 gap-3">
      <p className="text-base font-medium">Something went wrong</p>
      <p className="text-[13px]">Please reload the page. The error has been reported.</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 px-4 py-1.5 rounded-md bg-background shadow-minimal text-[13px] text-foreground/70 cursor-pointer"
      >
        Reload
      </button>
    </div>
  )
}

/**
 * Root component - loads workspace ID for theme context and renders App
 */
function Root() {
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)

  return (
    <ThemeProvider activeWorkspaceId={workspaceId}>
      <App />
      <Toaster />
    </ThemeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<CrashFallback />}>
      <JotaiProvider>
        <Root />
      </JotaiProvider>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
)
