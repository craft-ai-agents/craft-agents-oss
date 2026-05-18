import { describe, expect, it } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateStdioMcpConnection } from '../validation.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = (name: string) => join(HERE, 'fixtures', name)

describe('validateStdioMcpConnection', () => {
  it(
    'returns success and tool list for a spec-compliant stdio server',
    async () => {
      const result = await validateStdioMcpConnection({
        command: 'node',
        args: [FIXTURE('mcp-server-good.mjs')],
        timeout: 8000,
      })
      expect(result.success).toBe(true)
      expect(result.tools).toEqual(['echo'])
      expect(result.error).toBeUndefined()
    },
    15000,
  )

  it(
    'surfaces a framing hint when the server uses LSP-style Content-Length framing',
    async () => {
      const result = await validateStdioMcpConnection({
        command: 'node',
        args: [FIXTURE('mcp-server-lsp.mjs')],
        // Generous outer budget — the connect phase should fail well before this
        // either via timeout or via parse error → "Connection closed".
        timeout: 12000,
      })
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      // Specific framing diagnostic surfaced for any connect-phase failure.
      expect(result.error!).toContain('newline-delimited JSON-RPC')
      // Stderr surfaces in the error message.
      expect(result.error!).toContain('LSP-style framing')
      // The idle copy fires here because the SDK's stdio reader silently
      // skips lines that aren't valid JSON (the `Content-Length: …` header),
      // so connect never rejects on its own — the idle watchdog stops the wait.
      expect(result.error!).toContain('stderr silence')
    },
    // Generous outer budget — Bun's setTimeout can lag under test load, so
    // even though idleMs=6000 the wall-clock can stretch to 20+ seconds.
    45000,
  )

  it(
    'succeeds on a slow cold-start server that emits stderr activity throughout init',
    async () => {
      const result = await validateStdioMcpConnection({
        command: 'node',
        args: [FIXTURE('mcp-server-slow.mjs')],
        // Generous outer budget: the slow fixture takes ~12s of stderr noise
        // before it starts speaking MCP. The idle watchdog (default 8s) must
        // be reset by each stderr line, otherwise this test fails.
        timeout: 60000,
      })
      expect(result.success).toBe(true)
      expect(result.tools).toEqual(['ping'])
      expect(result.error).toBeUndefined()
    },
    60000,
  )

  it(
    'fails at the ceiling when a server floods stderr but never completes initialize',
    async () => {
      const result = await validateStdioMcpConnection({
        command: 'node',
        args: [FIXTURE('mcp-server-noisy-stuck.mjs')],
        // Use a short outer budget so the ceiling fires quickly. With
        // timeout=10000: connectIdleMs=5000, connectCeilingMs=8000.
        timeout: 10000,
      })
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      // "Stuck in startup" copy is distinct from the idle/framing copy.
      expect(result.error!).toContain('never completed the `initialize` handshake')
      expect(result.error!).toContain('package installer or build step')
    },
    // Generous outer budget — Bun's setTimeout can lag under test load
    // (observed up to 4x expected on this machine), so we leave plenty of
    // slack on top of the 8s ceiling.
    60000,
  )

  it(
    'returns a clean "command not found" message for ENOENT',
    async () => {
      const result = await validateStdioMcpConnection({
        command: '/definitely/not/a/real/command-xyzzy',
        args: [],
        timeout: 3000,
      })
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!).toContain('Command not found')
      expect(result.error!).toContain('command-xyzzy')
    },
    10000,
  )

  it(
    'surfaces stderr output when the server exits immediately',
    async () => {
      const result = await validateStdioMcpConnection({
        command: 'node',
        args: ['-e', "process.stderr.write('boom from test server\\n'); process.exit(1);"],
        timeout: 5000,
      })
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!.toLowerCase()).toContain('boom from test server')
    },
    15000,
  )
})
