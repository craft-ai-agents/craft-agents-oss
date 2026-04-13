/**
 * Task 3: StdioAcpTransport
 *
 * Tests that StdioAcpTransport correctly exchanges JSON-RPC 2.0 messages
 * with a real child process over stdio. Uses a minimal Node.js echo script
 * written inline to avoid external fixtures.
 *
 * All tests spawn real child processes — that's the point.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { StdioAcpTransport } from '../src/agent/acp-transport'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Minimal ACP echo server (written to a tmp file and spawned by tests)
// ---------------------------------------------------------------------------

const ECHO_SERVER_SRC = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
let id = 1;

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if ('method' in msg && 'id' in msg) {
      // Request — echo back as result
      const resp = JSON.stringify({ jsonrpc: '2.0', result: { echo: msg.method, params: msg.params }, id: msg.id });
      process.stdout.write(resp + '\\n');
    }
    // Notifications are ignored (no response)
  } catch (_) {}
});
`;

const NOTIFY_SERVER_SRC = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });

// After 20ms, send a notification to client
setTimeout(() => {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { status: 'running' } }) + '\\n');
}, 20);

rl.on('line', () => {}); // keep alive
`;

const REQUEST_SERVER_SRC = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });

// After 20ms, send a request to the client (client must respond)
setTimeout(() => {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'fs/readFile', params: { path: '/test' }, id: 'srv-1' }) + '\\n');
}, 20);

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if ('result' in msg || 'error' in msg) {
      // Got client response — send a notification confirming it
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'callback_received', params: msg }) + '\\n');
    }
  } catch (_) {}
});
`;

function writeTmp(name: string, src: string): string {
  const p = join(tmpdir(), name)
  writeFileSync(p, src)
  return p
}

describe('StdioAcpTransport — sendRequest', () => {
  it('sends a JSON-RPC request and receives the echo response', async () => {
    const serverPath = writeTmp('acp-echo-server.js', ECHO_SERVER_SRC)
    const transport = new StdioAcpTransport(['node', serverPath])

    const result = await transport.sendRequest('ping', { hello: 'world' }) as any
    expect(result.echo).toBe('ping')
    expect(result.params).toEqual({ hello: 'world' })

    await transport.dispose()
    unlinkSync(serverPath)
  }, 5000)
})

describe('StdioAcpTransport — onNotification', () => {
  it('receives a notification sent by the server process', async () => {
    const serverPath = writeTmp('acp-notify-server.js', NOTIFY_SERVER_SRC)
    const transport = new StdioAcpTransport(['node', serverPath])

    const received: Array<{ method: string; params: unknown }> = []
    transport.onNotification((method, params) => {
      received.push({ method, params })
    })

    // Wait for server to send notification (it fires after 20ms)
    await new Promise(r => setTimeout(r, 100))

    expect(received).toHaveLength(1)
    expect(received[0]!.method).toBe('session/update')
    expect((received[0]!.params as any).status).toBe('running')

    await transport.dispose()
    unlinkSync(serverPath)
  }, 5000)
})

describe('StdioAcpTransport — onRequest (server → client)', () => {
  it('handles a request from the server and sends the response back', async () => {
    const serverPath = writeTmp('acp-request-server.js', REQUEST_SERVER_SRC)
    const transport = new StdioAcpTransport(['node', serverPath])

    transport.onRequest(async (method, params, id) => {
      expect(method).toBe('fs/readFile')
      return { content: 'file content', path: (params as any).path }
    })

    const callbackNotifications: unknown[] = []
    transport.onNotification((method, params) => {
      if (method === 'callback_received') callbackNotifications.push(params)
    })

    // Server sends a request after 20ms; wait for it to be processed
    await new Promise(r => setTimeout(r, 200))

    expect(callbackNotifications).toHaveLength(1)
    const cb = callbackNotifications[0] as any
    expect(cb.result.content).toBe('file content')

    await transport.dispose()
    unlinkSync(serverPath)
  }, 5000)
})

describe('StdioAcpTransport — dispose', () => {
  it('dispose terminates the process and resolves', async () => {
    const serverPath = writeTmp('acp-echo-server2.js', ECHO_SERVER_SRC)
    const transport = new StdioAcpTransport(['node', serverPath])

    await transport.dispose()
    // Second dispose should be safe (idempotent)
    await expect(transport.dispose()).resolves.toBeUndefined()

    unlinkSync(serverPath)
  }, 5000)

  it('rejects pending requests when disposed', async () => {
    // Server that never responds
    const HANGING_SERVER = `const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', () => {}); // swallow everything
`
    const serverPath = writeTmp('acp-hanging-server.js', HANGING_SERVER)
    const transport = new StdioAcpTransport(['node', serverPath])

    const requestPromise = transport.sendRequest('nothing')
    requestPromise.catch(() => {}) // prevent unhandled rejection while dispose() runs
    await transport.dispose()

    await expect(requestPromise).rejects.toThrow()
    unlinkSync(serverPath)
  }, 5000)
})
