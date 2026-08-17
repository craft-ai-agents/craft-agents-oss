/**
 * Craft Pages — dedicated HTTP listener.
 *
 * Its own `node:http` server, NEVER the RPC/WebSocket one. `WsRpcServer`
 * attaches its WebSocketServer to the same http server it serves from
 * (transport/server.ts:293-297) and performs no `Origin` check on upgrade while
 * accepting a bearer token OR a session cookie — so page JS sharing that origin
 * could upgrade a socket carrying the HttpOnly session cookie and obtain full
 * RPC access (ADR 0001 D1).
 *
 * Binds loopback only. Binding 0.0.0.0 would trigger a Windows inbound-firewall
 * elevation prompt that a non-technical user cannot answer, and that path stays
 * exclusively behind the existing embedded-server setting.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { createPagesHandler, type PagesHandlerOptions } from './handler.ts'

export interface PagesServerOptions extends Omit<PagesHandlerOptions, 'getPort'> {
  /** Preferred port. 0 picks an ephemeral one (tests). */
  port?: number
  /** How many consecutive ports to try when the preferred one is taken. */
  maxAttempts?: number
}

export interface RunningPagesServer {
  port: number
  origin: string
  urlForPage: (pageId: string) => string
  close: () => Promise<void>
}

/** Hard cap on a buffered request body at the transport layer. */
const MAX_ADAPTER_BODY_BYTES = 256 * 1024

/** Bridge a web-standard handler onto node:http. */
async function nodeAdapter(
  handler: (req: Request) => Promise<Response>,
  nodeReq: IncomingMessage,
  nodeRes: ServerResponse,
): Promise<void> {
  const host = nodeReq.headers.host ?? '127.0.0.1'
  // The bridge is a POST, so the body genuinely has to be forwarded. It is read
  // with a hard cap here as well as in the bridge: this layer must not buffer an
  // unbounded upload just to hand it on to something that will reject it.
  let body: string | undefined
  const method = (nodeReq.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    for await (const chunk of nodeReq) {
      size += (chunk as Buffer).length
      if (size > MAX_ADAPTER_BODY_BYTES) { tooLarge = true; break }
      chunks.push(chunk as Buffer)
    }
    if (tooLarge) {
      nodeRes.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      nodeRes.end(JSON.stringify({ error: 'payload_too_large' }))
      return
    }
    body = Buffer.concat(chunks).toString('utf-8')
  }

  const request = new Request(`http://${host}${nodeReq.url ?? '/'}`, {
    method: nodeReq.method,
    headers: nodeReq.headers as Record<string, string>,
    ...(body !== undefined && body.length > 0 ? { body } : {}),
  })

  let response: Response
  try {
    response = await handler(request)
  } catch {
    nodeRes.writeHead(500, { 'Content-Type': 'text/plain' })
    nodeRes.end('Internal Error')
    return
  }

  const headers: Record<string, string> = {}
  response.headers.forEach((v, k) => { headers[k] = v })
  nodeRes.writeHead(response.status, headers)
  const buf = Buffer.from(await response.arrayBuffer())
  nodeRes.end(buf)
}

function listenOn(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => { server.removeListener('listening', onOk); reject(err) }
    const onOk = () => {
      server.removeListener('error', onError)
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : port)
    }
    server.once('error', onError)
    server.once('listening', onOk)
    server.listen(port, '127.0.0.1')
  })
}

export async function startPagesServer(opts: PagesServerOptions): Promise<RunningPagesServer> {
  let boundPort = 0
  const handler = createPagesHandler({ ...opts, getPort: () => boundPort })
  // nodeAdapter forwards the body for POST /internal/query.
  const server = createServer((req, res) => { void nodeAdapter(handler, req, res) })

  const preferred = opts.port ?? 0
  const maxAttempts = opts.maxAttempts ?? 20

  // Fall forward on EADDRINUSE so a port taken by something else degrades to a
  // different port rather than to no pages at all. The chosen port is persisted
  // by the caller; it is "normally stable", never guaranteed — which is why a
  // port-bearing URL is never the user-facing identity of a page.
  let lastErr: unknown = null
  for (let i = 0; i < (preferred === 0 ? 1 : maxAttempts); i++) {
    try {
      boundPort = await listenOn(server, preferred === 0 ? 0 : preferred + i)
      lastErr = null
      break
    } catch (err) {
      lastErr = err
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') break
    }
  }
  if (lastErr) throw lastErr

  const origin = `http://127.0.0.1:${boundPort}`
  opts.logger?.info(`[pages] listening on ${origin}`)

  return {
    port: boundPort,
    origin,
    urlForPage: (pageId: string) => `${origin}/w/${encodeURIComponent(pageId)}`,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()) }),
  }
}
