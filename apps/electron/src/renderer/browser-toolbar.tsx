/**
 * Browser Toolbar — React entry point
 *
 * Renders the shared BrowserControls component inside a chromeless
 * BrowserWindow. Communicates with the main process via a dedicated
 * preload script (browser-toolbar preload).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { useTranslation, initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { setupI18n } from '@craft-agent/shared/i18n'
import { EyeOff, X, XCircle } from 'lucide-react'
import { BrowserControls } from '@craft-agent/ui'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import './index.css'

// This is a standalone entry (browser-toolbar.html) — i18n must be initialized
// here or BrowserControls and the menu below render raw translation keys.
setupI18n([LanguageDetector, initReactI18next])

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ToolbarState {
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  themeColor?: string | null
}

declare global {
  interface Window {
    browserToolbar: {
      instanceId: string
      navigate: (url: string) => Promise<void>
      goBack: () => Promise<void>
      goForward: () => Promise<void>
      reload: () => Promise<void>
      stop: () => Promise<void>
      setMenuGeometry: (open: boolean, height?: number) => Promise<void>
      hideWindow: () => Promise<void>
      closeWindowEntirely: () => Promise<void>
      onStateUpdate: (callback: (state: ToolbarState) => void) => () => void
      onThemeColor: (callback: (color: string | null) => void) => () => void
      onForceCloseMenu: (callback: (payload: { reason?: string }) => void) => () => void
    }
  }
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

function BrowserToolbarApp() {
  const { t } = useTranslation()
  const [state, setState] = useState<ToolbarState>({
    url: 'about:blank',
    title: 'New Tab',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  })
  const [themeColor, setThemeColor] = useState<string | null>(null)
  const [windowMenuOpen, setWindowMenuOpen] = useState(false)
  const menuContentRef = useRef<HTMLDivElement | null>(null)

  const api = window.browserToolbar

  useEffect(() => {
    if (!api) return
    return api.onStateUpdate((s) => {
      setState(s)
      // Sync theme color from full state push (initial load / reconnection)
      if ('themeColor' in s) {
        setThemeColor((s as ToolbarState).themeColor ?? null)
      }
    })
  }, [api])

  useEffect(() => {
    if (!api) return
    return api.onThemeColor(setThemeColor)
  }, [api])

  useEffect(() => {
    if (!api) return
    return api.onForceCloseMenu(() => {
      setWindowMenuOpen(false)
    })
  }, [api])

  useEffect(() => {
    if (!api) return

    if (!windowMenuOpen) {
      void api.setMenuGeometry(false, 0)
      return
    }

    // Prime expansion immediately to avoid a constrained first measurement.
    void api.setMenuGeometry(true, 120)

    const sendGeometry = () => {
      const height = Math.ceil(menuContentRef.current?.getBoundingClientRect().height ?? 0)
      void api.setMenuGeometry(true, height)
    }

    let frame = requestAnimationFrame(sendGeometry)
    const observer = new ResizeObserver(() => {
      sendGeometry()
    })

    if (menuContentRef.current) {
      observer.observe(menuContentRef.current)
    }

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      void api.setMenuGeometry(false, 0)
    }
  }, [api, windowMenuOpen])

  const handleNavigate = useCallback((url: string) => {
    void api?.navigate(url)
  }, [api])

  const handleGoBack = useCallback(() => {
    void api?.goBack()
  }, [api])

  const handleGoForward = useCallback(() => {
    void api?.goForward()
  }, [api])

  const handleReload = useCallback(() => {
    void api?.reload()
  }, [api])

  const handleStop = useCallback(() => {
    void api?.stop()
  }, [api])

  const handleHideWindow = useCallback(() => {
    setWindowMenuOpen(false)
    void api?.hideWindow()
  }, [api])

  const handleCloseWindowEntirely = useCallback(() => {
    setWindowMenuOpen(false)
    void api?.closeWindowEntirely()
  }, [api])

  return (
    <>
      {/*
        Full-window outside-tap catcher while menu is open.
        Critical for draggable titlebar windows (Windows) where outside-click
        dismissal can be unreliable if events fall into app-region: drag zones.
      */}
      {windowMenuOpen && (
        <div
          className="fixed inset-0 z-[90] titlebar-no-drag bg-black/[0.0039215686]"
          onPointerDown={(event) => {
            event.preventDefault()
            setWindowMenuOpen(false)
          }}
        />
      )}

      <BrowserControls
        url={state.url}
        loading={state.isLoading}
        canGoBack={state.canGoBack}
        canGoForward={state.canGoForward}
        onNavigate={handleNavigate}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReload={handleReload}
        onStop={handleStop}
        trailingContent={(
          <div className="ml-2 flex items-center gap-1.5 titlebar-no-drag">
            <DropdownMenu open={windowMenuOpen} onOpenChange={setWindowMenuOpen}>
              <DropdownMenuTrigger asChild>
                <HeaderIconButton
                  icon={<X className="h-3.5 w-3.5" />}
                  aria-label={t('browser.windowOptions')}
                  className={themeColor ? '' : 'bg-background shadow-minimal hover:bg-foreground/5'}
                  style={themeColor ? { color: 'var(--tb-fg)' } : undefined}
                />
              </DropdownMenuTrigger>

              <StyledDropdownMenuContent
                ref={menuContentRef}
                align="end"
                side="bottom"
                sideOffset={6}
                minWidth="min-w-44"
                className="titlebar-no-drag z-[110] max-h-none overflow-visible"
              >
                <StyledDropdownMenuItem onSelect={handleHideWindow}>
                  <EyeOff className="h-3.5 w-3.5" />
                  {t('browser.hideWindow')}
                </StyledDropdownMenuItem>
                <StyledDropdownMenuItem variant="destructive" onSelect={handleCloseWindowEntirely}>
                  <XCircle className="h-3.5 w-3.5" />
                  {t('browser.closeWindowEntirely')}
                </StyledDropdownMenuItem>
              </StyledDropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        themeColor={themeColor}
        urlBarClassName="max-w-[600px]"
        className="titlebar-drag-region bg-background"
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Mount                                                              */
/* ------------------------------------------------------------------ */

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserToolbarApp />
  </React.StrictMode>,
)
