/**
 * MessagingGateway — inline button press access gating. Regression for
 * PR #348 review item "Block #1: Inline buttons completely bypass access
 * control".
 *
 * Telegram inline buttons are visible to every member of a supergroup
 * topic, so without this gate any non-owner can tap `bind:`, `perm:`, or
 * `plan:` callback buttons and bypass the text-side filter. The gate
 * checks workspace-owner status for `bind:` and binding-level access
 * for `perm:`/`plan:`.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { MessagingGateway } from '../gateway'
import type {
  ButtonPress,
  IncomingMessage,
  MessagingConfig,
  PlatformAdapter,
} from '../types'

let storageDir: string

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'gateway-btn-'))
})

afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true })
})

interface FakeAdapter extends PlatformAdapter {
  fireButton: (press: ButtonPress) => Promise<void>
  fireMessage: (msg: IncomingMessage) => Promise<void>
  sent: string[]
}

function makeFakeAdapter(): FakeAdapter {
  let buttonHandler: ((press: ButtonPress) => Promise<void>) | null = null
  let messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  const sent: string[] = []
  const adapter = {
    platform: 'telegram' as const,
    capabilities: {
      messageEditing: true,
      inlineButtons: true,
      maxButtons: 10,
      maxMessageLength: 4096,
      markdown: 'v2' as const,
      webhookSupport: false,
    },
    initialize: async () => {},
    destroy: async () => {},
    isConnected: () => true,
    onMessage(h: (msg: IncomingMessage) => Promise<void>) {
      messageHandler = h
    },
    onButtonPress(h: (press: ButtonPress) => Promise<void>) {
      buttonHandler = h
    },
    sendText: mock(async (_channelId: string, text: string) => {
      sent.push(text)
      return { platform: 'telegram', channelId: _channelId, messageId: String(sent.length) }
    }),
    editMessage: async () => {},
    sendButtons: async () => ({ platform: 'telegram' as const, channelId: '', messageId: '0' }),
    sendTyping: async () => {},
    sendFile: async () => ({ platform: 'telegram' as const, channelId: '', messageId: '0' }),
  } as unknown as FakeAdapter
  ;(adapter as { sent: string[] }).sent = sent
  ;(adapter as { fireButton: (press: ButtonPress) => Promise<void> }).fireButton = (press) =>
    buttonHandler!(press)
  ;(adapter as { fireMessage: (msg: IncomingMessage) => Promise<void> }).fireMessage = (msg) =>
    messageHandler!(msg)
  return adapter
}

function makeStubSessionManager(): ISessionManager {
  return {
    getSession: async (id: string) => ({ id, name: id } as never),
    sendMessage: async () => {},
    cancelProcessing: async () => {},
    respondToPermission: mock(() => true),
    acceptPlan: mock(async () => {}),
    setPendingPlanExecution: mock(async () => {}),
    clearPendingPlanExecution: mock(async () => {}),
    setAutomationBinder: () => {},
  } as unknown as ISessionManager
}

interface Harness {
  gateway: MessagingGateway
  adapter: FakeAdapter
  sessionManager: ISessionManager
  workspaceConfig: MessagingConfig
}

async function makeHarness(args: { workspaceConfig: MessagingConfig }): Promise<Harness> {
  const sessionManager = makeStubSessionManager()
  const gateway = new MessagingGateway({
    sessionManager,
    workspaceId: 'ws-test',
    storageDir,
    getWorkspaceConfig: () => args.workspaceConfig,
  })
  const adapter = makeFakeAdapter()
  gateway.registerAdapter(adapter)
  await gateway.start()
  return { gateway, adapter, sessionManager, workspaceConfig: args.workspaceConfig }
}

function buildPress(overrides: Partial<ButtonPress> = {}): ButtonPress {
  return {
    platform: 'telegram',
    channelId: 'chat-1',
    messageId: '1',
    senderId: 'sender-A',
    buttonId: 'bind:sess-A',
    ...overrides,
  }
}

describe('MessagingGateway button-press access gate', () => {
  it('rejects bind: button press from non-owner on locked-down workspace', async () => {
    const h = await makeHarness({
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
    })
    await h.adapter.fireButton(buildPress({ buttonId: 'bind:sess-A', senderId: 'stranger' }))
    // No "Bound to" reply emitted; only the friendly rejection (or nothing
    // if the cooldown bites). Either way: NO bind side-effect.
    expect(h.adapter.sent.some((s) => s.includes('Bound to'))).toBe(false)
    // The friendly rejection should land at least once.
    expect(h.adapter.sent.some((s) => s.includes('private'))).toBe(true)
  })

  it('allows bind: button press from workspace owner', async () => {
    const h = await makeHarness({
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
    })
    await h.adapter.fireButton(buildPress({ buttonId: 'bind:sess-A', senderId: 'owner-1' }))
    expect(h.adapter.sent.some((s) => s.includes('Bound to'))).toBe(true)
  })

  it('rejects perm: button press from non-binding-allow-list sender', async () => {
    const h = await makeHarness({
      workspaceConfig: {
        enabled: true,
        platforms: { telegram: { enabled: true, accessMode: 'open' } },
      },
    })
    // Bind a session in allow-list mode that excludes Bob.
    h.gateway.getBindingStore().bind(
      'ws-test',
      'sess-A',
      'telegram',
      'chat-1',
      undefined,
      { accessMode: 'allow-list', allowedSenderIds: ['alice'] },
    )

    await h.adapter.fireButton(
      buildPress({
        buttonId: 'perm:allow:request-1',
        channelId: 'chat-1',
        senderId: 'bob',
      }),
    )

    // respondToPermission must NOT have been called.
    expect(h.sessionManager.respondToPermission).not.toHaveBeenCalled()
    expect(h.adapter.sent.some((s) => s.includes('allow-list'))).toBe(true)
  })

  it('allows perm: button press from binding-allow-list sender', async () => {
    const h = await makeHarness({
      workspaceConfig: {
        enabled: true,
        platforms: { telegram: { enabled: true, accessMode: 'open' } },
      },
    })
    h.gateway.getBindingStore().bind(
      'ws-test',
      'sess-A',
      'telegram',
      'chat-1',
      undefined,
      { accessMode: 'allow-list', allowedSenderIds: ['alice'] },
    )
    await h.adapter.fireButton(
      buildPress({
        buttonId: 'perm:allow:request-1',
        channelId: 'chat-1',
        senderId: 'alice',
      }),
    )
    expect(h.sessionManager.respondToPermission).toHaveBeenCalled()
  })

  it('silent-drops bot senders on button press (no reply, no side-effect)', async () => {
    const h = await makeHarness({
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
    })
    await h.adapter.fireButton(
      buildPress({ buttonId: 'bind:sess-A', senderId: 'bot-id', senderIsBot: true }),
    )
    expect(h.adapter.sent.length).toBe(0)
  })

  it('non-owner perm: rejection lands the sender in the pending store', async () => {
    const h = await makeHarness({
      workspaceConfig: {
        enabled: true,
        platforms: { telegram: { enabled: true, accessMode: 'open' } },
      },
    })
    const binding = h.gateway.getBindingStore().bind(
      'ws-test',
      'sess-A',
      'telegram',
      'chat-1',
      undefined,
      { accessMode: 'allow-list', allowedSenderIds: ['alice'] },
    )
    await h.adapter.fireButton(
      buildPress({
        buttonId: 'perm:allow:request-1',
        channelId: 'chat-1',
        senderId: 'bob',
      }),
    )
    const pending = h.gateway.getPendingStore().list('telegram')
    expect(pending).toHaveLength(1)
    expect(pending[0]!.userId).toBe('bob')
    expect(pending[0]!.reason).toBe('not-on-binding-allowlist')
    expect(pending[0]!.bindingId).toBe(binding.id)
  })
})
