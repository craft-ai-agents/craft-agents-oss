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
  // Get resolved mode and color theme from ThemeContext
  const { resolvedMode, colorTheme } = useThemeContext()
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

    // When using default theme, clear all custom CSS and return
    if (!colorTheme || colorTheme === 'default') {
      styleEl.textContent = ''
      delete document.documentElement.dataset.themeMismatch
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

    // Handle theme-mode mismatch (e.g., dark-only theme in light mode)
    // When a theme doesn't support the current mode, add solid background
    const supportedModes = presetTheme?.supportedModes
    const currentMode = isDark ? 'dark' : 'light'
    if (supportedModes && supportedModes.length > 0 && !supportedModes.includes(currentMode)) {
      document.documentElement.dataset.themeMismatch = 'true'
    } else {
      delete document.documentElement.dataset.themeMismatch
    }
  }, [resolvedTheme, isDark, presetTheme, appTheme, workspaceTheme, colorTheme])

  return {
    theme: resolvedTheme,
    defaultTheme: DEFAULT_THEME,
    shikiTheme,
    shikiConfig,
    presetTheme,
    isDark,
  }
}
