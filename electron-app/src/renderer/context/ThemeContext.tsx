import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeContextType {
  mode: ThemeMode
  resolvedMode: 'light' | 'dark'
  colorTheme: string
  setMode: (mode: ThemeMode) => void
  setColorTheme: (theme: string) => void
}

const STORAGE_KEY = 'craft-agent-theme'

interface StoredTheme {
  mode: ThemeMode
  colorTheme: string
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
  defaultMode?: ThemeMode
  defaultColorTheme?: string
}

function getSystemPreference(): 'light' | 'dark' {
  // Check Electron's native theme API first (if available)
  if (window.electronAPI?.getSystemTheme) {
    // This is async, so we fall back to media query for initial render
  }

  // Fall back to media query
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

function loadStoredTheme(): StoredTheme | null {
  if (typeof window === 'undefined') return null

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored) as StoredTheme
    }
  } catch (e) {
    console.warn('[ThemeContext] Failed to load stored theme:', e)
  }
  return null
}

function saveTheme(theme: StoredTheme): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme))
  } catch (e) {
    console.warn('[ThemeContext] Failed to save theme:', e)
  }
}

function applyThemeToDOM(resolvedMode: 'light' | 'dark', colorTheme: string): void {
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
}

export function ThemeProvider({
  children,
  defaultMode = 'system',
  defaultColorTheme = 'default'
}: ThemeProviderProps) {
  const stored = loadStoredTheme()

  const [mode, setModeState] = useState<ThemeMode>(stored?.mode ?? defaultMode)
  const [colorTheme, setColorThemeState] = useState<string>(stored?.colorTheme ?? defaultColorTheme)
  const [systemPreference, setSystemPreference] = useState<'light' | 'dark'>(getSystemPreference)

  // Resolve the actual mode to apply
  const resolvedMode = mode === 'system' ? systemPreference : mode

  // Apply theme to DOM whenever resolved mode or color theme changes
  useEffect(() => {
    applyThemeToDOM(resolvedMode, colorTheme)
  }, [resolvedMode, colorTheme])

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
    saveTheme({ mode: newMode, colorTheme })
  }, [colorTheme])

  const setColorTheme = useCallback((newTheme: string) => {
    setColorThemeState(newTheme)
    saveTheme({ mode, colorTheme: newTheme })
  }, [mode])

  return (
    <ThemeContext.Provider
      value={{
        mode,
        resolvedMode,
        colorTheme,
        setMode,
        setColorTheme
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
