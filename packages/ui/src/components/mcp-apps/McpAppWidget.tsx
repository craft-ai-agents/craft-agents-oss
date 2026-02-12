/**
 * McpAppWidget - Renders a single MCP Apps widget with AppBridge communication
 *
 * Creates a SandboxedIframe, wires up McpAppsHostBridge for JSON-RPC 2.0 protocol,
 * and handles tool input/output delivery, size changes, and link opening.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { SandboxedIframe, type SandboxedIframeHandle } from './SandboxedIframe'
import { McpAppsHostBridge, type HostContext } from './McpAppsHostBridge'
import { Spinner } from '../ui'
import { cn } from '../../lib/utils'

export interface McpAppWidgetProps {
  html: string
  name: string
  serverId: string
  csp?: { connectDomains?: string[]; resourceDomains?: string[]; baseUriDomains?: string[] }
  props?: Record<string, unknown>
  /** Dev mode: use permissive CSP for the inner iframe */
  dev?: boolean
  toolInput?: Record<string, unknown>
  toolOutput?: unknown
  // Callbacks for host capabilities
  onCallTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>
  onReadResource?: (uri: string) => Promise<unknown>
  onListResources?: () => Promise<{ resources: unknown[] }>
  onSendFollowUp?: (text: string) => void
}

const INIT_TIMEOUT_MS = 15000
const DEFAULT_HEIGHT = 200

export function McpAppWidget({
  html,
  name,
  serverId,
  csp,
  dev,
  toolInput,
  toolOutput,
  onCallTool,
  onReadResource,
  onListResources,
  onSendFollowUp,
}: McpAppWidgetProps) {
  const sandboxRef = useRef<SandboxedIframeHandle>(null)
  const bridgeRef = useRef<McpAppsHostBridge | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [iframeHeight, setIframeHeight] = useState(DEFAULT_HEIGHT)
  const initSentRef = useRef(false)

  // Refs for callback props — the bridge is created once but must always
  // call through the latest callback to avoid stale closures.
  const onCallToolRef = useRef(onCallTool)
  const onReadResourceRef = useRef(onReadResource)
  const onListResourcesRef = useRef(onListResources)
  const onSendFollowUpRef = useRef(onSendFollowUp)

  useEffect(() => {
    onCallToolRef.current = onCallTool
    onReadResourceRef.current = onReadResource
    onListResourcesRef.current = onListResources
    onSendFollowUpRef.current = onSendFollowUp
  }, [onCallTool, onReadResource, onListResources, onSendFollowUp])

  // Create bridge when proxy is ready
  const handleProxyReady = useCallback(() => {
    if (bridgeRef.current) return

    const bridge = new McpAppsHostBridge({
      sendMessage: (data) => sandboxRef.current?.postMessage(data),
      hostInfo: { name: 'Craft Agents', version: '1.0.0' },
      hostContext: {
        theme: { mode: 'dark' },
        displayMode: 'inline',
        platform: 'desktop',
      } satisfies HostContext,
      hostCapabilities: {
        openLinks: {},
        serverTools: onCallToolRef.current ? {} : undefined,
        serverResources: onReadResourceRef.current ? {} : undefined,
        logging: {},
      },
      onCallTool: (...args) => onCallToolRef.current?.(...args),
      onReadResource: (...args) => onReadResourceRef.current?.(...args),
      onListResources: (...args) => onListResourcesRef.current?.(),
      onMessage: (content) => {
        // Widget is sending a message to the conversation
        const params = content as { role?: string; content?: { type: string; text: string } }
        if (params?.content?.text) {
          onSendFollowUpRef.current?.(params.content.text)
        }
      },
      onOpenLink: (url) => {
        // Open link in default browser
        const win = window as { electronAPI?: { openUrl?: (url: string) => void } }
        if (win.electronAPI?.openUrl) {
          win.electronAPI.openUrl(url)
        } else {
          window.open(url, '_blank', 'noopener,noreferrer')
        }
      },
      onSizeChanged: (size) => {
        if (size.height && size.height > 0) {
          setIframeHeight(size.height)
        }
      },
      onInitialized: () => {
        setIsLoading(false)

        // Send tool input and output after widget is initialized
        if (!initSentRef.current) {
          initSentRef.current = true
          if (toolInput) {
            bridge.sendToolInput(toolInput)
          }
          if (toolOutput) {
            bridge.sendToolResult(toolOutput)
          }
        }
      },
    })

    bridgeRef.current = bridge
  }, [])

  // Handle messages from the sandbox
  const handleMessage = useCallback((event: MessageEvent) => {
    bridgeRef.current?.handleMessage(event)
  }, [])

  // Timeout for initialization
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isLoading) {
        setError('Widget failed to initialize')
        setIsLoading(false)
      }
    }, INIT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [isLoading])

  // Cleanup
  useEffect(() => {
    return () => {
      bridgeRef.current?.destroy()
      bridgeRef.current = null
    }
  }, [])

  if (error) {
    return (
      <div className="rounded-lg border border-border/30 overflow-hidden p-3 text-sm text-muted-foreground">
        Failed to load widget: {name}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/30 overflow-hidden">
      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
          <Spinner className="text-[10px]" />
          <span>{name}</span>
        </div>
      )}

      {/* Widget iframe */}
      <SandboxedIframe
        ref={sandboxRef}
        html={html}
        serverId={serverId}
        csp={csp}
        permissive={dev}
        onProxyReady={handleProxyReady}
        onMessage={handleMessage}
        className={cn('w-full', isLoading && 'invisible h-0')}
        style={{
          height: isLoading ? 0 : iframeHeight,
          transition: 'height 300ms ease-out',
        }}
        title={`MCP App: ${name}`}
      />
    </div>
  )
}
