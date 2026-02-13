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
// Security: Uses <iframe sandbox="allow-scripts"> (no allow-same-origin),
// so embedded HTML can run JavaScript but gets an opaque origin — it cannot
// access the parent document or escape the sandbox. The srcdoc attribute
// injects the HTML directly, avoiding network requests.
//
// Theming: Detects the app's dark/light mode and adjusts the iframe's base
// stylesheet accordingly. Most rich HTML (emails, etc.) defines its own
// colors, so the base styles serve as sensible defaults for minimal HTML.
//
// Auto-sizing: An injected script inside the iframe uses ResizeObserver and
// postMessage to report its content height to the parent. The parent listens
// for these messages and adjusts the iframe element to match, up to a
// configurable max height. Beyond that, the iframe scrolls internally.
// ============================================================================

/** Max height before the iframe shows expand bar */
const MAX_COLLAPSED_HEIGHT = 600

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
      a:visited { color: ${linkColor}; }
      table { border-collapse: collapse; max-width: 100%; }
      td, th { border-color: ${borderColor}; }
      pre { overflow-x: auto; }
      hr { border-color: ${borderColor}; }
      button, input[type="submit"], input[type="button"] {
        padding: 8px 16px;
        border: 1px solid ${borderColor};
        border-radius: 6px;
        background: ${isDark ? '#2a2a3e' : '#f8f9fa'};
        color: ${fg};
        font-size: 14px;
        cursor: pointer;
      }
      button:hover, input[type="submit"]:hover, input[type="button"]:hover {
        background: ${isDark ? '#3a3a4e' : '#f1f3f4'};
        border-color: ${isDark ? '#4a4a5e' : '#dadce0'};
      }
    </style>
  `
}

/**
 * Extract a base URL from the HTML content.
 * Looks for existing <base href> or common URL patterns in links/images
 * to determine the origin for resolving relative URLs in srcdoc iframes.
 */
function extractBaseUrl(html: string): string | null {
  // Check for existing <base href>
  const baseMatch = html.match(/<base\s+href=["']([^"']+)["']/i)
  if (baseMatch?.[1]) return baseMatch[1]

  // Look for absolute URLs in common attributes to infer origin
  const urlMatch = html.match(/(?:href|src|action)=["'](https?:\/\/[^/"']+)/i)
  if (urlMatch?.[1]) return urlMatch[1]

  return null
}

/**
 * Build override styles injected at the END of the document.
 * Uses low-specificity selectors so the content's own CSS wins.
 * Only provides fallback link colors for content that doesn't style its own links.
 */
function buildOverrideStyles(_isDark: boolean): string {
  // No overrides needed — base styles in <head> provide sensible defaults.
  // Content's own CSS (emails, web pages) takes precedence naturally.
  return ''
}

/** Script injected into the iframe to report height and proxy fullscreen via postMessage */
const IFRAME_BRIDGE_SCRIPT = `<script>
(function(){
  // --- Height reporting ---
  function send(){
    var h = document.documentElement.scrollHeight || document.body.scrollHeight;
    if(h > 0) parent.postMessage({type:'g4os-iframe-height', height:h},'*');
  }
  send();
  setTimeout(send, 100);
  setTimeout(send, 500);
  if(window.ResizeObserver){
    new ResizeObserver(send).observe(document.body);
  }
  document.querySelectorAll('img').forEach(function(img){
    if(!img.complete) img.addEventListener('load', send, {once:true});
  });

  // --- Fullscreen proxy ---
  // The Fullscreen API is blocked inside a sandboxed iframe with an opaque
  // origin. Override it to delegate to the parent, which calls
  // requestFullscreen() on the iframe element itself.
  Element.prototype.requestFullscreen = function(){
    parent.postMessage({type:'g4os-iframe-fullscreen', action:'enter'},'*');
    return Promise.resolve();
  };
  if(Element.prototype.webkitRequestFullscreen){
    Element.prototype.webkitRequestFullscreen = function(){
      parent.postMessage({type:'g4os-iframe-fullscreen', action:'enter'},'*');
    };
  }
  document.exitFullscreen = function(){
    parent.postMessage({type:'g4os-iframe-fullscreen', action:'exit'},'*');
    return Promise.resolve();
  };
  if(document.webkitExitFullscreen){
    document.webkitExitFullscreen = function(){
      parent.postMessage({type:'g4os-iframe-fullscreen', action:'exit'},'*');
    };
  }
})();
</script>`

/**
 * Build a complete HTML document with a base stylesheet injected.
 * Also injects a <base> tag for resolving relative URLs when possible.
 * Override styles are appended at the END so they win the CSS cascade.
 * A height-reporting script is injected at the end of the body.
 */
function buildSrcDoc(html: string, isDark: boolean): string {
  const baseStyles = buildBaseStyles(isDark)
  const overrideStyles = buildOverrideStyles(isDark)
  const baseUrl = extractBaseUrl(html)
  const baseTag = baseUrl ? `<base href="${baseUrl}" target="_blank">` : ''
  const headInjection = `${baseTag}${baseStyles}`

  // If the HTML already has a <head>, inject into it
  const lowerHtml = html.toLowerCase()

  if (lowerHtml.includes('</body>')) {
    // Inject base styles in head, override styles + height script at end of body
    let result = html
    if (lowerHtml.includes('<head>')) {
      result = result.replace(/<head>/i, `<head>${headInjection}`)
    } else if (lowerHtml.includes('<html')) {
      result = result.replace(/<html[^>]*>/i, (match) => `${match}<head>${headInjection}</head>`)
    }
    return result.replace(/<\/body>/i, `${overrideStyles}${IFRAME_BRIDGE_SCRIPT}</body>`)
  }

  if (lowerHtml.includes('<head>')) {
    return html.replace(/<head>/i, `<head>${headInjection}`) + overrideStyles + IFRAME_BRIDGE_SCRIPT
  }
  if (lowerHtml.includes('<html')) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}<head>${headInjection}</head>`) + overrideStyles + IFRAME_BRIDGE_SCRIPT
  }

  // No document structure — wrap content with styles
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${headInjection}</head><body>${html}${overrideStyles}${IFRAME_BRIDGE_SCRIPT}</body></html>`
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

  const displayHeight = isExpanded ? contentHeight : Math.min(contentHeight, MAX_COLLAPSED_HEIGHT)
  const isOverflowing = contentHeight > MAX_COLLAPSED_HEIGHT

  // Listen for messages from the iframe via postMessage.
  // Handles height reporting and fullscreen proxy requests.
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return

      if (
        event.data?.type === 'g4os-iframe-height' &&
        typeof event.data.height === 'number'
      ) {
        setContentHeight(event.data.height)
      } else if (event.data?.type === 'g4os-iframe-fullscreen') {
        if (event.data.action === 'enter') {
          iframeRef.current?.requestFullscreen?.()
        } else if (event.data.action === 'exit') {
          if (document.fullscreenElement) document.exitFullscreen()
        }
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
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

        {/* Sandboxed iframe — allow-scripts (no allow-same-origin) for safe JS execution */}
        <iframe
          ref={iframeRef}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          allow="fullscreen"
          allowFullScreen
          style={{
            width: '100%',
            height: `${displayHeight}px`,
            border: 'none',
            display: 'block',
            overflow: 'hidden',
          }}
          title="HTML content"
        />

        {/* Overflow fade + clickable expand bar at bottom */}
        {isOverflowing && !isExpanded && (
          <>
            <div
              className="absolute bottom-8 left-0 right-0 h-16 pointer-events-none"
              style={{ background: fadeBg }}
            />
            <button
              onClick={() => setIsExpanded(true)}
              className={cn(
                'w-full h-8 flex items-center justify-center gap-1.5',
                'text-xs font-medium',
                'text-muted-foreground hover:text-foreground',
                'bg-muted/50 hover:bg-muted/80',
                'border-t transition-colors cursor-pointer',
              )}
            >
              <Maximize2 className="w-3 h-3" />
              Click to expand
            </button>
          </>
        )}

        {/* Collapse bar when expanded */}
        {isExpanded && (
          <button
            onClick={() => setIsExpanded(false)}
            className={cn(
              'w-full h-8 flex items-center justify-center gap-1.5',
              'text-xs font-medium',
              'text-muted-foreground hover:text-foreground',
              'bg-muted/50 hover:bg-muted/80',
              'border-t transition-colors cursor-pointer',
            )}
          >
            <Minimize2 className="w-3 h-3" />
            Click to collapse
          </button>
        )}
      </div>
    </HtmlBlockErrorBoundary>
  )
}
