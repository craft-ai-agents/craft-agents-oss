/**
 * ShikiDiffViewer - Diff viewer using @pierre/diffs (Shiki-based)
 *
 * Replaces Monaco DiffEditor with a lighter weight Shiki-based solution.
 *
 * Features:
 * - Unified or split diff view
 * - Syntax highlighting via Shiki
 * - Light/dark theme support
 * - Line-level diff highlighting
 */

import * as React from 'react'
import { useState, useEffect, useMemo, useRef } from 'react'
import { FileDiff, type FileDiffMetadata, type FileDiffProps } from '@pierre/diffs/react'
import { parseDiffFromFile, DIFFS_TAG_NAME, type FileContents } from '@pierre/diffs'
import { cn } from '@/lib/utils'

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
import { useTheme } from '@/context/ThemeContext'
import { LANGUAGE_MAP } from '@/lib/file-utils'

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
  /** Callback when ready */
  onReady?: () => void
  /** Additional class names */
  className?: string
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
  onReady,
  className,
}: ShikiDiffViewerProps) {
  const { resolvedMode } = useTheme()
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

  // Diff options - use pierre themes for better diff contrast
  const options: FileDiffProps<undefined>['options'] = useMemo(() => ({
    theme: resolvedMode === 'dark' ? 'pierre-dark' : 'pierre-light',
    diffStyle,
    diffIndicators: 'bars',
    disableBackground: false,
    lineDiffType: 'word',
    overflow: 'scroll',
    disableFileHeader: true, // We handle headers ourselves
    themeType: resolvedMode === 'dark' ? 'dark' : 'light',
  }), [resolvedMode, diffStyle])

  // Call onReady after first render
  useEffect(() => {
    console.log('[DEBUG] ShikiDiffViewer - useEffect', {
      hasCalledReady: hasCalledReady.current,
      onReady: !!onReady,
      original: original?.slice(0, 50),
      modified: modified?.slice(0, 50),
      fileDiff,
    })
    if (!hasCalledReady.current && onReady) {
      hasCalledReady.current = true
      // Give Shiki time to highlight
      const timer = setTimeout(() => {
        console.log('[DEBUG] ShikiDiffViewer - setting ready')
        setIsReady(true)
        onReady()
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [onReady, original, modified, fileDiff])

  // Background color to match themes
  const backgroundColor = resolvedMode === 'dark' ? '#1e1e1e' : '#ffffff'

  // Debug: Log when FileDiff renders
  console.log('[DEBUG] ShikiDiffViewer render', {
    fileDiff,
    options,
    isReady,
    original: original?.slice(0, 100),
    modified: modified?.slice(0, 100),
  })

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
        className="min-h-full"
      />
    </div>
  )
}
