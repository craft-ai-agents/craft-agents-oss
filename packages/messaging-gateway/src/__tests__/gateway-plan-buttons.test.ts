import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MessagingGateway } from '../gateway'
import type { ButtonPress, InlineButton, PlatformAdapter, SentMessage } from '../types'

let storeDir: string

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), 'gateway-plan-'))
})

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true })
})

type Call =
  | { kind: 'sendText'; channelId: string; text: string }
  | { kind: 'sendButtons'; channelId: string; text: string; buttons: InlineButton[] }
  | { kind: 'clearButtons'; channelId: string; messageId: string }

function makeAdapter() {
  const calls: Call[] = []
  let onButtonHandler: ((press: ButtonPress) => Promise<void>) | null = null
  let nextMessageId = 1
  const adapter: PlatformAdapter & { calls: Call[] } = {
    platform: 'telegram',
    capabilities: {
      messageEditing: true,
      inlineButtons: true,
      maxButtons: 10,
      maxMessageLength: 4096,
      markdown: 'v2',
      webhookSupport: false,
    },
    calls,
    async initialize() {},
    async destroy() {},
    isConnected() { return true },
    onMessage() {},
    onButtonPress(handler) { onButtonHandler = handler },
    async sendText(channelId, text): Promise<SentMessage> {
      calls.push({ kind: 'sendText', channelId, text })
      return { platform: 'telegram', channelId, messageId: String(nextMessageId++) }
    },
    async editMessage() {},
    async sendButtons(channelId, text, buttons): Promise<SentMessage> {
      calls.push({ kind: 'sendButtons', channelId, text, buttons })
      return { platform: 'telegram', channelId, messageId: String(nextMessageId++) }
    },
    async sendTyping() {},
    async sendFile(channelId): Promise<SentMessage> {
      return { platform: 'telegram', channelId, messageId: String(nextMessageId++) }
    },
    async clearButtons(channelId, messageId) {
      calls.push({ kind: 'clearButtons', channelId, messageId })
    },
  }

  return {
    adapter,
    press: async (channelId: string, buttonId: string) => {
      if (!onButtonHandler) throw new Error('button handler not wired')
      await onButtonHandler({
        platform: 'telegram',
        channelId,
        messageId: 'button-msg',
        senderId: 'sender-1',
        buttonId,
      })
    },
  }
}

function makeSessionManager(overrides: Record<string, unknown> = {}) {
  return {
    getSession: mock(async () => ({ id: 'sess-1', name: 'Session' })),
    getSessions: mock(() => []),
    sendMessage: mock(async () => {}),
    respondToPermission: mock(() => true),
    acceptPlan: mock(async () => {}),
    setPendingPlanExecution: mock(async () => {}),
    clearPendingPlanExecution: mock(async () => {}),
    ...overrides,
  }
}

function planEvent() {
  return {
    type: 'plan_submitted',
    sessionId: 'sess-1',
    message: {
      id: 'plan-1',
      role: 'plan',
      content: '# Plan',
      timestamp: Date.now(),
      planPath: '/tmp/plan.md',
    },
  }
}

function compactionCompleteEvent() {
  return {
    type: 'info',
    sessionId: 'sess-1',
    statusType: 'compaction_complete',
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('MessagingGateway plan button binding checks', () => {
  it('rejects a plan token pressed from a different current channel binding', async () => {
    const sessionManager = makeSessionManager()
    const gateway = new MessagingGateway({
      sessionManager: sessionManager as any,
      workspaceId: 'ws-1',
      storageDir: storeDir,
    })
    const { adapter, press } = makeAdapter()
    gateway.registerAdapter(adapter)
    await gateway.start()

    gateway.getBindingStore().bind('ws-1', 'sess-1', 'telegram', 'chat-original')
    gateway.getBindingStore().bind('ws-1', 'sess-1', 'telegram', 'chat-other')

    gateway.onSessionEvent('session:event', { to: 'workspace', workspaceId: 'ws-1' } as any, planEvent())
    await flush()

    const originalButtons = adapter.calls.find(
      (c): c is Extract<Call, { kind: 'sendButtons' }> =>
        c.kind === 'sendButtons' && c.channelId === 'chat-original',
    )
    const buttonId = originalButtons?.buttons[0]?.id
    expect(buttonId).toMatch(/^plan:accept:/)

    await press('chat-other', buttonId!)

    expect(sessionManager.acceptPlan).not.toHaveBeenCalled()
    const lastText = adapter.calls.filter((c): c is Extract<Call, { kind: 'sendText' }> => c.kind === 'sendText').at(-1)
    expect(lastText?.text).toContain('different chat binding')

    await gateway.stop()
  })

  it('clears pending plan execution when compact dispatch fails after setting state', async () => {
    const sessionManager = makeSessionManager({
      sendMessage: mock(async () => { throw new Error('compact failed') }),
    })
    const gateway = new MessagingGateway({
      sessionManager: sessionManager as any,
      workspaceId: 'ws-1',
      storageDir: storeDir,
    })
    const { adapter, press } = makeAdapter()
    gateway.registerAdapter(adapter)
    await gateway.start()
    gateway.getBindingStore().bind('ws-1', 'sess-1', 'telegram', 'chat-1')

    gateway.onSessionEvent('session:event', { to: 'workspace', workspaceId: 'ws-1' } as any, planEvent())
    await flush()
    const buttons = adapter.calls.find((c): c is Extract<Call, { kind: 'sendButtons' }> => c.kind === 'sendButtons')

    await press('chat-1', buttons!.buttons[1]!.id)

    expect(sessionManager.setPendingPlanExecution).toHaveBeenCalledWith('sess-1', '/tmp/plan.md')
    expect(sessionManager.clearPendingPlanExecution).toHaveBeenCalledWith('sess-1')

    await gateway.stop()
  })

  it('clears pending plan execution when post-compaction accept fails', async () => {
    const sessionManager = makeSessionManager({
      acceptPlan: mock(async () => { throw new Error('accept failed') }),
    })
    const gateway = new MessagingGateway({
      sessionManager: sessionManager as any,
      workspaceId: 'ws-1',
      storageDir: storeDir,
    })
    const { adapter, press } = makeAdapter()
    gateway.registerAdapter(adapter)
    await gateway.start()
    gateway.getBindingStore().bind('ws-1', 'sess-1', 'telegram', 'chat-1')

    gateway.onSessionEvent('session:event', { to: 'workspace', workspaceId: 'ws-1' } as any, planEvent())
    await flush()
    const buttons = adapter.calls.find((c): c is Extract<Call, { kind: 'sendButtons' }> => c.kind === 'sendButtons')

    await press('chat-1', buttons!.buttons[1]!.id)
    gateway.onSessionEvent('session:event', { to: 'workspace', workspaceId: 'ws-1' } as any, compactionCompleteEvent())
    await flush()

    expect(sessionManager.acceptPlan).toHaveBeenCalledWith('sess-1', '/tmp/plan.md')
    expect(sessionManager.clearPendingPlanExecution).toHaveBeenCalledWith('sess-1')

    await gateway.stop()
  })
})
