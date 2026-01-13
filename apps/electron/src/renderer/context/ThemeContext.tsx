import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import * as storage from '@/lib/local-storage'

export type ThemeMode = 'light' | 'dark' | 'system'
export type FontFamily = 'inter' | 'system'

interface ThemeContextType {
  mode: ThemeMode
  resolvedMode: 'light' | 'dark'
  colorTheme: string
  font: FontFamily
  setMode: (mode: ThemeMode) => void
  setColorTheme: (theme: string) => void
  setFont: (font: FontFamily) => void
}

interface StoredTheme {
  mode: ThemeMode
  colorTheme: string
  font?: FontFamily
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
  defaultMode?: ThemeMode
  defaultColorTheme?: string
  defaultFont?: FontFamily
}

function getSystemPreference(): 'light' | 'dark' {
  // Note: window.electronAPI?.getSystemTheme is async, so we use media query for initial render
  // The async value is fetched in useEffect and will update the state if different

  // Use media query for synchronous initial render
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

function loadStoredTheme(): StoredTheme | null {
  if (typeof window === 'undefined') return null
  return storage.get<StoredTheme | null>(storage.KEYS.theme, null)
}

function saveTheme(theme: StoredTheme): void {
  storage.set(storage.KEYS.theme, theme)
}

function applyThemeToDOM(resolvedMode: 'light' | 'dark', colorTheme: string, mode: ThemeMode, font: FontFamily, systemPreference: 'light' | 'dark'): void {
  const root = document.documentElement

  // Apply mode
  root.classList.remove('light', 'dark')
  root.classList.add(resolvedMode)

  // Apply color theme
  if (colorTheme && colorTheme !== 'default') {
    root.dataset.theme = colorTheme
  } else {
    delete root.dataset.theme
  }

  // Mark as theme override when resolved mode differs from system
  // This adds a solid background to prevent color bleed through vibrancy
  if (resolvedMode !== systemPreference) {
    root.dataset.themeOverride = 'true'
  } else {
    delete root.dataset.themeOverride
  }

  // Apply font (default CSS is system, data-font="inter" opts into Inter)
  if (font === 'inter') {
    root.dataset.font = 'inter'
  } else {
    delete root.dataset.font
  }
}

export function ThemeProvider({
  children,
  defaultMode = 'system',
  defaultColorTheme = 'default',
  defaultFont = 'inter'
}: ThemeProviderProps) {
  const stored = loadStoredTheme()

  const [mode, setModeState] = useState<ThemeMode>(stored?.mode ?? defaultMode)
  const [colorTheme, setColorThemeState] = useState<string>(stored?.colorTheme ?? defaultColorTheme)
  const [font, setFontState] = useState<FontFamily>(stored?.font ?? defaultFont)
  const [systemPreference, setSystemPreference] = useState<'light' | 'dark'>(getSystemPreference)

  // Track if we're receiving an external update to prevent echo broadcasts
  const isExternalUpdate = useRef(false)

  // Resolve the actual mode to apply
  const resolvedMode = mode === 'system' ? systemPreference : mode

  // Apply theme to DOM whenever resolved mode, color theme, or font changes
  useEffect(() => {
    applyThemeToDOM(resolvedMode, colorTheme, mode, font, systemPreference)
  }, [resolvedMode, colorTheme, mode, font, systemPreference])

  // Listen for system preference changes
  useEffect(() => {
    // Listen via media query (works in all contexts)
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleMediaChange = (e: MediaQueryListEvent) => {
      setSystemPreference(e.matches ? 'dark' : 'light')
    }

    mediaQuery.addEventListener('change', handleMediaChange)

    // Listen via Electron IPC if available (more reliable on macOS)
    let cleanup: (() => void) | undefined
    if (window.electronAPI?.onSystemThemeChange) {
      cleanup = window.electronAPI.onSystemThemeChange((isDark) => {
        setSystemPreference(isDark ? 'dark' : 'light')
      })
    }

    // Also fetch the initial system theme from Electron
    if (window.electronAPI?.getSystemTheme) {
      window.electronAPI.getSystemTheme().then((isDark) => {
        setSystemPreference(isDark ? 'dark' : 'light')
      })
    }

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange)
      cleanup?.()
    }
  }, [])

  // Listen for theme preference changes from other windows
  useEffect(() => {
    if (!window.electronAPI?.onThemePreferencesChange) return

    const cleanup = window.electronAPI.onThemePreferencesChange((preferences) => {
      // Mark as external update to prevent re-broadcasting
      isExternalUpdate.current = true
      setModeState(preferences.mode as ThemeMode)
      setColorThemeState(preferences.colorTheme)
      setFontState(preferences.font as FontFamily)
      // Also save to localStorage so it persists
      saveTheme({
        mode: preferences.mode as ThemeMode,
        colorTheme: preferences.colorTheme,
        font: preferences.font as FontFamily
      })
      // Reset flag after state updates are scheduled
      setTimeout(() => {
        isExternalUpdate.current = false
      }, 0)
    })

    return cleanup
  }, [])

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode)
    saveTheme({ mode: newMode, colorTheme, font })
    // Broadcast to other windows (unless this is from an external update)
    if (!isExternalUpdate.current && window.electronAPI?.broadcastThemePreferences) {
      window.electronAPI.broadcastThemePreferences({ mode: newMode, colorTheme, font })
    }
  }, [colorTheme, font])

  const setColorTheme = useCallback((newTheme: string) => {
    setColorThemeState(newTheme)
    saveTheme({ mode, colorTheme: newTheme, font })
    // Broadcast to other windows (unless this is from an external update)
    if (!isExternalUpdate.current && window.electronAPI?.broadcastThemePreferences) {
      window.electronAPI.broadcastThemePreferences({ mode, colorTheme: newTheme, font })
    }
  }, [mode, font])

  const setFont = useCallback((newFont: FontFamily) => {
    setFontState(newFont)
    saveTheme({ mode, colorTheme, font: newFont })
    // Broadcast to other windows (unless this is from an external update)
    if (!isExternalUpdate.current && window.electronAPI?.broadcastThemePreferences) {
      window.electronAPI.broadcastThemePreferences({ mode, colorTheme, font: newFont })
    }
  }, [mode, colorTheme])

  return (
    <ThemeContext.Provider
      value={{
        mode,
        resolvedMode,
        colorTheme,
        font,
        setMode,
        setColorTheme,
        setFont
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
