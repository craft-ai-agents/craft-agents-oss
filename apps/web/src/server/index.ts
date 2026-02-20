/**
 * Web server entry point for Craft Agents.
 * Replaces Electron main process with an Express.js + WebSocket server.
 *
 * Run with: bun run src/server/index.ts
 */
import { createServer } from 'http'
import { Broadcaster, setBroadcaster } from './broadcaster.js'
import { serverLog, isDebugMode } from './logger.js'
import { join } from 'path'
import { homedir } from 'os'

const PORT = parseInt(process.env.PORT || '3000', 10)
const HOST = process.env.HOST || '0.0.0.0'

// Set up broadcaster first so the electron mock can use it immediately
const httpServer = createServer()
const broadcaster = new Broadcaster(httpServer)
setBroadcaster(broadcaster)
// Register broadcaster with the electron shim via globalThis
;(globalThis as any).__craftWebBroadcaster = broadcaster

// Now import the Express app (this triggers electron-dependent module loading)
const { createApp } = await import('./app.js')
const app = await createApp()
httpServer.on('request', app)

httpServer.listen(PORT, HOST, () => {
  serverLog.info(`Craft Agents web server running at http://${HOST}:${PORT}`)
  serverLog.info(`Config dir: ${process.env.CRAFT_CONFIG_DIR || join(homedir(), '.craft-agent')}`)
  serverLog.info(`Debug mode: ${isDebugMode}`)
  if (isDebugMode) {
    serverLog.info('Dev mode: Vite frontend at http://localhost:5174')
  }
})

process.on('SIGTERM', () => {
  serverLog.info('Received SIGTERM, shutting down gracefully...')
  httpServer.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  serverLog.info('Received SIGINT, shutting down gracefully...')
  httpServer.close(() => process.exit(0))
})
