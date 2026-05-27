import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MessagingGateway, type IncomingMessageEvent } from '../gateway'
import type { IncomingMessage, PlatformAdapter } from '../types'

let storeDir: string

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), 'gateway-store-'))
})

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true })
})

function baseMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    platform: 'telegram',
    channelId: 'chat-1',
    messageId: 'm-1',
    senderId: 'user-1',
    text: 'hello',
    timestamp: Date.now(),
    raw: {},
    ...overrides,
  }
}

function makeAdapter() {
  let onMessageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  const noop = async () => {
    throw new Error('unused')
  }
  const adapter = {
    platform: 'telegram',
    capabilities: {
      messageEditing: true,
      inlineButtons: false,
      maxButtons: 10,
      maxMessageLength: 4096,
      markdown: 'v2',
      webhookSupport: false,
    },
    initialize: noop,
    destroy: async () => {},
    isConnected: () => true,
    onMessage: (handler: (msg: IncomingMessage) => Promise<void>) => {
      onMessageHandler = handler
    },
    onButtonPress: () => {},
    sendText: mock(async () => ({ platform: 'telegram', channelId: 'chat-1', messageId: 'sent-1' })),
    editMessage: noop,
    sendButtons: noop,
    sendTyping: async () => {},
    sendFile: noop,
  } as unknown as PlatformAdapter

  return {
    adapter,
    emitMessage: async (msg: IncomingMessage) => {
      if (!onMessageHandler) throw new Error('adapter not wired')
      await onMessageHandler(msg)
    },
  }
}

function makeSessionManager() {
  const sessions = [
    {
      id: 'sess-1',
      name: 'Session One',
      isArchived: false,
      lastMessageAt: Date.now(),
    },
  ]
  return {
    getSessions: mock(() => sessions),
    getSession: mock(async (id: string) => sessions.find((s) => s.id === id)),
    sendMessage: mock(async () => {}),
  }
}

describe('MessagingGateway incoming hook', () => {
  it('reports pre-route binding state for /bind messages', async () => {
    const events: IncomingMessageEvent[] = []
    const sessionManager = makeSessionManager()
    const gateway = new MessagingGateway({
      sessionManager: sessionManager as any,
      workspaceId: 'ws-1',
      storageDir: storeDir,
      onIncomingMessage: (event) => {
        events.push(event)
      },
    })
    const { adapter, emitMessage } = makeAdapter()

    gateway.registerAdapter(adapter)
    await gateway.start()
    await emitMessage(baseMsg({ text: '/bind sess-1' }))

    expect(events).toHaveLength(1)
    expect(events[0]!.bound).toBe(false)
    expect(events[0]!.wasBound).toBe(false)
    expect(events[0]!.boundAfterRoute).toBe(true)
    expect(sessionManager.sendMessage).not.toHaveBeenCalled()
    await gateway.stop()
  })

  it('emits incoming hook metadata when a pre-route handler consumes the message', async () => {
    const events: IncomingMessageEvent[] = []
    const sessionManager = makeSessionManager()
    const gateway = new MessagingGateway({
      sessionManager: sessionManager as any,
      workspaceId: 'ws-1',
      storageDir: storeDir,
      onBeforeRouteMessage: () => true,
      onIncomingMessage: (event) => {
        events.push(event)
      },
    })
    const { adapter, emitMessage } = makeAdapter()

    gateway.registerAdapter(adapter)
    await gateway.start()
    await emitMessage(baseMsg({ text: 'start hnic' }))

    expect(events).toHaveLength(1)
    expect(events[0]!.handledByGateway).toBe(true)
    expect(events[0]!.bound).toBe(false)
    expect(events[0]!.boundAfterRoute).toBe(false)
    expect(sessionManager.sendMessage).not.toHaveBeenCalled()
    await gateway.stop()
  })
})
