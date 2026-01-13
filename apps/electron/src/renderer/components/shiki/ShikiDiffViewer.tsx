/**
 * ShikiDiffViewer - Electron wrapper for the portable ShikiDiffViewer
 *
 * This thin wrapper imports the portable component from @craft-agent/ui
 * and connects it to Electron's ThemeContext.
 *
 * Note: The base component uses a simpler timing approach for onReady.
 * If more precise timing is needed for window reveal, the onReady callback
 * fires after a short delay (100ms) to allow Shiki to highlight.
 *
 * The diff viewer uses pierre-dark/pierre-light themes which are optimized
 * for diff visualization rather than the preset Shiki themes.
 */

import * as React from 'react'
import { ShikiDiffViewer as BaseShikiDiffViewer, type ShikiDiffViewerProps as BaseProps } from '@craft-agent/ui'
import { useTheme } from '@/hooks/useTheme'

export interface ShikiDiffViewerProps extends Omit<BaseProps, 'theme'> {}

/**
 * ShikiDiffViewer - Shiki-based diff viewer component
 * Connected to Electron's theme context.
 */
export function ShikiDiffViewer(props: ShikiDiffViewerProps) {
  const { isDark } = useTheme()

  return <BaseShikiDiffViewer {...props} theme={isDark ? 'dark' : 'light'} />
}
