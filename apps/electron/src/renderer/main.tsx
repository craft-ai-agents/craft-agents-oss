import React from 'react'
import ReactDOM from 'react-dom/client'
import { init as sentryInit } from '@sentry/electron/renderer'
import * as Sentry from '@sentry/react'
import { captureConsoleIntegration } from '@sentry/react'
import { Provider as JotaiProvider } from 'jotai'
import App from './App'
import { ThemeProvider } from './context/ThemeContext'
import { Toaster } from '@/components/ui/sonner'
import './index.css'

// Known-harmless console messages that should NOT be sent to Sentry.
// These are dev-mode noise or expected warnings that aren't actionable.
const IGNORED_CONSOLE_PATTERNS = [
  // React StrictMode dev warnings about non-boolean DOM attributes
  'Received `true` for a non-boolean attribute',
  'Received `false` for a non-boolean attribute',
  // Duplicate Shiki theme registration (expected on HMR reload)
  'theme name already registered',
]

// Initialize Sentry in the renderer process using the dual-init pattern.
// Combines Electron IPC transport (sentryInit) with React error boundary support (sentryReactInit).
// DSN and config are inherited from the main process init.
//
// captureConsoleIntegration promotes console.warn/error calls into Sentry events,
// giving Sentry the same rich context visible in DevTools without needing sourcemaps.
//
// NOTE: Source map upload is intentionally disabled — see main/index.ts for details.
sentryInit(
  {
    integrations: [captureConsoleIntegration({ levels: ['warn', 'error'] })],

    beforeSend(event) {
      // Drop events matching known-harmless console patterns to avoid Sentry quota waste
      const message = event.message || event.exception?.values?.[0]?.value || ''
      if (IGNORED_CONSOLE_PATTERNS.some((pattern) => message.includes(pattern))) {
        return null
      }

      // Scrub sensitive data from breadcrumbs (mirrors main process scrubbing in main/index.ts)
      if (event.breadcrumbs) {
        for (const breadcrumb of event.breadcrumbs) {
          if (breadcrumb.data) {
            for (const key of Object.keys(breadcrumb.data)) {
              const lowerKey = key.toLowerCase()
              if (
                lowerKey.includes('token') ||
                lowerKey.includes('key') ||
                lowerKey.includes('secret') ||
                lowerKey.includes('password') ||
                lowerKey.includes('credential') ||
                lowerKey.includes('auth')
              ) {
                breadcrumb.data[key] = '[REDACTED]'
              }
            }
          }
        }
      }

      return event
    },
  },
  Sentry.init,
)

/**
 * Minimal fallback UI shown when the entire React tree crashes.
 * Sentry.ErrorBoundary captures the error and sends it to Sentry automatically.
 */
function CrashFallback() {
  return (
    <div className="flex flex-col items-center justify-center h-screen font-sans text-foreground/50 gap-3">
      <p className="text-base font-medium">Something went wrong</p>
      <p className="text-[13px]">Please restart the app. The error has been reported.</p>
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
 * Root component - always renders App
 * App.tsx handles window mode detection internally (main vs tab-content)
 */
function Root() {
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<CrashFallback />}>
      <JotaiProvider>
        <ThemeProvider>
          <Root />
          <Toaster />
        </ThemeProvider>
      </JotaiProvider>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
)
