/**
 * McpAppsHostBridge - Host-side JSON-RPC 2.0 handler for MCP Apps protocol (SEP-1865)
 *
 * Handles communication between the host application and widget iframes
 * via the SandboxedIframe's postMessage relay.
 */

export interface HostContext {
  theme?: {
    mode?: 'light' | 'dark'
  }
  displayMode?: 'inline' | 'pip' | 'fullscreen'
  platform?: 'web' | 'desktop' | 'mobile'
  locale?: string
  timeZone?: string
}

export interface McpAppsHostBridgeOptions {
  /** Send a message to the widget iframe via SandboxedIframe ref */
  sendMessage: (data: unknown) => void
  /** Host application info */
  hostInfo: { name: string; version: string }
  /** Initial host context */
  hostContext: HostContext
  /** Host capabilities advertised to the widget */
  hostCapabilities: {
    openLinks?: object
    serverTools?: object
    serverResources?: object
    logging?: object
  }
  // Handler callbacks
  onCallTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>
  onReadResource?: (uri: string) => Promise<unknown>
  onListResources?: () => Promise<{ resources: unknown[] }>
  onMessage?: (content: unknown) => void
  onOpenLink?: (url: string) => void
  onRequestDisplayMode?: (mode: string) => { mode: string }
  onSizeChanged?: (size: { width?: number; height?: number }) => void
  onInitialized?: () => void
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export class McpAppsHostBridge {
  private options: McpAppsHostBridgeOptions

  constructor(options: McpAppsHostBridgeOptions) {
    this.options = options
  }

  /**
   * Handle an incoming message from the widget iframe.
   * Route to the appropriate handler based on the JSON-RPC method.
   */
  handleMessage(event: MessageEvent): void {
    const data = event.data
    if (!data || data.jsonrpc !== '2.0') return

    // Handle requests (have an id, expect a response)
    if ('id' in data && 'method' in data) {
      this.handleRequest(data as JsonRpcRequest)
      return
    }

    // Handle notifications (no id, no response needed)
    if ('method' in data && !('id' in data)) {
      this.handleNotification(data as JsonRpcNotification)
      return
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    try {
      let result: unknown

      switch (request.method) {
        case 'ui/initialize':
          result = {
            protocolVersion: '2025-03-26',
            hostInfo: this.options.hostInfo,
            hostContext: this.options.hostContext,
            hostCapabilities: this.options.hostCapabilities,
          }
          break

        case 'tools/call': {
          const params = request.params as { name: string; arguments: Record<string, unknown> }
          if (this.options.onCallTool) {
            result = await this.options.onCallTool(params.name, params.arguments || {})
          } else {
            this.sendError(request.id, -32601, 'Tool calls not supported')
            return
          }
          break
        }

        case 'resources/read': {
          const params = request.params as { uri: string }
          if (this.options.onReadResource) {
            result = await this.options.onReadResource(params.uri)
          } else {
            this.sendError(request.id, -32601, 'Resource reading not supported')
            return
          }
          break
        }

        case 'resources/list': {
          if (this.options.onListResources) {
            result = await this.options.onListResources()
          } else {
            this.sendError(request.id, -32601, 'Resource listing not supported')
            return
          }
          break
        }

        case 'ui/message': {
          this.options.onMessage?.(request.params)
          result = {}
          break
        }

        case 'ui/open-link': {
          const params = request.params as { url: string }
          this.options.onOpenLink?.(params.url)
          result = {}
          break
        }

        case 'ui/request-display-mode': {
          const params = request.params as { mode: string }
          if (this.options.onRequestDisplayMode) {
            result = this.options.onRequestDisplayMode(params.mode)
          } else {
            result = { mode: 'inline' }
          }
          break
        }

        default:
          this.sendError(request.id, -32601, `Method not found: ${request.method}`)
          return
      }

      this.sendResponse(request.id, result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error'
      this.sendError(request.id, -32603, message)
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    switch (notification.method) {
      case 'ui/notifications/size-changed': {
        const params = notification.params as { width?: number; height?: number }
        this.options.onSizeChanged?.(params)
        break
      }

      case 'ui/notifications/initialized':
        this.options.onInitialized?.()
        break

      case 'notifications/message':
        // Console log forwarding from widget - just log it
        break

      default:
        break
    }
  }

  private sendResponse(id: number | string, result: unknown): void {
    this.options.sendMessage({
      jsonrpc: '2.0',
      id,
      result: result ?? {},
    })
  }

  private sendError(id: number | string, code: number, message: string): void {
    this.options.sendMessage({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    })
  }

  /** Send tool input notification to widget */
  sendToolInput(args: Record<string, unknown>): void {
    this.options.sendMessage({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-input',
      params: { arguments: args },
    })
  }

  /** Send tool result notification to widget */
  sendToolResult(result: unknown): void {
    // If result is an object with content array, send directly
    // Otherwise wrap in structuredContent
    const params = (result && typeof result === 'object' && 'content' in (result as Record<string, unknown>))
      ? result
      : { structuredContent: result }
    this.options.sendMessage({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params,
    })
  }

  /** Update host context and notify widget */
  setHostContext(context: Partial<HostContext>): void {
    this.options.hostContext = { ...this.options.hostContext, ...context }
    this.options.sendMessage({
      jsonrpc: '2.0',
      method: 'ui/notifications/host-context-changed',
      params: context,
    })
  }

  /** Cleanup */
  destroy(): void {
    // No persistent state to clean up
  }
}
