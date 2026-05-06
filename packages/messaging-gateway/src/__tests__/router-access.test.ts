/**
 * Router access-control integration tests.
 *
 * Verifies that bound channels reject senders outside their `accessMode` /
 * `allowedSenderIds` config and that rejected attempts are recorded in the
 * pending-senders store for the Settings UI to surface.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Router } from '../router'
import { BindingStore } from '../binding-store'
import { PendingSendersStore } from '../pending-senders'
import type { Commands } from '../commands'
import type { IncomingMessage, MessagingConfig, PlatformAdapter } from '../types'

let storeDir: string
let pendingDir: string

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), 'router-access-'))
  pendingDir = mkdtempSync(join(tmpdir(), 'router-pending-'))
})

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true })
  rmSync(pendingDir, { recursive: true, force: true })
})

function baseMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    platform: 'telegram',
    channelId: 'chat-1',
    messageId: '1',
    senderId: 'sender-A',
    text: 'hello',
    timestamp: Date.now(),
    raw: {},
    ...overrides,
  }
}

function makeFakeAdapter() {
  const sent: string[] = []
  const noop = async () => {
    throw new Error('unused')
  }
  const adapter = {
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
    sendText: mock(async (_channelId: string, text: string) => {
      sent.push(text)
      return { platform: 'telegram', channelId: 'chat-1', messageId: 'm' }
    }),
    editMessage: noop,
    sendButtons: noop,
    sendTyping: async () => {},
    sendFile: noop,
  } as unknown as PlatformAdapter & { sendText: ReturnType<typeof mock>; sent: string[] }
  // Attach sent for assertions
  ;(adapter as unknown as { sent: string[] }).sent = sent
  return adapter as PlatformAdapter & {
    sendText: ReturnType<typeof mock>
    sent: string[]
  }
}

interface Harness {
  router: Router
  store: BindingStore
  pendingStore: PendingSendersStore
  sessionManager: { sendMessage: ReturnType<typeof mock> }
  commands: { handle: ReturnType<typeof mock> }
}

function makeHarness(args: {
  workspaceConfig: MessagingConfig
  bindingConfig?: Partial<{ accessMode: 'inherit' | 'allow-list' | 'open'; allowedSenderIds: string[] }>
}): Harness {
  const store = new BindingStore(storeDir)
  store.bind(
    'ws1',
    'sess-A',
    'telegram',
    'chat-1',
    undefined,
    args.bindingConfig,
  )
  const pendingStore = new PendingSendersStore(pendingDir)
  const sessionManager = { sendMessage: mock(async () => {}) }
  const commands = { handle: mock(async () => {}) }
  const router = new Router(
    sessionManager as unknown as Parameters<Router['route']>[0] extends PlatformAdapter
      ? never
      : never extends never
        ? never
        : never,
    store,
    commands as unknown as Commands,
    undefined,
    {
      getWorkspaceConfig: () => args.workspaceConfig,
      pendingStore,
    },
  )
  return { router, store, pendingStore, sessionManager, commands }
}

describe('Router access control', () => {
  it('routes when binding is open', async () => {
    const harness = makeHarness({
      workspaceConfig: {
        enabled: true,
        platforms: { telegram: { enabled: true, accessMode: 'open' } },
      },
      bindingConfig: { accessMode: 'open' },
    })
    const adapter = makeFakeAdapter()
    await harness.router.route(adapter, baseMsg({ senderId: 'anyone' }))
    expect(harness.sessionManager.sendMessage).toHaveBeenCalledTimes(1)
    expect(adapter.sent.length).toBe(0)
  })

  it('rejects on inherited owner-only when sender is not an owner', async () => {
    const harness = makeHarness({
      workspaceConfig: {
        enabled: true,
        platforms: {
          telegram: {
            enabled: true,
            accessMode: 'owner-only',
            owners: [{ userId: 'owner-1', addedAt: 0 }],
          },
        },
      },
      bindingConfig: { accessMode: 'inherit' },
    })
    const adapter = makeFakeAdapter()
    await harness.router.route(adapter, baseMsg({ senderId: 'stranger' }))
    expect(harness.sessionManager.sendMessage).not.toHaveBeenCalled()
    expect(adapter.sent.some((s) => s.includes('private'))).toBe(true)
    // Recorded in pending store.
    const pending = harness.pendingStore.list('telegram')
    expect(pending.length).toBe(1)
    expect(pending[0]!.userId).toBe('stranger')
  })

  it('rejects on allow-list mode when sender not in list', async () => {
    const harness = makeHarness({
      workspaceConfig: {
        enabled: true,
        platforms: { telegram: { enabled: true, accessMode: 'open' } },
      },
      bindingConfig: { accessMode: 'allow-list', allowedSenderIds: ['allowed-1'] },
    })
    const adapter = makeFakeAdapter()
    await harness.router.route(adapter, baseMsg({ senderId: 'stranger' }))
    expect(harness.sessionManager.sendMessage).not.toHaveBeenCalled()
    expect(adapter.sent.some((s) => s.includes('allow-list'))).toBe(true)
    const pending = harness.pendingStore.list('telegram')
    expect(pending.length).toBe(1)
  })

  it('routes on allow-list mode when sender is in list', async () => {
    const harness = makeHarness({
      workspaceConfig: {
        enabled: true,
        platforms: { telegram: { enabled: true, accessMode: 'open' } },
      },
      bindingConfig: { accessMode: 'allow-list', allowedSenderIds: ['allowed-1'] },
    })
    const adapter = makeFakeAdapter()
    await harness.router.route(adapter, baseMsg({ senderId: 'allowed-1' }))
    expect(harness.sessionManager.sendMessage).toHaveBeenCalledTimes(1)
    expect(adapter.sent.length).toBe(0)
  })

  it('drops bot senders silently and does NOT record in pending store', async () => {
    const harness = makeHarness({
      workspaceConfig: {
        enabled: true,
        platforms: { telegram: { enabled: true, accessMode: 'open' } },
      },
      bindingConfig: { accessMode: 'open' },
    })
    const adapter = makeFakeAdapter()
    await harness.router.route(
      adapter,
      baseMsg({ senderId: 'bot-id', senderIsBot: true }),
    )
    expect(harness.sessionManager.sendMessage).not.toHaveBeenCalled()
    expect(adapter.sent.length).toBe(0)
    expect(harness.pendingStore.list('telegram').length).toBe(0)
  })

  it('throttles rejection replies — second reject within cooldown does not re-reply', async () => {
    const harness = makeHarness({
      workspaceConfig: {
        enabled: true,
        platforms: {
          telegram: {
            enabled: true,
            accessMode: 'owner-only',
            owners: [{ userId: 'owner-1', addedAt: 0 }],
          },
        },
      },
      bindingConfig: { accessMode: 'inherit' },
    })
    const adapter = makeFakeAdapter()
    await harness.router.route(adapter, baseMsg({ senderId: 'stranger' }))
    await harness.router.route(adapter, baseMsg({ senderId: 'stranger' }))
    expect(adapter.sent.length).toBe(1)
    // Both attempts still recorded in pending store.
    const pending = harness.pendingStore.list('telegram')
    expect(pending[0]!.attemptCount).toBe(2)
  })
})
