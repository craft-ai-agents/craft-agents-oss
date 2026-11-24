/**
 * Router tests — focused on attachment forwarding.
 *
 * Covers:
 *   - text-only messages forward to sessionManager.admitMessage unchanged
 *     (regression guard for the Phase-3 rewrite).
 *   - attachments with `localPath` are materialized to FileAttachment[]
 *     and forwarded.
 *   - attachments missing `localPath` are silently dropped.
 *   - caption-less attachments still produce a send with empty text.
 *   - unbound channels fall through to Commands.handle.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Router } from '../router'
import { BindingStore } from '../binding-store'
import type { Commands } from '../commands'
import type { IncomingMessage, PlatformAdapter } from '../types'

// Minimal 1×1 red PNG — small, valid, triggers image-type detection.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

let storeDir: string
let fileDir: string

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), 'router-store-'))
  fileDir = mkdtempSync(join(tmpdir(), 'router-files-'))
})

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true })
  rmSync(fileDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeTinyPng(): string {
  const path = join(fileDir, 'tiny.png')
  writeFileSync(path, Buffer.from(TINY_PNG_B64, 'base64'))
  return path
}

function baseMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    platform: 'telegram',
    channelId: 'chat-1',
    messageId: '1',
    senderId: 'user-1',
    text: 'hello',
    timestamp: Date.now(),
    raw: {},
    ...overrides,
  }
}

function makeFakeAdapter(): PlatformAdapter {
  // Only sendText is exercised by Router (for error branch); rest are unused.
  const noop = async () => {
    throw new Error('unused')
  }
  return {
    platform: 'telegram',
    capabilities: {
      messageEditing: true,
      inlineButtons: true,
      maxButtons: 10,
      maxMessageLength: 4096,
      markdown: 'v2',
      webhookSupport: false,
    },
    initialize: noop,
    destroy: noop,
    isConnected: () => true,
    onMessage: () => {},
    onButtonPress: () => {},
    sendText: mock(async () => ({ platform: 'telegram', channelId: 'chat-1', messageId: 'm' })),
    editMessage: noop,
    sendButtons: noop,
    sendTyping: async () => {},
    sendFile: noop,
  } as unknown as PlatformAdapter
}

function makeFakeSessionManager(): { admitMessage: ReturnType<typeof mock> } {
  return { admitMessage: mock(async () => ({ messageId: 'msg-1', outcome: 'started' as const })) }
}

function makeFakeCommands(): { handle: ReturnType<typeof mock> } {
  return { handle: mock(async () => {}) }
}

function makeRouter() {
  const store = new BindingStore(storeDir)
  store.bind('ws1', 'sess-A', 'telegram', 'chat-1')
  const sessionManager = makeFakeSessionManager()
  const commands = makeFakeCommands()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = new Router(sessionManager as any, store, commands as unknown as Commands)
  return { router, store, sessionManager, commands }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Router', () => {
  it('forwards a text-only bound message to admitMessage', async () => {
    const { router, sessionManager } = makeRouter()
    await router.route(makeFakeAdapter(), baseMsg({ text: 'hi there' }))
    expect(sessionManager.admitMessage).toHaveBeenCalledTimes(1)
    const args = sessionManager.admitMessage.mock.calls[0]!
    expect(args[0]).toBe('sess-A') // sessionId
    expect(args[1]).toBe('hi there') // message
    expect(args[2]).toBeUndefined() // fileAttachments
  })

  it('materializes a localPath attachment into FileAttachment[]', async () => {
    const { router, sessionManager } = makeRouter()
    const pngPath = writeTinyPng()
    await router.route(
      makeFakeAdapter(),
      baseMsg({
        text: 'what is this?',
        attachments: [
          {
            type: 'photo',
            fileId: 'abc',
            fileName: 'my-photo.png',
            mimeType: 'image/png',
            localPath: pngPath,
          },
        ],
      }),
    )
    expect(sessionManager.admitMessage).toHaveBeenCalledTimes(1)
    const args = sessionManager.admitMessage.mock.calls[0]!
    const fileAttachments = args[2] as Array<{
      type: string
      name: string
      base64?: string
    }>
    expect(fileAttachments).toHaveLength(1)
    const first = fileAttachments[0]!
    expect(first.type).toBe('image')
    expect(first.name).toBe('my-photo.png')
    expect(first.base64 && first.base64.length).toBeGreaterThan(0)
  })

  it('drops attachments that have no localPath', async () => {
    const { router, sessionManager } = makeRouter()
    await router.route(
      makeFakeAdapter(),
      baseMsg({
        text: 'x',
        attachments: [{ type: 'photo', fileId: 'abc' }],
      }),
    )
    expect(sessionManager.admitMessage).toHaveBeenCalledTimes(1)
    const args = sessionManager.admitMessage.mock.calls[0]!
    expect(args[2]).toBeUndefined()
  })

  it('forwards caption-less attachments with empty text', async () => {
    const { router, sessionManager } = makeRouter()
    const pngPath = writeTinyPng()
    await router.route(
      makeFakeAdapter(),
      baseMsg({
        text: '',
        attachments: [
          { type: 'photo', fileId: 'abc', localPath: pngPath },
        ],
      }),
    )
    expect(sessionManager.admitMessage).toHaveBeenCalledTimes(1)
    const args = sessionManager.admitMessage.mock.calls[0]!
    expect(args[1]).toBe('')
    const fa = args[2] as unknown[]
    expect(fa).toHaveLength(1)
  })

  it('routes unbound channels to Commands.handle', async () => {
    const { router, sessionManager, commands } = makeRouter()
    await router.route(
      makeFakeAdapter(),
      baseMsg({ channelId: 'unbound-channel', text: '/help' }),
    )
    expect(sessionManager.admitMessage).not.toHaveBeenCalled()
    expect(commands.handle).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------------
  // Telegram supergroup forum topics — Phase A
  // -------------------------------------------------------------------------

  it('routes the same chatId + different threadIds to the per-topic session', async () => {
    // Two topics in the same supergroup → two distinct sessions
    const store = new BindingStore(storeDir)
    store.bind('ws1', 'sess-Topic5', 'telegram', '-1001', undefined, undefined, 5)
    store.bind('ws1', 'sess-Topic7', 'telegram', '-1001', undefined, undefined, 7)

    const sessionManager = makeFakeSessionManager()
    const commands = makeFakeCommands()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const router = new Router(sessionManager as any, store, commands as unknown as Commands)
    const adapter = makeFakeAdapter()

    await router.route(adapter, baseMsg({ channelId: '-1001', threadId: 5, text: 'hi from t5' }))
    await router.route(adapter, baseMsg({ channelId: '-1001', threadId: 7, text: 'hi from t7' }))

    expect(sessionManager.admitMessage).toHaveBeenCalledTimes(2)
    expect(sessionManager.admitMessage.mock.calls[0]?.[0]).toBe('sess-Topic5')
    expect(sessionManager.admitMessage.mock.calls[1]?.[0]).toBe('sess-Topic7')
  })

  it('falls through to Commands when message lands in an unbound topic', async () => {
    const store = new BindingStore(storeDir)
    // Only topic 5 is bound; topic 7 inbound has no binding
    store.bind('ws1', 'sess-A', 'telegram', '-1001', undefined, undefined, 5)
    const sessionManager = makeFakeSessionManager()
    const commands = makeFakeCommands()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const router = new Router(sessionManager as any, store, commands as unknown as Commands)

    await router.route(makeFakeAdapter(), baseMsg({ channelId: '-1001', threadId: 7, text: '/help' }))
    expect(sessionManager.admitMessage).not.toHaveBeenCalled()
    expect(commands.handle).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------------
  // craft-agents-oss#1130: Telegram handles one update at a time, so routing
  // must not wait for the turn (the turn's permission taps queue behind it).
  // -------------------------------------------------------------------------

  it('resolves once the message is admitted, without waiting for the turn', async () => {
    const { router, sessionManager } = makeRouter()
    // A turn that never ends: routing that awaited it would never resolve.
    ;(sessionManager as Record<string, unknown>).sendMessage = mock(() => new Promise<void>(() => {}))

    const outcome = await Promise.race([
      router.route(makeFakeAdapter(), baseMsg({ text: 'run the tests' })).then(() => 'routed'),
      new Promise(resolve => setTimeout(() => resolve('still waiting'), 200)),
    ])

    expect(outcome).toBe('routed')
    expect(sessionManager.admitMessage).toHaveBeenCalledTimes(1)
  })

  it('tells the chat when the session could not take the message', async () => {
    const { router, sessionManager } = makeRouter()
    sessionManager.admitMessage.mockImplementation(async () => {
      throw new Error('Session sess-A not found')
    })
    const adapter = makeFakeAdapter()

    await router.route(adapter, baseMsg({ text: 'hello?' }))

    const sendText = adapter.sendText as unknown as ReturnType<typeof mock>
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(sendText.mock.calls[0]?.[1]).toBe('Failed to send message to session: Session sess-A not found')
  })
})
