/**
 * WebSocket broadcaster - replaces Electron's WindowManager.broadcastToAll()
 * Sends events to all connected web clients.
 */
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import type { Server } from 'http'

export interface WsMessage {
  type: string
  payload?: unknown
}

export class Broadcaster {
  private wss: WebSocketServer
  private clients = new Set<WebSocket>()

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' })
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.clients.add(ws)
      ws.on('close', () => this.clients.delete(ws))
      ws.on('error', () => this.clients.delete(ws))
    })
  }

  broadcast(type: string, payload?: unknown): void {
    const msg = JSON.stringify({ type, payload })
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg)
      }
    }
  }

  get clientCount(): number {
    return this.clients.size
  }
}

let _broadcaster: Broadcaster | null = null

export function setBroadcaster(b: Broadcaster): void {
  _broadcaster = b
}

export function getBroadcaster(): Broadcaster {
  if (!_broadcaster) throw new Error('Broadcaster not initialized')
  return _broadcaster
}

export function broadcastToAll(channel: string, payload?: unknown): void {
  _broadcaster?.broadcast(channel, payload)
}
