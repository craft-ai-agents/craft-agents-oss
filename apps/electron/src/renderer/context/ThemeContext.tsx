import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import * as storage from '@/lib/local-storage'
import {
  resolveTheme,
  themeToCSS,
  DEFAULT_THEME,
  DEFAULT_SHIKI_THEME,
  getShikiTheme,
  type ThemeOverrides,
  type ThemeFile,
  type ShikiThemeConfig,
} from '@config/theme'

export type ThemeMode = 'light' | 'dark' | 'system'
export type FontFamily = 'inter' | 'system'

interface ThemeContextType {
  // Preferences (persisted)
  mode: ThemeMode
  colorTheme: string
  font: FontFamily
  setMode: (mode: ThemeMode) => void
  setColorTheme: (theme: string) => void
  setFont: (font: FontFamily) => void

  // Derived/computed
  resolvedMode: 'light' | 'dark'
  systemPreference: 'light' | 'dark'
  /** Effective color theme for rendering (previewColorTheme ?? colorTheme) */
  effectiveColorTheme: string
  /** Temporary preview theme (hover state) - not persisted */
  previewColorTheme: string | null
  /** Set temporary preview theme for hover preview. Pass null to clear. */
  setPreviewColorTheme: (theme: string | null) => void

  // Theme resolution (singleton - loaded once)
  /** Loaded preset theme file, null if default or loading */
  presetTheme: ThemeFile | null
  /** Fully resolved theme (preset merged with any overrides) */
  resolvedTheme: ThemeOverrides
  /** Whether dark mode is active (scenic themes force dark) */
  isDark: boolean
  /** Whether theme is scenic mode (background image with glass panels) */
  isScenic: boolean
  /** Shiki syntax highlighting theme name for current mode */
  shikiTheme: string
  /** Shiki theme configuration (light/dark variants) */
  shikiConfig: ShikiThemeConfig
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

export function ThemeProvider({
  children,
  defaultMode = 'system',
  defaultColorTheme = 'default',
  defaultFont = 'system'
}: ThemeProviderProps) {
  const stored = loadStoredTheme()

  // === Preference state (persisted) ===
  const [mode, setModeState] = useState<ThemeMode>(stored?.mode ?? defaultMode)
  const [colorTheme, setColorThemeState] = useState<string>(stored?.colorTheme ?? defaultColorTheme)
  const [font, setFontState] = useState<FontFamily>(stored?.font ?? defaultFont)
  const [systemPreference, setSystemPreference] = useState<'light' | 'dark'>(getSystemPreference)
  const [previewColorTheme, setPreviewColorTheme] = useState<string | null>(null)

  // Track if we're receiving an external update to prevent echo broadcasts
  const isExternalUpdate = useRef(false)

  // === Preset theme state (singleton) ===
  const [presetTheme, setPresetTheme] = useState<ThemeFile | null>(null)

  // === Derived values ===
  const resolvedMode = mode === 'system' ? systemPreference : mode
  const effectiveColorTheme = previewColorTheme ?? colorTheme
  const isDarkFromMode = resolvedMode === 'dark'

  // Load preset theme when effectiveColorTheme changes (SINGLETON - only here, not in useTheme)
  useEffect(() => {
    if (!effectiveColorTheme || effectiveColorTheme === 'default') {
      setPresetTheme(null)
      return
    }

    // Load preset theme via IPC (app-level)
    window.electronAPI?.loadPresetTheme?.(effectiveColorTheme).then((preset) => {
      setPresetTheme(preset?.theme ?? null)
    }).catch(() => {
      setPresetTheme(null)
    })
  }, [effectiveColorTheme])

  // Resolve theme (preset → final)
  const resolvedTheme = useMemo(() => {
    return resolveTheme(presetTheme ?? undefined)
  }, [presetTheme])

  // Determine scenic mode (background image with glass panels)
  const isScenic = useMemo(() => {
    return resolvedTheme.mode === 'scenic' && !!resolvedTheme.backgroundImage
  }, [resolvedTheme])

  // Scenic themes force dark mode for better contrast
  const isDark = isScenic ? true : isDarkFromMode

  // Shiki theme configuration
  const shikiConfig = useMemo(() => {
    return presetTheme?.shikiTheme || DEFAULT_SHIKI_THEME
  }, [presetTheme])

  // Get current Shiki theme name based on mode
  const shikiTheme = useMemo(() => {
    const supportedModes = presetTheme?.supportedModes
    const currentMode = isDark ? 'dark' : 'light'

    // If theme has limited mode support and doesn't include current mode,
    // use the mode it does support for Shiki
    if (supportedModes && supportedModes.length > 0 && !supportedModes.includes(currentMode)) {
      const effectiveMode = supportedModes[0] === 'dark'
      return getShikiTheme(shikiConfig, effectiveMode)
    }

    return getShikiTheme(shikiConfig, isDark)
  }, [shikiConfig, isDark, presetTheme])

  // === DOM Effects (SINGLETON - all theme DOM manipulation happens here) ===

  // Apply base theme class and data attributes
  useEffect(() => {
    const root = document.documentElement

    // Apply font
    if (font === 'inter') {
      root.dataset.font = 'inter'
    } else {
      delete root.dataset.font
    }

    // Apply color theme data attribute
    if (effectiveColorTheme && effectiveColorTheme !== 'default') {
      root.dataset.theme = effectiveColorTheme
    } else {
      delete root.dataset.theme
    }

    // Always set theme override for semi-transparent background (vibrancy effect)
    root.dataset.themeOverride = 'true'
  }, [effectiveColorTheme, font])

  // Apply dark/light class and theme-specific DOM attributes
  // This runs when preset loads or mode changes
  useEffect(() => {
    const root = document.documentElement

    // Check if this is a dark-only theme (forces dark mode)
    const isDarkOnlyTheme = presetTheme?.supportedModes?.length === 1 && presetTheme.supportedModes[0] === 'dark'

    // Apply mode class
    // Scenic and dark-only themes force dark mode
    const effectiveMode = (isScenic || isDarkOnlyTheme) ? 'dark' : resolvedMode
    root.classList.remove('light', 'dark')
    root.classList.add(effectiveMode)

    // Handle themeMismatch - set solid background when:
    // 1. Theme doesn't support current mode (e.g., dark-only Dracula in light mode), OR
    // 2. Resolved mode differs from system preference (vibrancy mismatch)
    const supportedModes = presetTheme?.supportedModes
    const currentMode = isDarkFromMode ? 'dark' : 'light'
    const themeModeUnsupported = supportedModes && supportedModes.length > 0 && !supportedModes.includes(currentMode)
    const vibrancyMismatch = resolvedMode !== systemPreference

    if (themeModeUnsupported || vibrancyMismatch) {
      root.dataset.themeMismatch = 'true'
    } else {
      delete root.dataset.themeMismatch
    }

    // Set scenic mode data attribute for CSS targeting
    if (isScenic) {
      root.dataset.scenic = 'true'
      if (resolvedTheme.backgroundImage) {
        root.style.setProperty('--background-image', `url("${resolvedTheme.backgroundImage}")`)
      }
    } else {
      delete root.dataset.scenic
      root.style.removeProperty('--background-image')
    }

  }, [presetTheme, resolvedMode, systemPreference, isScenic, resolvedTheme, isDarkFromMode])

  // Inject CSS variables
  useEffect(() => {
    const styleId = 'craft-theme-overrides'
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null

    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }

    // When using default theme, clear custom CSS
    if (!effectiveColorTheme || effectiveColorTheme === 'default') {
      styleEl.textContent = ''
      return
    }

    // Only inject CSS when preset is loaded (prevents flash with empty/wrong values)
    if (!presetTheme) {
      // Keep existing CSS while loading
      return
    }

    // Generate CSS variable declarations
    const cssVars = themeToCSS(resolvedTheme, isDark)

    if (cssVars) {
      styleEl.textContent = `:root {\n  ${cssVars}\n}`
    } else {
      styleEl.textContent = ''
    }
  }, [effectiveColorTheme, presetTheme, resolvedTheme, isDark])

  // === System preference listener ===
  useEffect(() => {
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

    // Fetch initial system theme from Electron
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

  // === Cross-window sync listener ===
  useEffect(() => {
    if (!window.electronAPI?.onThemePreferencesChange) return

    const cleanup = window.electronAPI.onThemePreferencesChange((preferences) => {
      isExternalUpdate.current = true
      setModeState(preferences.mode as ThemeMode)
      setColorThemeState(preferences.colorTheme)
      setFontState(preferences.font as FontFamily)
      saveTheme({
        mode: preferences.mode as ThemeMode,
        colorTheme: preferences.colorTheme,
        font: preferences.font as FontFamily
      })
      setTimeout(() => {
        isExternalUpdate.current = false
      }, 0)
    })

    return cleanup
  }, [])

  // === Setters with persistence and broadcast ===
  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode)
    saveTheme({ mode: newMode, colorTheme, font })
    if (!isExternalUpdate.current && window.electronAPI?.broadcastThemePreferences) {
      window.electronAPI.broadcastThemePreferences({ mode: newMode, colorTheme, font })
    }
  }, [colorTheme, font])

  const setColorTheme = useCallback((newTheme: string) => {
    setColorThemeState(newTheme)
    saveTheme({ mode, colorTheme: newTheme, font })
    if (!isExternalUpdate.current && window.electronAPI?.broadcastThemePreferences) {
      window.electronAPI.broadcastThemePreferences({ mode, colorTheme: newTheme, font })
    }
  }, [mode, font])

  const setFont = useCallback((newFont: FontFamily) => {
    setFontState(newFont)
    saveTheme({ mode, colorTheme, font: newFont })
    if (!isExternalUpdate.current && window.electronAPI?.broadcastThemePreferences) {
      window.electronAPI.broadcastThemePreferences({ mode, colorTheme, font: newFont })
    }
  }, [mode, colorTheme])

  return (
    <ThemeContext.Provider
      value={{
        // Preferences
        mode,
        colorTheme,
        font,
        setMode,
        setColorTheme,
        setFont,

        // Derived
        resolvedMode,
        systemPreference,
        effectiveColorTheme,
        previewColorTheme,
        setPreviewColorTheme,

        // Theme resolution (singleton)
        presetTheme,
        resolvedTheme,
        isDark,
        isScenic,
        shikiTheme,
        shikiConfig,
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
