/**
 * Node HTTP ↔ Web Standard adapter.
 *
 * Bridges Node.js `(IncomingMessage, ServerResponse)` callbacks to
 * the web-standard `(Request) => Response` handler used by the WebUI.
 * This lets us serve the WebUI from the same HTTPS server that the
 * WsRpcServer creates for WebSocket connections.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { MAX_AUTH_BODY_BYTES, MAX_WEBUI_BODY_BYTES } from './request-limits'
import type { HttpPeerContext } from './proxy-trust'

type WebHandler = (req: Request, peer?: HttpPeerContext) => Promise<Response> | Response

/**
 * Wrap a web-standard fetch handler as a Node HTTP request listener.
 * WebSocket upgrade requests are NOT routed through this adapter —
 * the `ws` library intercepts them at the 'upgrade' event level.
 */
export function nodeHttpAdapter(
  handler: WebHandler,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (nodeReq, nodeRes) => {
    handleRequest(handler, nodeReq, nodeRes).catch((err) => {
      if (nodeRes.writableEnded) return
      console.error('[webui-adapter] Request handling failed')
      if (!nodeRes.headersSent) {
        nodeRes.writeHead(500, { 'Content-Type': 'text/plain' })
      }
      nodeRes.end('Internal Server Error')
    })
  }
}

async function handleRequest(
  handler: WebHandler,
  nodeReq: IncomingMessage,
  nodeRes: ServerResponse,
): Promise<void> {
  // Build web-standard Request from Node IncomingMessage
  const encrypted = !!(nodeReq.socket as any).encrypted
  const protocol = encrypted ? 'https' : 'http'
  const host = nodeReq.headers.host ?? 'localhost'
  const url = `${protocol}://${host}${nodeReq.url ?? '/'}`

  const headers = new Headers()
  const raw = nodeReq.rawHeaders
  for (let i = 0; i < raw.length; i += 2) {
    headers.append(raw[i], raw[i + 1])
  }

  let body: Buffer | null = null
  if (nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD') {
    const chunks: Buffer[] = []
    const path = new URL(url).pathname
    const limit = path.startsWith('/api/auth') || path.startsWith('/api/admin') ? MAX_AUTH_BODY_BYTES : MAX_WEBUI_BODY_BYTES
    let size = 0
    const timeout = setTimeout(() => {
      if (!nodeRes.headersSent) nodeRes.writeHead(408, { Connection: 'close' })
      nodeRes.end('Request body timeout')
      nodeReq.destroy()
    }, 15_000)
    timeout.unref()
    try {
      for await (const chunk of nodeReq) {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        size += bytes.length
        if (size > limit) {
          nodeRes.writeHead(413, { Connection: 'close' })
          nodeRes.end('Request body too large')
          return
        }
        chunks.push(bytes)
      }
    } finally { clearTimeout(timeout) }
    if (nodeRes.writableEnded) return
    body = Buffer.concat(chunks)
  }

  const request = new Request(url, {
    method: nodeReq.method,
    headers,
    body,
  })

  const response = await handler(request, { remoteAddress: nodeReq.socket.remoteAddress })

  // Write web-standard Response back to Node ServerResponse.
  // Headers.forEach iterates each value separately, which correctly
  // handles multi-value headers like Set-Cookie.
  const resHeaders: Record<string, string | string[]> = {}
  response.headers.forEach((value, key) => {
    const existing = resHeaders[key]
    if (existing) {
      resHeaders[key] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value]
    } else {
      resHeaders[key] = value
    }
  })

  nodeRes.writeHead(response.status, resHeaders)

  if (response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    nodeRes.end(buffer)
  } else {
    nodeRes.end()
  }
}
