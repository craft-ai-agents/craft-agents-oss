/**
 * GenericOverlay - Fallback overlay for unknown tool content
 *
 * Uses PreviewOverlay for presentation and CodeBlock for syntax highlighting.
 * Auto-detects language from content patterns or file path.
 * Supports optional diff mode for side-by-side comparison.
 */

import * as React from 'react'
import { useMemo } from 'react'
import { FileCode } from 'lucide-react'
import { PreviewOverlay } from './PreviewOverlay'
import { CodeBlock } from '../markdown/CodeBlock'

export interface GenericOverlayProps {
  /** Content to display (used when not in diff mode) */
  content: string
  /** Language for syntax highlighting (auto-detected if not provided) */
  language?: string
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close */
  onClose: () => void
  /** Optional title to display in the header */
  title?: string
  /** Enable diff mode for side-by-side comparison */
  diffMode?: boolean
  /** Original content (left side) for diff mode */
  originalContent?: string
  /** Modified content (right side) for diff mode */
  modifiedContent?: string
}

/**
 * Auto-detect language from content patterns.
 * Checks for JSON, code blocks, then defaults to markdown.
 */
function detectLanguage(content: string): string {
  const trimmed = content.trim()

  // Check for JSON - starts with { or [ and looks like valid JSON structure
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return 'json'
  }

  // Check for code block markers at the start
  const codeBlockMatch = content.match(/^```(\w+)/)
  if (codeBlockMatch && codeBlockMatch[1]) {
    return codeBlockMatch[1]
  }

  // Default to markdown for GenericOverlay content (commentary, thinking, etc.)
  return 'markdown'
}

/**
 * Detect language from file path extension.
 */
export function detectLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'bash',
    rs: 'rust',
    go: 'go',
    rb: 'ruby',
    php: 'php',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
    toml: 'toml',
    ini: 'ini',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
  }
  return langMap[ext || ''] || 'text'
}

export function GenericOverlay({
  content,
  language,
  isOpen,
  onClose,
  title = 'Preview',
  diffMode = false,
  originalContent = '',
  modifiedContent = '',
}: GenericOverlayProps) {
  // Auto-detect language if not provided
  const detectedLanguage = useMemo(() => {
    if (language) return language
    // Try to detect from title (file path)
    if (title.includes('/') || title.includes('.')) {
      const pathLang = detectLanguageFromPath(title)
      if (pathLang !== 'text') return pathLang
    }
    return detectLanguage(diffMode ? modifiedContent : content)
  }, [language, title, diffMode, modifiedContent, content])

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      badge={{
        icon: FileCode,
        label: detectedLanguage,
        variant: 'gray',
      }}
      title={title}
    >
      <div className="absolute inset-0 overflow-auto p-4">
        {diffMode ? (
          // Side-by-side diff view
          <div className="flex gap-4 h-full">
            <div className="flex-1 flex flex-col min-w-0">
              <div className="text-xs text-muted-foreground mb-2 font-medium">Original</div>
              <div className="flex-1 overflow-auto rounded-lg border bg-muted/20 p-4">
                <CodeBlock code={originalContent} language={detectedLanguage} mode="minimal" />
              </div>
            </div>
            <div className="flex-1 flex flex-col min-w-0">
              <div className="text-xs text-muted-foreground mb-2 font-medium">Modified</div>
              <div className="flex-1 overflow-auto rounded-lg border bg-muted/20 p-4">
                <CodeBlock code={modifiedContent} language={detectedLanguage} mode="minimal" />
              </div>
            </div>
          </div>
        ) : (
          // Single content view
          // Note: No h-full - content grows naturally and outer container scrolls
          <div className="rounded-lg border bg-muted/20 p-4">
            <CodeBlock code={content} language={detectedLanguage} mode="minimal" />
          </div>
        )}
      </div>
    </PreviewOverlay>
  )
}
