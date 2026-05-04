/**
 * Router tests — focused on attachment forwarding.
 *
 * Covers:
 *   - text-only messages forward to sessionManager.sendMessage unchanged
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
let sessionDir: string

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), 'router-store-'))
  fileDir = mkdtempSync(join(tmpdir(), 'router-files-'))
  sessionDir = mkdtempSync(join(tmpdir(), 'router-session-'))
})

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true })
  rmSync(fileDir, { recursive: true, force: true })
  rmSync(sessionDir, { recursive: true, force: true })
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

function makeFakeSessionManager(): {
  sendMessage: ReturnType<typeof mock>
  getSessionPath: ReturnType<typeof mock>
} {
  // Router.resolveAttachments copies inbound files into the session's
  // attachments dir, so the fake points at the per-test scratch dir created
  // in beforeEach (and torn down in afterEach).
  return {
    sendMessage: mock(async () => {}),
    getSessionPath: mock(() => sessionDir),
  }
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
  it('forwards a text-only bound message to sendMessage', async () => {
    const { router, sessionManager } = makeRouter()
    await router.route(makeFakeAdapter(), baseMsg({ text: 'hi there' }))
    expect(sessionManager.sendMessage).toHaveBeenCalledTimes(1)
    const args = sessionManager.sendMessage.mock.calls[0]!
    expect(args[0]).toBe('sess-A') // sessionId
    expect(args[1]).toBe('hi there') // message
    expect(args[2]).toBeUndefined() // fileAttachments
  })

  it('materializes a localPath attachment into FileAttachment[] and StoredAttachment[]', async () => {
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
    expect(sessionManager.sendMessage).toHaveBeenCalledTimes(1)
    const args = sessionManager.sendMessage.mock.calls[0]!
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

    // StoredAttachment[] — what the user-message bubble renders against.
    const storedAttachments = args[3] as Array<{
      type: string
      name: string
      mimeType: string
      storedPath: string
      thumbnailBase64?: string
    }>
    expect(storedAttachments).toHaveLength(1)
    const storedFirst = storedAttachments[0]!
    expect(storedFirst.type).toBe('image')
    expect(storedFirst.name).toBe('my-photo.png')
    expect(storedFirst.mimeType).toBe('image/png')
    // The file must be promoted into the session's attachments dir, not left
    // in the adapter's tmp dir — that's what makes click-to-open work.
    expect(storedFirst.storedPath.startsWith(join(sessionDir, 'attachments') + '/')).toBe(true)
    // Tiny PNG is well under the inline-thumbnail size cap, so the bubble
    // should get an embedded preview rather than falling back to an icon.
    expect(storedFirst.thumbnailBase64 && storedFirst.thumbnailBase64.length).toBeGreaterThan(0)
  })

  it('does not leak binary bytes into FileAttachment.text for non-text media', async () => {
    // Regression: `readFileAttachment` falls back to `type='text'` for any
    // extension it doesn't recognise (including .mp4) and reads the file as
    // utf-8 into `attachment.text`. Without the type-correction in Router,
    // that garbled text gets attached to the model's prompt.
    const { router, sessionManager } = makeRouter()
    const mp4Path = join(fileDir, 'clip.mp4')
    // 16 bytes of non-utf8 binary — enough to make `text` field obviously wrong.
    writeFileSync(mp4Path, Buffer.from([0x00, 0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8, 0xf7, 0xf6, 0xf5, 0xf4, 0xf3, 0xf2, 0xf1]))

    await router.route(
      makeFakeAdapter(),
      baseMsg({
        text: '',
        attachments: [
          {
            type: 'video',
            fileId: 'v1',
            fileName: 'clip.mp4',
            mimeType: 'video/mp4',
            localPath: mp4Path,
          },
        ],
      }),
    )

    const args = sessionManager.sendMessage.mock.calls[0]!
    const fileAttachments = args[2] as Array<{
      type: string
      mimeType: string
      text?: string
      base64?: string
    }>
    const first = fileAttachments[0]!
    expect(first.type).toBe('unknown')
    expect(first.text).toBeUndefined()
    expect(first.base64).toBeUndefined()
    // Adapter-supplied MIME survives so `getFileTypeLabel` can show "MP4".
    expect(first.mimeType).toBe('video/mp4')

    const stored = (args[3] as Array<{ type: string; mimeType: string }>)[0]!
    expect(stored.type).toBe('unknown')
    expect(stored.mimeType).toBe('video/mp4')
  })

  it('contains a path-traversal fileName inside the session attachments dir', async () => {
    // A remote sender controls IncomingAttachment.fileName. Without
    // sanitization, `path.join(attachmentsDir, "uuid_../../etc/passwd")`
    // would resolve outside the session dir.
    const { router, sessionManager } = makeRouter()
    const pngPath = writeTinyPng()
    await router.route(
      makeFakeAdapter(),
      baseMsg({
        text: '',
        attachments: [
          {
            type: 'photo',
            fileId: 'p1',
            fileName: '../../../etc/passwd.png',
            mimeType: 'image/png',
            localPath: pngPath,
          },
        ],
      }),
    )

    const args = sessionManager.sendMessage.mock.calls[0]!
    const stored = args[3] as Array<{ storedPath: string }>
    expect(stored).toHaveLength(1)
    const sessionAttachmentsDir = join(sessionDir, 'attachments') + '/'
    expect(stored[0]!.storedPath.startsWith(sessionAttachmentsDir)).toBe(true)
    // Ensure no `..` segments survived the sanitization step.
    const tail = stored[0]!.storedPath.slice(sessionAttachmentsDir.length)
    expect(tail.includes('/')).toBe(false)
    expect(tail.includes('..')).toBe(false)
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
    expect(sessionManager.sendMessage).toHaveBeenCalledTimes(1)
    const args = sessionManager.sendMessage.mock.calls[0]!
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
    expect(sessionManager.sendMessage).toHaveBeenCalledTimes(1)
    const args = sessionManager.sendMessage.mock.calls[0]!
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
    expect(sessionManager.sendMessage).not.toHaveBeenCalled()
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

    expect(sessionManager.sendMessage).toHaveBeenCalledTimes(2)
    expect(sessionManager.sendMessage.mock.calls[0]?.[0]).toBe('sess-Topic5')
    expect(sessionManager.sendMessage.mock.calls[1]?.[0]).toBe('sess-Topic7')
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
    expect(sessionManager.sendMessage).not.toHaveBeenCalled()
    expect(commands.handle).toHaveBeenCalledTimes(1)
  })
})
