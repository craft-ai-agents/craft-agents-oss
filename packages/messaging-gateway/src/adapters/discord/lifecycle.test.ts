/**
 * Tests for the Discord adapter send lifecycle + event translation.
 *
 * We spawn a tiny fake worker via a generated .mjs script that speaks the
 * NDJSON protocol on stdin/stdout. This exercises the real subprocess
 * plumbing (`proc.on('exit')`, `drainPending`, pending timeouts) without
 * touching discord.js or the network.
 *
 * `sendTimeoutMs` is injected via config so we don't wait 30s per test.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DiscordAdapter, type DiscordConfig } from './index'
import type { IncomingMessage, ButtonPress } from '../../types'

const cleanups: Array<() => void> = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'discord-adapter-test-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function writeWorker(body: string): string {
  const dir = makeTmpDir()
  const path = join(dir, 'fake-worker.mjs')
  writeFileSync(path, body)
  return path
}

async function makeAdapter(opts: { workerScript: string; sendTimeoutMs?: number }): Promise<DiscordAdapter> {
  const adapter = new DiscordAdapter()
  const cfg: DiscordConfig = {
    token: 'fake-token',
    workerEntry: opts.workerScript,
    nodeBin: process.execPath,
    sendTimeoutMs: opts.sendTimeoutMs,
  }
  await adapter.initialize(cfg)
  return adapter
}

afterEach(() => {
  for (const c of cleanups.splice(0)) {
    try { c() } catch { /* best-effort */ }
  }
})

// A worker that reads stdin and does nothing (never acknowledges).
const SILENT = `
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', () => {})
  setInterval(() => {}, 60_000)
`

// A worker that exits as soon as it sees any NDJSON line.
const DIE_ON_COMMAND = `
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => {
    buf += c
    if (buf.includes('\\n')) process.exit(1)
  })
  setInterval(() => {}, 60_000)
`

describe('DiscordAdapter send lifecycle', () => {
  it('times out a pending send when the worker never responds', async () => {
    const adapter = await makeAdapter({ workerScript: writeWorker(SILENT), sendTimeoutMs: 200 })
    try {
      await expect(adapter.sendText('chan-1', 'hello')).rejects.toThrow(/send timed out after 200ms/)
    } finally {
      await adapter.destroy()
    }
  })

  it('drains pending sends when the worker exits', async () => {
    const adapter = await makeAdapter({ workerScript: writeWorker(DIE_ON_COMMAND), sendTimeoutMs: 5_000 })
    try {
      await expect(adapter.sendText('chan-1', 'hello')).rejects.toThrow(/worker exited/)
    } finally {
      await adapter.destroy()
    }
  })

  it('resolves a send when the worker returns send_result', async () => {
    // Echo worker: reply to any send_* command with an ok send_result.
    const echo = `
      let buf = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (c) => {
        buf += c
        let nl
        while ((nl = buf.indexOf('\\n')) !== -1) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          const cmd = JSON.parse(line)
          if (cmd.id) {
            process.stdout.write(JSON.stringify({ type: 'send_result', id: cmd.id, ok: true, messageId: 'MID-' + cmd.id }) + '\\n')
          }
        }
      })
      setInterval(() => {}, 60_000)
    `
    const adapter = await makeAdapter({ workerScript: writeWorker(echo), sendTimeoutMs: 5_000 })
    try {
      const sent = await adapter.sendText('chan-1', 'hello')
      expect(sent.platform).toBe('discord')
      expect(sent.messageId).toBe('MID-1')
    } finally {
      await adapter.destroy()
    }
  })
})

describe('DiscordAdapter incoming translation', () => {
  it('translates an incoming event into an IncomingMessage with trigger flags', async () => {
    const worker = `
      const ev = {
        type: 'incoming',
        channelId: 'chan-1',
        messageId: 'MID-7',
        senderId: 'sender-1',
        senderName: 'Alice',
        senderIsBot: false,
        text: 'hi bot',
        isDM: false,
        mentionedBot: true,
        attachments: [
          { type: 'document', fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10, localPath: '/tmp/a.pdf' }
        ],
        timestamp: 1700000000000,
      }
      setTimeout(() => process.stdout.write(JSON.stringify(ev) + '\\n'), 50)
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', () => {})
      setInterval(() => {}, 60_000)
    `
    const adapter = await makeAdapter({ workerScript: writeWorker(worker) })
    const seen: IncomingMessage[] = []
    adapter.onMessage(async (m) => { seen.push(m) })
    await new Promise((r) => setTimeout(r, 250))
    try {
      expect(seen.length).toBe(1)
      const msg = seen[0]!
      expect(msg.platform).toBe('discord')
      expect(msg.isDM).toBe(false)
      expect(msg.mentionedBot).toBe(true)
      expect(msg.attachments?.[0]?.localPath).toBe('/tmp/a.pdf')
      expect(msg.attachments?.[0]?.fileId).toBe('MID-7')
    } finally {
      await adapter.destroy()
    }
  })

  it('drops bot-authored incoming messages', async () => {
    const worker = `
      const ev = {
        type: 'incoming', channelId: 'c', messageId: 'm', senderId: 's',
        senderName: 'Bot', senderIsBot: true, text: 'x', isDM: false,
        mentionedBot: false, timestamp: 1,
      }
      setTimeout(() => process.stdout.write(JSON.stringify(ev) + '\\n'), 50)
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', () => {})
      setInterval(() => {}, 60_000)
    `
    const adapter = await makeAdapter({ workerScript: writeWorker(worker) })
    const seen: IncomingMessage[] = []
    adapter.onMessage(async (m) => { seen.push(m) })
    await new Promise((r) => setTimeout(r, 250))
    try {
      expect(seen.length).toBe(0)
    } finally {
      await adapter.destroy()
    }
  })

  it('translates a button_press event', async () => {
    const worker = `
      const ev = {
        type: 'button_press', channelId: 'c', messageId: 'm', senderId: 's',
        senderName: 'Alice', buttonId: 'approve', data: 'x',
      }
      setTimeout(() => process.stdout.write(JSON.stringify(ev) + '\\n'), 50)
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', () => {})
      setInterval(() => {}, 60_000)
    `
    const adapter = await makeAdapter({ workerScript: writeWorker(worker) })
    const seen: ButtonPress[] = []
    adapter.onButtonPress(async (p) => { seen.push(p) })
    await new Promise((r) => setTimeout(r, 250))
    try {
      expect(seen.length).toBe(1)
      expect(seen[0]?.buttonId).toBe('approve')
      expect(seen[0]?.platform).toBe('discord')
    } finally {
      await adapter.destroy()
    }
  })
})
