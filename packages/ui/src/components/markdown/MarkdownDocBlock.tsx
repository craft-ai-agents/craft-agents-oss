/**
 * MarkdownDocBlock - Renders ```markdown-preview code blocks as inline rendered markdown.
 *
 * Loads markdown content from file(s) (via `src` or `items` field) and renders
 * it through the shared `Markdown` component. Supports multiple items with a
 * tab bar for switching between them.
 *
 * Expected JSON shapes:
 * Single item:
 * {
 *   "src": "/absolute/path/to/file.md",
 *   "title": "Optional title"
 * }
 *
 * Multiple items:
 * {
 *   "title": "Spec drafts",
 *   "items": [
 *     { "src": "/path/to/v1.md", "label": "v1" },
 *     { "src": "/path/to/v2.md", "label": "v2" }
 *   ]
 * }
 *
 * Recursion guard: the inner `Markdown` invocation passes
 * `disablePreviewBlocks={new Set(['markdown-preview'])}` so a nested
 * `markdown-preview` fence falls through to a regular code block instead of
 * recursing forever. Other preview blocks (datatable, mermaid, …) still work.
 */

import * as React from 'react'
import { FileText, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { CodeBlock } from './CodeBlock'
import {
  PreviewBlockAction,
  PreviewBlockError,
  PreviewBlockFade,
  PreviewBlockFrame,
  PreviewBlockHeader,
  PreviewBlockLoading,
  PreviewItemNavigator,
} from './PreviewBlockChrome'
import { usePlatform } from '../../context/PlatformContext'
import { useTranslation } from 'react-i18next'
import { Markdown } from './Markdown'
import type { FileOpenHandler } from './link-target'
import {
  parseMarkdownPreviewSpec,
  normalizePreviewItems,
  type MarkdownPreviewItem,
} from './markdown-preview-helpers'

class MarkdownDocBlockErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error: Error) {
    console.warn('[MarkdownDocBlock] Render failed, falling back to CodeBlock:', error)
  }
  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

const DISABLE_INNER_MARKDOWN_PREVIEW: ReadonlySet<'markdown-preview'> = new Set(['markdown-preview'])

export interface MarkdownDocBlockProps {
  code: string
  className?: string
  onUrlClick?: (url: string) => void
  onFileClick?: FileOpenHandler
}

export function MarkdownDocBlock({ code, className, onUrlClick, onFileClick }: MarkdownDocBlockProps) {
  const { t } = useTranslation()
  const { onReadFile } = usePlatform()

  const spec = React.useMemo(() => parseMarkdownPreviewSpec(code), [code])
  const items = React.useMemo<MarkdownPreviewItem[]>(() => normalizePreviewItems(spec), [spec])

  const [activeIndex, setActiveIndex] = React.useState(0)
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  const [contentCache, setContentCache] = React.useState<Record<string, string>>({})
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const activeItem = items[activeIndex]
  const activeContent = activeItem ? contentCache[activeItem.src] : undefined

  React.useEffect(() => {
    if (!activeItem) {
      setActiveIndex(0)
      return
    }
    if (activeIndex > items.length - 1) {
      setActiveIndex(0)
    }
  }, [activeIndex, activeItem, items.length])

  React.useEffect(() => {
    if (!activeItem?.src || !onReadFile) return
    if (contentCache[activeItem.src] !== undefined) {
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    onReadFile(activeItem.src)
      .then((content) => {
        if (cancelled) return
        setContentCache((prev) => ({ ...prev, [activeItem.src]: content }))
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to read markdown file')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [activeItem?.src, onReadFile, contentCache])

  const fallback = <CodeBlock code={code} language="json" mode="full" className={className} />

  if (!spec || items.length === 0) {
    return fallback
  }

  const headerTitle = spec.title || t('preview.markdownPreview')
  // Until the active file arrives, keep the content area at its 400px cap so the transcript
  // doesn't shift when the document renders.
  const awaitingContent = activeContent === undefined && !error && !!onReadFile

  return (
    <MarkdownDocBlockErrorBoundary fallback={fallback}>
      <PreviewBlockFrame className={className}>
        {/* Header: title · item navigator · expand in place */}
        <PreviewBlockHeader icon={<FileText />} title={headerTitle}>
          <PreviewItemNavigator items={items} activeIndex={activeIndex} onSelect={setActiveIndex} />
          <PreviewBlockAction
            aria-label={isFullscreen ? t('common.close') : t('preview.expandPreview')}
            aria-expanded={isFullscreen}
            icon={isFullscreen ? <Minimize2 /> : <Maximize2 />}
            onClick={() => setIsFullscreen((v) => !v)}
          />
        </PreviewBlockHeader>

        {/* The document sits on paper inside the well (nested code wells stay distinct); the fade
            is a sibling of the scroller so it stays pinned to the bottom edge while scrolling. */}
        <div className="relative bg-paper">
          <div
            className={cn(
              'overflow-auto px-3 py-2',
              isFullscreen ? 'max-h-[80vh]' : 'max-h-[400px]',
              awaitingContent && 'h-[400px]'
            )}
          >
            {activeContent !== undefined && (
              <Markdown
                mode="minimal"
                disablePreviewBlocks={DISABLE_INNER_MARKDOWN_PREVIEW}
                onUrlClick={onUrlClick}
                onFileClick={onFileClick}
              >
                {activeContent}
              </Markdown>
            )}

            {activeContent === undefined && loading && (
              <PreviewBlockLoading className="h-full">{t('common.loading')}</PreviewBlockLoading>
            )}

            {activeContent === undefined && !loading && error && (
              <PreviewBlockError>{error}</PreviewBlockError>
            )}
          </div>

          {!isFullscreen && activeContent !== undefined && <PreviewBlockFade surface="paper" />}
        </div>
      </PreviewBlockFrame>
    </MarkdownDocBlockErrorBoundary>
  )
}
