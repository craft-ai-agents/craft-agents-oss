import { useEffect, useMemo, useState } from 'react'
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
import { useTheme as useThemeContext } from '@/context/ThemeContext'

interface UseThemeOptions {
  /**
   * App-level theme (from ~/.craft-agent/theme.json)
   */
  appTheme?: ThemeOverrides | null

  /**
   * Workspace-level theme (from workspace/theme.json)
   */
  workspaceTheme?: ThemeOverrides | null
}

interface UseThemeResult {
  theme: ThemeOverrides
  defaultTheme: ThemeOverrides
  shikiTheme: string
  shikiConfig: ShikiThemeConfig
  presetTheme: ThemeFile | null
  isDark: boolean
}

/**
 * Hook to manage cascading theme (preset → app → workspace).
 * Resolves themes and injects CSS variables into document.
 * Also provides Shiki theme name for syntax highlighting.
 *
 * @example
 * ```tsx
 * const [appTheme] = useAtom(appThemeAtom)
 * const [workspaceTheme] = useAtom(workspaceThemeAtom)
 *
 * const { shikiTheme } = useTheme({ appTheme, workspaceTheme })
 * ```
 */
export function useTheme({ appTheme, workspaceTheme }: UseThemeOptions = {}): UseThemeResult {
  // Get resolved mode, system preference, and color theme from ThemeContext
  const { resolvedMode, systemPreference, colorTheme } = useThemeContext()
  const isDark = resolvedMode === 'dark'

  // Load preset theme when colorTheme changes
  const [presetTheme, setPresetTheme] = useState<ThemeFile | null>(null)

  useEffect(() => {
    if (!colorTheme || colorTheme === 'default') {
      setPresetTheme(null)
      return
    }

    // Load preset theme via IPC
    window.electronAPI?.loadPresetTheme?.(colorTheme).then((preset) => {
      setPresetTheme(preset?.theme ?? null)
    }).catch(() => {
      setPresetTheme(null)
    })
  }, [colorTheme])

  // Resolve cascading theme (preset → app → workspace)
  // Preset provides base, app/workspace can override
  const resolvedTheme = useMemo(() => {
    return resolveTheme(
      presetTheme ?? undefined,
      resolveTheme(appTheme ?? undefined, workspaceTheme ?? undefined)
    )
  }, [presetTheme, appTheme, workspaceTheme])

  // Get Shiki theme configuration
  const shikiConfig = useMemo(() => {
    return presetTheme?.shikiTheme || DEFAULT_SHIKI_THEME
  }, [presetTheme])

  // Get the current Shiki theme name based on mode
  // If theme doesn't support current mode, use the mode it does support
  const shikiTheme = useMemo(() => {
    const supportedModes = presetTheme?.supportedModes
    const currentMode = isDark ? 'dark' : 'light'

    // If theme has limited mode support and doesn't include current mode,
    // use the mode it does support for Shiki
    if (supportedModes && supportedModes.length > 0 && !supportedModes.includes(currentMode)) {
      // Use the first supported mode (e.g., dark-only theme uses dark shiki even in "light" mode)
      const effectiveMode = supportedModes[0] === 'dark'
      return getShikiTheme(shikiConfig, effectiveMode)
    }

    return getShikiTheme(shikiConfig, isDark)
  }, [shikiConfig, isDark, presetTheme])

  // Generate CSS and inject into document
  useEffect(() => {
    // Get or create style element
    const styleId = 'craft-theme-overrides'
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null

    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }

    // Always set theme-override for 50% opacity background (vibrancy effect)
    document.documentElement.dataset.themeOverride = 'true'

    // Handle themeMismatch - set solid background when:
    // 1. Theme doesn't support current mode (e.g., dark-only Dracula in light mode), OR
    // 2. Resolved mode differs from system preference (vibrancy mismatch)
    const supportedModes = presetTheme?.supportedModes
    const currentMode = isDark ? 'dark' : 'light'
    const themeModeUnsupported = supportedModes && supportedModes.length > 0 && !supportedModes.includes(currentMode)
    const vibrancyMismatch = resolvedMode !== systemPreference

    if (themeModeUnsupported || vibrancyMismatch) {
      document.documentElement.dataset.themeMismatch = 'true'
    } else {
      delete document.documentElement.dataset.themeMismatch
    }

    // When using default theme, clear custom CSS but keep theme-override and themeMismatch
    if (!colorTheme || colorTheme === 'default') {
      styleEl.textContent = ''
      return
    }

    // Generate CSS variable declarations
    const cssVars = themeToCSS(resolvedTheme, isDark)

    // Inject CSS variables on :root
    if (cssVars) {
      styleEl.textContent = `:root {\n  ${cssVars}\n}`
    } else {
      styleEl.textContent = ''
    }

  }, [resolvedTheme, isDark, presetTheme, appTheme, workspaceTheme, colorTheme, resolvedMode, systemPreference])

  return {
    theme: resolvedTheme,
    defaultTheme: DEFAULT_THEME,
    shikiTheme,
    shikiConfig,
    presetTheme,
    isDark,
  }
}
