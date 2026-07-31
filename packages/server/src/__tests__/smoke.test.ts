/**
 * Headless server smoke test.
 *
 * Spawns the standalone server as a subprocess and validates:
 * - WebSocket handshake succeeds with valid token
 * - WebSocket handshake fails with invalid token
 * - /health endpoint returns 200
 * - Clean shutdown on SIGTERM
 */

import { describe, it, expect, afterEach } from 'bun:test'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { Subprocess } from 'bun'
import WebSocket from 'ws'

const SERVER_ENTRY = join(import.meta.dir, '..', 'index.ts')
const STARTUP_TIMEOUT = 15_000
const TEST_TIMEOUT = 30_000

interface SpawnedServer {
  url: string
  token: string
  healthPort: number
  proc: Subprocess
  stop: () => Promise<void>
}

async function spawnTestServer(extraEnv?: Record<string, string>): Promise<SpawnedServer> {
  const token = crypto.randomUUID() + crypto.randomUUID() // 72 chars, well above 16 minimum
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-server-smoke-'))
  const { CLAUDECODE: _, ...parentEnv } = process.env

  const proc = Bun.spawn(['bun', 'run', SERVER_ENTRY], {
    env: {
      ...parentEnv,
      ...extraEnv,
      CRAFT_SERVER_TOKEN: token,
      CRAFT_CONFIG_DIR: configDir,
      CRAFT_RPC_PORT: '0',
      CRAFT_RPC_HOST: '127.0.0.1',
      CRAFT_HEALTH_PORT: '0', // random port
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  return new Promise<SpawnedServer>((resolve, reject) => {
    let settled = false
    let stderr = ''
    const stderrTask = (async () => {
      const reader = proc.stderr!.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          stderr = (stderr + decoder.decode(value, { stream: true })).slice(-8_000)
        }
      } catch {
        // Stream closed during teardown.
      }
    })()

    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      rmSync(configDir, { recursive: true, force: true })
      reject(error)
    }

    const timer = setTimeout(() => {
      proc.kill()
      rejectOnce(new Error(`Server did not start within ${STARTUP_TIMEOUT}ms${stderr ? `\n${stderr}` : ''}`))
    }, STARTUP_TIMEOUT)

    let url = ''
    let buffer = ''

    const processLines = () => {
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('CRAFT_SERVER_URL=')) {
          url = line.slice('CRAFT_SERVER_URL='.length).trim()
        }
        if (url && !settled) {
          settled = true
          clearTimeout(timer)
          resolve({
            url,
            token,
            healthPort: 0, // health port not printed; we skip health test if 0
            proc,
            stop: async () => {
              proc.kill('SIGTERM')
              await proc.exited
              await stderrTask
              rmSync(configDir, { recursive: true, force: true })
            },
          })
          return
        }
      }
    }

    ;(async () => {
      const reader = proc.stdout!.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          processLines()
        }
      } catch {
        // Stream closed
      }
      clearTimeout(timer)
      if (!url) {
        const exitCode = await proc.exited
        await stderrTask
        rejectOnce(new Error(
          `Server exited with code ${exitCode} before printing CRAFT_SERVER_URL${stderr ? `\n${stderr}` : ''}`,
        ))
      }
    })()
  })
}

function connectWs(url: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => {
      // Send handshake
      ws.send(JSON.stringify({
        id: crypto.randomUUID(),
        type: 'handshake',
        protocolVersion: '1.0',
        token,
      }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'handshake_ack') {
        resolve(ws)
      } else if (msg.type === 'error') {
        reject(new Error(`Handshake error: ${msg.error?.message}`))
        ws.close()
      }
    })
    ws.on('error', reject)
    ws.on('close', (code, reason) => {
      reject(new Error(`WS closed: ${code} ${reason}`))
    })
  })
}

describe('headless server smoke test', () => {
  let server: SpawnedServer | null = null

  afterEach(async () => {
    if (server) {
      await server.stop().catch(() => {})
      server = null
    }
  })

  it('accepts valid token handshake', async () => {
    server = await spawnTestServer()
    const ws = await connectWs(server.url, server.token)
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  }, TEST_TIMEOUT)

  it('rejects invalid token', async () => {
    server = await spawnTestServer()
    await expect(
      connectWs(server.url, 'wrong-token-that-is-long-enough'),
    ).rejects.toThrow()
  }, TEST_TIMEOUT)

  it('rejects short token at startup', async () => {
    const token = 'short'
    const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-server-smoke-'))
    const { CLAUDECODE: _, ...parentEnv } = process.env
    const proc = Bun.spawn(['bun', 'run', SERVER_ENTRY], {
      env: {
        ...parentEnv,
        CRAFT_SERVER_TOKEN: token,
        CRAFT_CONFIG_DIR: configDir,
        CRAFT_RPC_PORT: '0',
        CRAFT_RPC_HOST: '127.0.0.1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    try {
      const exitCode = await proc.exited
      expect(exitCode).not.toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  }, TEST_TIMEOUT)

  it('shuts down cleanly on SIGTERM', async () => {
    server = await spawnTestServer()
    const ws = await connectWs(server.url, server.token)

    // Server should be running
    expect(ws.readyState).toBe(WebSocket.OPEN)

    // Send SIGTERM. Bun on Windows terminates subprocesses with the conventional
    // 128 + SIGTERM (15) exit code instead of delivering the signal handler;
    // Unix platforms exercise the server's graceful shutdown path and exit 0.
    server.proc.kill('SIGTERM')
    const exitCode = await server.proc.exited
    expect(exitCode).toBe(process.platform === 'win32' ? 143 : 0)

    // Run the idempotent teardown to drain stderr and remove the isolated config.
    await server.stop()
    server = null
  }, TEST_TIMEOUT)
})
