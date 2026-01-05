import { useEffect, useMemo } from 'react'
import { resolveTheme, themeToCSS, DEFAULT_THEME, type ThemeOverrides } from '@config/theme'
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

  /**
   * Agent-level theme (from workspace/agents/{slug}/theme.json)
   */
  agentTheme?: ThemeOverrides | null
}

/**
 * Hook to manage cascading theme (app → workspace → agent).
 * Resolves themes and injects CSS variables into document.
 *
 * @example
 * ```tsx
 * const [appTheme] = useAtom(appThemeAtom)
 * const [workspaceTheme] = useAtom(workspaceThemeAtom)
 * const agentTheme = activeAgent?.theme
 *
 * useTheme({ appTheme, workspaceTheme, agentTheme })
 * ```
 */
export function useTheme({ appTheme, workspaceTheme, agentTheme }: UseThemeOptions = {}) {
  // Get resolved mode from ThemeContext (respects app's theme setting, not just system)
  const { resolvedMode } = useThemeContext()
  const isDark = resolvedMode === 'dark'

  // Resolve cascading theme (later sources override earlier)
  const resolvedTheme = useMemo(() => {
    return resolveTheme(
      appTheme ?? undefined,
      workspaceTheme ?? undefined,
      agentTheme ?? undefined
    )
  }, [appTheme, workspaceTheme, agentTheme])

  // Generate CSS and inject into document
  useEffect(() => {
    // Only apply if we have any theme overrides
    const hasOverrides = appTheme || workspaceTheme || agentTheme
    if (!hasOverrides) return

    // Generate CSS variable declarations
    const cssVars = themeToCSS(resolvedTheme, isDark)
    if (!cssVars) return

    // Create or update style element
    const styleId = 'craft-theme-overrides'
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null

    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }

    // Inject CSS variables on :root
    styleEl.textContent = `:root {\n  ${cssVars}\n}`

    // Cleanup on unmount or when theme changes
    return () => {
      // Don't remove on every change - only on full unmount
      // We want the style to persist between re-renders
    }
  }, [resolvedTheme, isDark, appTheme, workspaceTheme, agentTheme])

  return {
    theme: resolvedTheme,
    defaultTheme: DEFAULT_THEME,
  }
}
