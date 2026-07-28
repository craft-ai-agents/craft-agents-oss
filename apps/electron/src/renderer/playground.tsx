// IMPORTANT: keep `mock-utils` as the FIRST local import. It installs the
// mock `window.electronAPI` as a top-level side effect on import, so that
// any renderer module that reads `window.electronAPI.*` at module-load time
// (e.g. `SessionFilesSection.tsx`'s top-level `getRuntimeEnvironment()`
// call) finds the mock in place before its own module is evaluated.
import './playground/mock-utils'

import React, { useCallback, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider } from 'jotai'
import { setupI18n } from '@craft-agent/shared/i18n'
import { initReactI18next } from 'react-i18next'
import { ThemeProvider } from './context/ThemeContext'
import { Toaster } from './components/ui/sonner'
import { PlaygroundAppShellProvider } from './playground/PlaygroundAppShellProvider'
import { LayoutShell } from './shell'
import { SplashScreen } from './components/SplashScreen'
import './index.css'

// Initialize i18n before any React rendering. `useTranslation()` reads from
// the shared global instance, so we don't need an <I18nextProvider>.
setupI18n([initReactI18next])

/**
 * Dev-only wrapper that mounts an on-demand SplashScreen over the playground.
 *
 * Why: SplashScreen normally only appears at app startup, so verifying the
 * animated symbol requires restarting the whole Electron app. This tester
 * mounts the real SplashScreen on a button click and exposes an explicit
 * "Dismiss" affordance so the entry/exit animation can be checked without
 * restarting the app.
 *
 * Disabled in production via `import.meta.env.DEV` (Vite tree-shakes both
 * the trigger button and the wrapper itself, so nothing ships to prod).
 */
function PlaygroundSplashTester({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const [exiting, setExiting] = useState(false)

  const handleOpen = useCallback(() => {
    if (!mounted && !exiting) {
      setMounted(true)
      setExiting(false)
    }
  }, [mounted, exiting])

  const handleExit = useCallback(() => {
    if (mounted && !exiting) {
      setExiting(true)
    }
  }, [mounted, exiting])

  const handleExitComplete = useCallback(() => {
    setMounted(false)
    setExiting(false)
  }, [])

  // Honour Escape to dismiss — keyboard parity with the Dismiss button.
  useEffect(() => {
    if (!mounted || exiting) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleExit()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mounted, exiting, handleExit])

  return (
    <>
      {children}

      {/* Dev-only floating trigger button. Sits above z-splash (--z-splash: 600). */}
      {import.meta.env.DEV && (
        <button
          type="button"
          onClick={handleOpen}
          disabled={mounted}
          aria-label="Test splash screen"
          title="Mount SplashScreen on demand (dev only)"
          className={`fixed bottom-4 right-4 z-[700] whitespace-nowrap rounded-full px-3 py-2 text-xs font-medium shadow-md backdrop-blur transition-colors ${
            mounted
              ? exiting
                ? 'bg-accent/15 text-muted-foreground cursor-wait'
                : 'bg-accent text-accent-foreground cursor-default'
              : 'bg-foreground/10 text-foreground hover:bg-foreground/20 active:bg-foreground/30'
          }`}
        >
          {exiting ? 'Splash closing…' : mounted ? 'Splash active' : 'Test splash'}
        </button>
      )}

      {/* The splash itself uses fixed inset-0 so it overlays the app regardless of mount point. */}
      {mounted && (
        <SplashScreen
          isExiting={exiting}
          onExitComplete={handleExitComplete}
        />
      )}

      {/* Visible dismiss affordance + keyboard hint, only while splash is on-screen. */}
      {mounted && !exiting && (
        <>
          <button
            type="button"
            onClick={handleExit}
            aria-label="Dismiss splash and play exit animation"
            className="fixed top-4 right-4 z-[700] whitespace-nowrap rounded-md bg-foreground/10 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur hover:bg-foreground/20 active:bg-foreground/30 transition-colors"
          >
            Dismiss splash
          </button>
          <div className="pointer-events-none fixed inset-x-0 bottom-10 z-[700] flex justify-center">
            <span className="rounded-full border border-border/40 bg-foreground/5 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
              Press Esc or click Dismiss to play the exit animation
            </span>
          </div>
        </>
      )}
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <JotaiProvider>
      <ThemeProvider>
        <PlaygroundAppShellProvider>
          <PlaygroundSplashTester>
            <LayoutShell />
            <Toaster />
          </PlaygroundSplashTester>
        </PlaygroundAppShellProvider>
      </ThemeProvider>
    </JotaiProvider>
  </React.StrictMode>,
)
