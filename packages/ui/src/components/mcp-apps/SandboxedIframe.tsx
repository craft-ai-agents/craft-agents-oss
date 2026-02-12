/**
 * SandboxedIframe - Double-Iframe Sandbox Component for MCP Apps (SEP-1865)
 *
 * Provides secure double-iframe architecture for rendering untrusted HTML:
 * Host Page → Sandbox Proxy (mcp-sandbox:// origin) → Guest UI
 *
 * Adapted for Electron: uses mcp-sandbox://server-{serverId}/proxy.html
 * instead of hostname-swapping, giving each server a unique origin.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

// SECURITY: allow-same-origin is required so the proxy iframe (mcp-sandbox:// origin)
// can relay postMessages between the host and the inner guest iframe. The double-iframe
// design isolates the actual guest UI in a separate inner iframe with its own sandbox
// and CSP, so allow-same-origin on the outer proxy does not grant the guest same-origin.
const IFRAME_SANDBOX_PERMISSIONS = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'

export interface SandboxedIframeHandle {
  postMessage: (data: unknown) => void
  getIframeElement: () => HTMLIFrameElement | null
}

interface SandboxedIframeProps {
  /** HTML content to render in the sandbox */
  html: string | null
  /** Server ID for unique origin isolation */
  serverId: string
  /** Sandbox attribute for the inner iframe */
  sandbox?: string
  /** CSP metadata from resource _meta.ui.csp (SEP-1865) */
  csp?: {
    connectDomains?: string[]
    resourceDomains?: string[]
    frameDomains?: string[]
    baseUriDomains?: string[]
  }
  /** Permissions metadata from resource _meta.ui.permissions (SEP-1865) */
  permissions?: {
    camera?: object
    microphone?: object
    geolocation?: object
    clipboardWrite?: object
  }
  /** Skip CSP injection entirely (for permissive/testing mode) */
  permissive?: boolean
  /** Callback when sandbox proxy is ready */
  onProxyReady?: () => void
  /** Callback for messages from guest UI */
  onMessage: (event: MessageEvent) => void
  /** CSS class for the outer iframe */
  className?: string
  /** Inline styles for the outer iframe */
  style?: React.CSSProperties
  /** Title for accessibility */
  title?: string
}

export const SandboxedIframe = forwardRef<
  SandboxedIframeHandle,
  SandboxedIframeProps
>(function SandboxedIframe(
  {
    html,
    serverId,
    sandbox = IFRAME_SANDBOX_PERMISSIONS,
    csp,
    permissions,
    permissive,
    onProxyReady,
    onMessage,
    className,
    style,
    title = 'MCP App Widget',
  },
  ref
) {
  const outerRef = useRef<HTMLIFrameElement>(null)
  const [proxyReady, setProxyReady] = useState(false)

  // Each server gets a unique origin via mcp-sandbox://server-{serverId}
  const sandboxProxyUrl = `mcp-sandbox://server-${serverId}/proxy.html`

  useImperativeHandle(
    ref,
    () => ({
      postMessage: (data: unknown) => {
        // SECURITY: '*' targetOrigin used because mcp-sandbox://server-{serverId} origins
        // vary per server. TODO: tighten to `mcp-sandbox://server-${serverId}` in a future pass.
        outerRef.current?.contentWindow?.postMessage(data, '*')
      },
      getIframeElement: () => outerRef.current,
    }),
    []
  )

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.source !== outerRef.current?.contentWindow) return

      // Handle sandbox-specific messages
      if (
        event.data?.method === 'ui/notifications/sandbox-proxy-ready' ||
        event.data?.type === 'sandbox-proxy-ready'
      ) {
        setProxyReady(true)
        onProxyReady?.()
        return
      }

      // Forward all other messages to parent handler
      onMessage(event)
    },
    [onProxyReady, onMessage]
  )

  // Listen for messages from proxy
  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  // Send HTML to proxy when ready
  useEffect(() => {
    if (!proxyReady || !html || !outerRef.current?.contentWindow) return

    // SECURITY: '*' targetOrigin — same rationale as postMessage above.
    outerRef.current.contentWindow.postMessage(
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/sandbox-resource-ready',
        params: {
          html,
          sandbox,
          csp,
          permissions,
          permissive,
        },
      },
      '*'
    )
  }, [proxyReady, html, sandbox, csp, permissions, permissive])

  return (
    <iframe
      ref={outerRef}
      src={sandboxProxyUrl}
      className={className}
      style={style}
      title={title}
      sandbox={sandbox}
      allow="web-share"
    />
  )
})
