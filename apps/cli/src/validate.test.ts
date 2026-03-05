import { describe, it, expect, afterEach } from 'bun:test'
import { CliRpcClient } from './client.ts'
import { runValidation } from './index.ts'
import {
  serializeEnvelope,
  deserializeEnvelope,
} from '@craft-agent/server-core/transport'

// ---------------------------------------------------------------------------
// Mock server that handles validation channels
// ---------------------------------------------------------------------------

interface ValidationServer {
  url: string
  close: () => void
  failChannel?: string
}

/** Push a sequence of session events over ws with a small delay. */
function pushSessionEvents(
  ws: any,
  sessionId: string,
  events: Array<Record<string, unknown>>,
): void {
  setTimeout(() => {
    for (const ev of events) {
      ws.send(serializeEnvelope({
        id: crypto.randomUUID(),
        type: 'event',
        channel: 'session:event',
        args: [{ sessionId, ...ev }],
      }))
    }
  }, 10)
}

function createValidationServer(opts?: { failChannel?: string }): ValidationServer {
  let sendCount = 0

  const server = Bun.serve({
    port: 0,
    fetch(req, svr) {
      if (svr.upgrade(req)) return undefined
      return new Response('Not found', { status: 404 })
    },
    websocket: {
      message(ws, message) {
        const raw = typeof message === 'string' ? message : new TextDecoder().decode(message)
        const envelope = deserializeEnvelope(raw)

        if (envelope.type === 'handshake') {
          ws.send(serializeEnvelope({
            id: crypto.randomUUID(),
            type: 'handshake_ack',
            clientId: 'validate-test-client',
            protocolVersion: '1.0',
          }))
          return
        }

        if (envelope.type === 'request') {
          if (opts?.failChannel && envelope.channel === opts.failChannel) {
            ws.send(serializeEnvelope({
              id: envelope.id,
              type: 'response',
              channel: envelope.channel,
              error: { code: 'HANDLER_ERROR', message: `Simulated failure: ${envelope.channel}` },
            }))
            return
          }

          let result: unknown
          switch (envelope.channel) {
            case 'credentials:healthCheck':
              result = { ok: true }
              break
            case 'system:versions':
              result = { node: '22.12.0', bun: '1.2.0' }
              break
            case 'system:homeDir':
              result = '/home/test'
              break
            case 'workspaces:get':
              result = [{ id: 'ws-1', name: 'Test Workspace', path: '/tmp/ws1' }]
              break
            case 'window:switchWorkspace':
              result = { ok: true }
              break
            case 'sessions:get':
              result = [
                { id: 's1', name: 'Session 1', preview: 'Hello', isProcessing: false },
                { id: 's2', name: 'Session 2', preview: 'World', isProcessing: true },
              ]
              break
            case 'LLM_Connection:list':
              result = [{ slug: 'anthropic', name: 'Anthropic' }]
              break
            case 'sources:get':
              result = [{ slug: 'github', name: 'GitHub' }]
              break
            case 'sessions:create':
              result = { id: '__cli-validate-test', name: (envelope.args?.[1] as any)?.name ?? 'test' }
              break
            case 'sessions:getMessages':
              result = []
              break
            case 'sessions:command':
              // setSources, etc. — just acknowledge
              result = { ok: true }
              break
            case 'sources:create':
              result = { slug: 'cat-facts', name: 'Cat Facts', type: 'api' }
              break
            case 'sources:delete':
              result = { deleted: true }
              break
            case 'skills:get':
              result = [{ slug: '__cli-validate-skill', name: 'CLI Validate Skill' }]
              break
            case 'skills:delete':
              result = { deleted: true }
              break
            case 'sessions:sendMessage': {
              // Respond immediately
              ws.send(serializeEnvelope({
                id: envelope.id,
                type: 'response',
                channel: envelope.channel,
                result: { started: true },
              }))

              sendCount++
              const sessionId = envelope.args?.[0] as string ?? '__cli-validate-test'

              // Route based on send order:
              // 1: stream test (text only)
              // 2: tool test (tool_start + tool_result)
              // 3: source mention (text only)
              // 4: skill create (tool — writes file)
              // 5: skill mention (text only)
              switch (sendCount) {
                case 1: // stream test
                  pushSessionEvents(ws, sessionId, [
                    { type: 'text_delta', delta: 'VALIDATION' },
                    { type: 'text_delta', delta: '_OK' },
                    { type: 'complete' },
                  ])
                  break
                case 2: // tool test
                  pushSessionEvents(ws, sessionId, [
                    { type: 'text_delta', delta: 'Running...' },
                    { type: 'tool_start', toolName: 'Bash', toolIntent: 'echo TOOL_VALIDATION_OK' },
                    { type: 'tool_result', result: 'TOOL_VALIDATION_OK' },
                    { type: 'text_delta', delta: 'Done.' },
                    { type: 'complete' },
                  ])
                  break
                case 3: // source mention — text response with cat fact
                  pushSessionEvents(ws, sessionId, [
                    { type: 'text_delta', delta: 'Here is a cat fact: cats sleep 16 hours a day.' },
                    { type: 'complete' },
                  ])
                  break
                case 4: // skill create — tool use (Bash tool for mkdir+cat)
                  pushSessionEvents(ws, sessionId, [
                    { type: 'text_delta', delta: 'Creating skill...' },
                    { type: 'tool_start', toolName: 'Bash', toolIntent: 'mkdir -p && cat > SKILL.md' },
                    { type: 'tool_result', result: '' },
                    { type: 'text_delta', delta: 'Skill created.' },
                    { type: 'complete' },
                  ])
                  break
                default: // skill mention and any further sends — text response
                  pushSessionEvents(ws, sessionId, [
                    { type: 'text_delta', delta: 'Skill executed.' },
                    { type: 'complete' },
                  ])
                  break
              }
              return
            }
            case 'sessions:delete':
              result = { deleted: true }
              break
            default:
              result = envelope.args
          }

          ws.send(serializeEnvelope({
            id: envelope.id,
            type: 'response',
            channel: envelope.channel,
            result,
          }))
        }
      },
    },
  })

  return {
    url: `ws://127.0.0.1:${server.port}`,
    close: () => server.stop(true),
    failChannel: opts?.failChannel,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureStdout() {
  const chunks: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: any) => { chunks.push(String(chunk)); return true }) as any
  return { chunks, restore: () => { process.stdout.write = orig } }
}

function captureStderr() {
  const chunks: string[] = []
  const orig = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: any) => { chunks.push(String(chunk)); return true }) as any
  return { chunks, restore: () => { process.stderr.write = orig } }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 21

let server: ValidationServer | null = null

afterEach(() => {
  server?.close()
  server = null
})

describe('runValidation', () => {
  it('all steps pass → returns 0', async () => {
    server = createValidationServer()
    const client = new CliRpcClient(server.url, { requestTimeout: 5000 })
    const out = captureStdout()

    try {
      const code = await runValidation(client, false)
      expect(code).toBe(0)
      expect(out.chunks.join('')).toContain(`${TOTAL_STEPS}/${TOTAL_STEPS} passed`)
    } finally {
      out.restore()
    }
  })

  it('step failure → returns 1, still runs remaining', async () => {
    server = createValidationServer({ failChannel: 'system:versions' })
    const client = new CliRpcClient(server.url, { requestTimeout: 5000 })
    const out = captureStdout()
    const err = captureStderr()

    try {
      const code = await runValidation(client, false)
      expect(code).toBe(1)
      const output = out.chunks.join('')
      expect(output).toContain(`${TOTAL_STEPS - 1}/${TOTAL_STEPS} passed`)
      expect(output).toContain('1 failed')
      expect(err.chunks.join('')).toContain('✗')
      expect(err.chunks.join('')).toContain('system:versions')
    } finally {
      out.restore()
      err.restore()
    }
  })

  it('JSON mode outputs structured result', async () => {
    server = createValidationServer()
    const client = new CliRpcClient(server.url, { requestTimeout: 5000 })
    const out = captureStdout()

    try {
      const code = await runValidation(client, true)
      expect(code).toBe(0)
      const result = JSON.parse(out.chunks.join(''))
      expect(result.total).toBe(TOTAL_STEPS)
      expect(result.passed).toBe(TOTAL_STEPS)
      expect(result.failed).toBe(0)
      expect(result.results).toHaveLength(TOTAL_STEPS)
      expect(result.results[0].status).toBe('OK')
    } finally {
      out.restore()
    }
  })

  it('cleanup runs even if intermediate step fails', async () => {
    server = createValidationServer({ failChannel: 'sessions:getMessages' })
    const client = new CliRpcClient(server.url, { requestTimeout: 5000 })
    const out = captureStdout()
    const err = captureStderr()

    try {
      const code = await runValidation(client, false)
      expect(code).toBe(1)
      const output = out.chunks.join('')
      expect(output).toContain('sessions:delete')
      expect(output).toContain('deleted session:')
    } finally {
      out.restore()
      err.restore()
    }
  })

  it(`each step has proper [N/${TOTAL_STEPS}] format in output`, async () => {
    server = createValidationServer()
    const client = new CliRpcClient(server.url, { requestTimeout: 5000 })
    const out = captureStdout()

    try {
      await runValidation(client, false)
      const output = out.chunks.join('')
      for (let i = 1; i <= TOTAL_STEPS; i++) {
        expect(output).toContain(`[${i}/${TOTAL_STEPS}]`)
      }
    } finally {
      out.restore()
    }
  })

  it('stream step receives text_delta events', async () => {
    server = createValidationServer()
    const client = new CliRpcClient(server.url, { requestTimeout: 5000 })
    const out = captureStdout()

    try {
      await runValidation(client, true)
      const result = JSON.parse(out.chunks.join(''))
      const step = result.results.find((r: any) => r.step === 'send message + stream')
      expect(step).toBeDefined()
      expect(step.status).toBe('OK')
      expect(step.detail).toContain('text deltas')
    } finally {
      out.restore()
    }
  })

  it('tool step receives tool_start + tool_result events', async () => {
    server = createValidationServer()
    const client = new CliRpcClient(server.url, { requestTimeout: 5000 })
    const out = captureStdout()

    try {
      await runValidation(client, true)
      const result = JSON.parse(out.chunks.join(''))
      const step = result.results.find((r: any) => r.step === 'send message + tool use')
      expect(step).toBeDefined()
      expect(step.status).toBe('OK')
      expect(step.detail).toContain('tool=Bash')
    } finally {
      out.restore()
    }
  })

  it('source lifecycle steps pass', async () => {
    server = createValidationServer()
    const client = new CliRpcClient(server.url, { requestTimeout: 5000 })
    const out = captureStdout()

    try {
      await runValidation(client, true)
      const result = JSON.parse(out.chunks.join(''))
      const create = result.results.find((r: any) => r.step === 'sources:create')
      expect(create.status).toBe('OK')
      expect(create.detail).toContain('slug=cat-facts')

      const mention = result.results.find((r: any) => r.step === 'send + source mention')
      expect(mention.status).toBe('OK')
      expect(mention.detail).toContain('text deltas')

      const del = result.results.find((r: any) => r.step === 'sources:delete')
      expect(del.status).toBe('OK')
      expect(del.detail).toContain('deleted source:')
    } finally {
      out.restore()
    }
  })

  it('skill lifecycle steps pass', async () => {
    server = createValidationServer()
    const client = new CliRpcClient(server.url, { requestTimeout: 5000 })
    const out = captureStdout()

    try {
      await runValidation(client, true)
      const result = JSON.parse(out.chunks.join(''))
      const create = result.results.find((r: any) => r.step === 'send + skill create')
      expect(create.status).toBe('OK')
      expect(create.detail).toContain('tool=Bash')

      const verify = result.results.find((r: any) => r.step === 'skills:get (verify)')
      expect(verify.status).toBe('OK')
      expect(verify.detail).toContain('CLI Validate Skill')

      const mention = result.results.find((r: any) => r.step === 'send + skill mention')
      expect(mention.status).toBe('OK')
      expect(mention.detail).toContain('text deltas')

      const del = result.results.find((r: any) => r.step === 'skills:delete')
      expect(del.status).toBe('OK')
      expect(del.detail).toContain('deleted skill:')
    } finally {
      out.restore()
    }
  })
})
