/**
 * ShikiDiffViewer - Diff viewer using @pierre/diffs (Shiki-based)
 *
 * Platform-agnostic component for displaying file diffs with:
 * - Unified or split diff view
 * - Syntax highlighting via Shiki
 * - Light/dark theme support
 * - Line-level diff highlighting
 */

import * as React from 'react'
import { useState, useEffect, useMemo, useRef } from 'react'
import { FileDiff, type FileDiffMetadata, type FileDiffProps } from '@pierre/diffs/react'
import { parseDiffFromFile, DIFFS_TAG_NAME, registerCustomTheme, resolveTheme, type FileContents } from '@pierre/diffs'
import { cn } from '../../lib/utils'
import { LANGUAGE_MAP } from './language-map'

// Register the diffs-container custom element if not already registered
// This is necessary because the React component renders a custom element
if (typeof HTMLElement !== 'undefined' && !customElements.get(DIFFS_TAG_NAME)) {
  class FileDiffContainer extends HTMLElement {
    constructor() {
      super()
      if (this.shadowRoot != null) return
      this.attachShadow({ mode: 'open' })
    }
  }
  customElements.define(DIFFS_TAG_NAME, FileDiffContainer)
}

// Register custom themes based on pierre-dark/light but with transparent background.
// This lets the container's var(--background) CSS variable show through,
// so the diff viewer respects custom app themes (e.g. Dracula).
registerCustomTheme('craft-dark', async () => {
  const theme = await resolveTheme('pierre-dark')
  return { ...theme, name: 'craft-dark', bg: 'transparent', colors: { ...theme.colors, 'editor.background': 'transparent' } }
})
registerCustomTheme('craft-light', async () => {
  const theme = await resolveTheme('pierre-light')
  return { ...theme, name: 'craft-light', bg: 'transparent', colors: { ...theme.colors, 'editor.background': 'transparent' } }
})

export interface ShikiDiffViewerProps {
  /** Original (before) content */
  original: string
  /** Modified (after) content */
  modified: string
  /** File path - used for language detection and display */
  filePath?: string
  /** Language for syntax highlighting (auto-detected from filePath if not provided) */
  language?: string
  /** Diff style: 'unified' (stacked) or 'split' (side-by-side) */
  diffStyle?: 'unified' | 'split'
  /** Theme mode */
  theme?: 'light' | 'dark'
  /** Shiki theme name (e.g., 'dracula', 'github-dark'). When provided, uses the matching
   *  Shiki theme natively. Falls back to craft-dark/craft-light (transparent bg) if not set. */
  shikiTheme?: string
  /** Disable background highlighting on changed lines */
  disableBackground?: boolean
  /** Callback when ready */
  onReady?: () => void
  /** Additional class names */
  className?: string
}

/**
 * Calculate addition/deletion stats from a FileDiffMetadata
 * Useful for displaying change counts in headers
 */
export function getDiffStats(fileDiff: FileDiffMetadata): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const hunk of fileDiff.hunks) {
    additions += hunk.additionCount
    deletions += hunk.deletionCount
  }
  return { additions, deletions }
}

function getLanguageFromPath(filePath: string, explicit?: string): string {
  if (explicit) return explicit
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return LANGUAGE_MAP[ext] || 'text'
}

/**
 * ShikiDiffViewer - Shiki-based diff viewer component
 */
export function ShikiDiffViewer({
  original,
  modified,
  filePath = 'file',
  language,
  diffStyle = 'unified',
  theme = 'light',
  shikiTheme,
  disableBackground = false,
  onReady,
  className,
}: ShikiDiffViewerProps) {
  const hasCalledReady = useRef(false)
  const [isReady, setIsReady] = useState(false)

  // Resolve language
  const resolvedLang = useMemo(() => {
    return language || getLanguageFromPath(filePath)
  }, [language, filePath])

  // Create file contents objects for the diff parser
  const oldFile: FileContents = useMemo(() => ({
    name: filePath,
    contents: original,
    lang: resolvedLang as any,
  }), [filePath, original, resolvedLang])

  const newFile: FileContents = useMemo(() => ({
    name: filePath,
    contents: modified,
    lang: resolvedLang as any,
  }), [filePath, modified, resolvedLang])

  // Parse the diff
  const fileDiff: FileDiffMetadata = useMemo(() => {
    return parseDiffFromFile(oldFile, newFile)
  }, [oldFile, newFile])

  // Diff options - use the app's Shiki theme if available, otherwise fall back
  // to craft-dark/craft-light which have transparent bg for CSS variable theming
  const resolvedThemeName = shikiTheme || (theme === 'dark' ? 'craft-dark' : 'craft-light')
  const options: FileDiffProps<undefined>['options'] = useMemo(() => ({
    theme: resolvedThemeName,
    diffStyle,
    diffIndicators: 'bars',
    disableBackground,
    lineDiffType: 'word',
    overflow: 'scroll',
    disableFileHeader: true,
    themeType: theme === 'dark' ? 'dark' : 'light',
  }), [resolvedThemeName, theme, diffStyle, disableBackground])

  // Call onReady after first render
  useEffect(() => {
    if (!hasCalledReady.current && onReady) {
      hasCalledReady.current = true
      // Give Shiki time to highlight
      const timer = setTimeout(() => {
        setIsReady(true)
        onReady()
      }, 100)
      return () => {
        clearTimeout(timer)
        hasCalledReady.current = false // Reset so re-mounts (including StrictMode) re-arm the timer
      }
    }
  }, [onReady, original, modified, fileDiff])

  // Use CSS variable so custom themes are respected
  const backgroundColor = 'var(--background)'

  return (
    <div
      className={cn(
        'h-full w-full overflow-auto transition-opacity duration-200',
        className
      )}
      style={{
        backgroundColor,
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <FileDiff
        fileDiff={fileDiff}
        options={options}
        className="min-h-full h-full"
      />
    </div>
  )
}
