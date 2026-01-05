import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
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

function applyThemeToDOM(resolvedMode: 'light' | 'dark', colorTheme: string, mode: ThemeMode, font: FontFamily): void {
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

  // Mark as theme override when user explicitly sets light/dark (not system)
  // This increases sidebar opacity to reduce color bleed
  if (mode !== 'system') {
    root.dataset.themeOverride = 'true'
  } else {
    delete root.dataset.themeOverride
  }

  // Apply font
  if (font === 'system') {
    root.dataset.font = 'system'
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

  // Resolve the actual mode to apply
  const resolvedMode = mode === 'system' ? systemPreference : mode

  // Apply theme to DOM whenever resolved mode, color theme, mode, or font changes
  useEffect(() => {
    applyThemeToDOM(resolvedMode, colorTheme, mode, font)
  }, [resolvedMode, colorTheme, mode, font])

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

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode)
    saveTheme({ mode: newMode, colorTheme, font })
  }, [colorTheme, font])

  const setColorTheme = useCallback((newTheme: string) => {
    setColorThemeState(newTheme)
    saveTheme({ mode, colorTheme: newTheme, font })
  }, [mode, font])

  const setFont = useCallback((newFont: FontFamily) => {
    setFontState(newFont)
    saveTheme({ mode, colorTheme, font: newFont })
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
