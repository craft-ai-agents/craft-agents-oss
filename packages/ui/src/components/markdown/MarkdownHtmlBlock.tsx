import * as React from 'react'
import { Maximize2, Minimize2, ExternalLink, Code2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { CodeBlock } from './CodeBlock'

// ============================================================================
// MarkdownHtmlBlock — renders ```html code fences as sandboxed iframes.
//
// Used for rich HTML content from tool results (emails, web pages, reports)
// that should preserve their original CSS layout, images, and typography
// rather than being rendered as markdown.
//
// Security: Uses <iframe sandbox="allow-same-origin"> with no allow-scripts,
// so embedded HTML cannot execute JavaScript. The srcdoc attribute injects
// the HTML directly, avoiding network requests.
//
// Theming: Injects a minimal base stylesheet that inherits the app's
// background color for a seamless look, and sets a default sans-serif font.
//
// Auto-sizing: A ResizeObserver monitors the iframe content's body height
// and adjusts the iframe element to match, up to a configurable max height.
// Beyond that, the iframe scrolls internally.
// ============================================================================

/** Max height before the iframe gets internal scrolling */
const MAX_COLLAPSED_HEIGHT = 600
const MAX_EXPANDED_HEIGHT = 2000

/** Error boundary for iframe rendering failures */
class HtmlBlockErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.warn('[MarkdownHtmlBlock] Render error:', error)
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

interface MarkdownHtmlBlockProps {
  code: string
  className?: string
}

/**
 * Build a complete HTML document with a base stylesheet injected.
 * The base stylesheet:
 * - Resets margin/padding on body
 * - Sets a transparent background (so the card wrapper's bg shows through)
 * - Uses system sans-serif font as default
 * - Ensures images don't overflow
 */
function buildSrcDoc(html: string): string {
  const baseStyles = `
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 12px 16px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: #1a1a1a;
        background: transparent;
        overflow-wrap: break-word;
        word-wrap: break-word;
      }
      img { max-width: 100%; height: auto; }
      a { color: #2563eb; }
      table { border-collapse: collapse; max-width: 100%; }
      pre { overflow-x: auto; }
    </style>
  `

  // If the HTML already has a <head>, inject styles into it.
  // Otherwise, if it has <html>, inject before </html>.
  // Otherwise, prepend the styles.
  const lowerHtml = html.toLowerCase()

  if (lowerHtml.includes('<head>')) {
    return html.replace(/<head>/i, `<head>${baseStyles}`)
  }
  if (lowerHtml.includes('<html')) {
    // Insert <head> with styles after <html...>
    return html.replace(/<html[^>]*>/i, (match) => `${match}<head>${baseStyles}</head>`)
  }

  // No document structure — wrap content with styles
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${baseStyles}</head><body>${html}</body></html>`
}

export function MarkdownHtmlBlock({ code, className }: MarkdownHtmlBlockProps) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const [contentHeight, setContentHeight] = React.useState<number>(200)
  const [isExpanded, setIsExpanded] = React.useState(false)
  const [showSource, setShowSource] = React.useState(false)

  const srcDoc = React.useMemo(() => buildSrcDoc(code), [code])

  const maxHeight = isExpanded ? MAX_EXPANDED_HEIGHT : MAX_COLLAPSED_HEIGHT
  const displayHeight = Math.min(contentHeight, maxHeight)
  const isOverflowing = contentHeight > maxHeight

  // Auto-resize iframe to match content height
  const handleLoad = React.useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    try {
      const doc = iframe.contentDocument
      if (!doc?.body) return

      // Initial measurement
      const measure = () => {
        const height = doc.body.scrollHeight
        if (height > 0) {
          setContentHeight(height)
        }
      }

      measure()

      // Observe for dynamic content changes (images loading, etc.)
      const observer = new ResizeObserver(measure)
      observer.observe(doc.body)

      // Also listen for image load events
      const images = doc.querySelectorAll('img')
      images.forEach((img) => {
        if (!img.complete) {
          img.addEventListener('load', measure, { once: true })
        }
      })

      // Cleanup on next load or unmount
      return () => {
        observer.disconnect()
      }
    } catch {
      // Cross-origin restrictions — shouldn't happen with srcdoc but be safe
      setContentHeight(400)
    }
  }, [])

  // Toggle between rendered HTML and source code
  if (showSource) {
    return (
      <div className={cn('relative group', className)}>
        <button
          onClick={() => setShowSource(false)}
          className={cn(
            'absolute top-2 right-2 z-10 p-1 rounded-[6px] transition-all select-none',
            'bg-background shadow-minimal',
            'text-muted-foreground/50 hover:text-foreground',
            'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
          )}
          title="View rendered HTML"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
        <CodeBlock code={code} language="html" mode="full" className="my-0" />
      </div>
    )
  }

  const fallback = <CodeBlock code={code} language="html" mode="full" className={className} />

  return (
    <HtmlBlockErrorBoundary fallback={fallback}>
      <div className={cn('relative group rounded-[8px] overflow-hidden border bg-white', className)}>
        {/* Toolbar — visible on hover */}
        <div className={cn(
          'absolute top-2 right-2 z-10 flex items-center gap-1',
          'opacity-0 group-hover:opacity-100 transition-opacity'
        )}>
          {/* View source button */}
          <button
            onClick={() => setShowSource(true)}
            className={cn(
              'p-1 rounded-[6px] transition-all select-none',
              'bg-background shadow-minimal',
              'text-muted-foreground/50 hover:text-foreground',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
            )}
            title="View source"
          >
            <Code2 className="w-3.5 h-3.5" />
          </button>

          {/* Expand/collapse button — only shown when content overflows */}
          {isOverflowing && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={cn(
                'p-1 rounded-[6px] transition-all select-none',
                'bg-background shadow-minimal',
                'text-muted-foreground/50 hover:text-foreground',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
              )}
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>

        {/* Sandboxed iframe */}
        <iframe
          ref={iframeRef}
          srcDoc={srcDoc}
          sandbox="allow-same-origin"
          onLoad={handleLoad}
          style={{
            width: '100%',
            height: `${displayHeight}px`,
            border: 'none',
            display: 'block',
            overflow: isOverflowing ? 'auto' : 'hidden',
          }}
          title="HTML content"
        />

        {/* Overflow fade indicator at bottom */}
        {isOverflowing && !isExpanded && (
          <div
            className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, transparent, white)',
            }}
          />
        )}
      </div>
    </HtmlBlockErrorBoundary>
  )
}
