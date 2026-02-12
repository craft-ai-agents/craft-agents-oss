import * as React from 'react'
import { Maximize2, Minimize2, Code2, Globe } from 'lucide-react'
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
// Theming: Detects the app's dark/light mode and adjusts the iframe's base
// stylesheet accordingly. Most rich HTML (emails, etc.) defines its own
// colors, so the base styles serve as sensible defaults for minimal HTML.
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
 * Build base styles for the iframe document.
 * Adapts to the app's current theme (dark/light).
 *
 * Most rich HTML (emails, newsletters) defines its own colors and layout.
 * These base styles only apply as defaults for content that doesn't set its own.
 */
function buildBaseStyles(isDark: boolean): string {
  const bg = isDark ? '#1a1a2e' : '#ffffff'
  const fg = isDark ? '#e2e8f0' : '#1a1a1a'
  const linkColor = isDark ? '#60a5fa' : '#2563eb'
  const borderColor = isDark ? '#334155' : '#e2e8f0'

  return `
    <style data-g4os-base>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 12px 16px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: ${fg};
        background: ${bg};
        overflow-wrap: break-word;
        word-wrap: break-word;
      }
      img { max-width: 100%; height: auto; }
      a { color: ${linkColor}; }
      table { border-collapse: collapse; max-width: 100%; }
      td, th { border-color: ${borderColor}; }
      pre { overflow-x: auto; }
      hr { border-color: ${borderColor}; }
    </style>
  `
}

/**
 * Build a complete HTML document with a base stylesheet injected.
 */
function buildSrcDoc(html: string, isDark: boolean): string {
  const baseStyles = buildBaseStyles(isDark)

  // If the HTML already has a <head>, inject styles into it
  const lowerHtml = html.toLowerCase()

  if (lowerHtml.includes('<head>')) {
    return html.replace(/<head>/i, `<head>${baseStyles}`)
  }
  if (lowerHtml.includes('<html')) {
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
  const [isDarkMode, setIsDarkMode] = React.useState(false)

  // Detect dark mode and listen for changes
  React.useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'))
    }
    checkDarkMode()

    const observer = new MutationObserver(checkDarkMode)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const srcDoc = React.useMemo(() => buildSrcDoc(code, isDarkMode), [code, isDarkMode])

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
          <Globe className="w-3.5 h-3.5" />
        </button>
        <CodeBlock code={code} language="html" mode="full" className="my-0" />
      </div>
    )
  }

  const fallback = <CodeBlock code={code} language="html" mode="full" className={className} />

  // Theme-aware container and fade colors
  const containerBg = isDarkMode ? 'bg-[#1a1a2e]' : 'bg-white'
  const fadeBg = isDarkMode
    ? 'linear-gradient(to bottom, transparent, #1a1a2e)'
    : 'linear-gradient(to bottom, transparent, white)'

  return (
    <HtmlBlockErrorBoundary fallback={fallback}>
      <div className={cn('relative group rounded-[8px] overflow-hidden border', containerBg, className)}>
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
            style={{ background: fadeBg }}
          />
        )}
      </div>
    </HtmlBlockErrorBoundary>
  )
}
