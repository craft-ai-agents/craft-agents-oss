/**
 * MessagingGateway — `perm:` button-press behavior. Regression for issue
 * [#726](https://github.com/craft-ai-agents/craft-agents-oss/issues/726):
 * "Approve/Deny buttons in Telegram are unresponsive, fire in batch after
 * desktop action".
 *
 * The fix brings the `perm:` button path to parity with the `plan:` path:
 *
 *  - the renderer registers a `permissionMessages` entry when it sends the
 *    inline keyboard for a `permission_request` event;
 *  - a button tap claims that entry up-front so a second tap silently
 *    no-ops (no duplicate "✅ Allowed" flood);
 *  - the gateway clears the inline keyboard before calling
 *    `respondToPermission`, so further taps don't even produce callbacks;
 *  - the boolean returned by `respondToPermission` decides whether the
 *    user-facing confirmation is posted at all (false → silent, because
 *    the response did not take effect on this side);
 *  - any subsequent session event for the same session implies the agent
 *    moved past the prompt — the gateway sweeps the entry and clears the
 *    keyboard so users can't tap a stale prompt after the desktop user
 *    already resolved it.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { MessagingGateway } from '../gateway'
import type { SessionEvent } from '../renderer'
import type {
  ButtonPress,
  IncomingMessage,
  MessagingConfig,
  PlatformAdapter,
} from '../types'

let storageDir: string

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'gateway-perm-'))
})

afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true })
})

interface AdapterCall {
  kind: 'sendText' | 'sendButtons' | 'clearButtons'
  channelId: string
  messageId?: string
  text?: string
}

interface FakeAdapter extends PlatformAdapter {
  fireButton: (press: ButtonPress) => Promise<void>
  fireMessage: (msg: IncomingMessage) => Promise<void>
  calls: AdapterCall[]
}

/**
 * Adapter with both `sendButtons` (so the renderer can register a prompt)
 * and `clearButtons` (so we can assert the gateway disables the keyboard).
 * Plain text sends and button taps share a `calls` log so tests can assert
 * ordering between them.
 */
function makeFakeAdapter(): FakeAdapter {
  let buttonHandler: ((press: ButtonPress) => Promise<void>) | null = null
  let messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  const calls: AdapterCall[] = []
  let nextId = 100

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
    sendText: mock(async (channelId: string, text: string) => {
      const messageId = String(nextId++)
      calls.push({ kind: 'sendText', channelId, text, messageId })
      return { platform: 'telegram' as const, channelId, messageId }
    }),
    editMessage: async () => {},
    sendButtons: mock(async (channelId: string, text: string) => {
      const messageId = String(nextId++)
      calls.push({ kind: 'sendButtons', channelId, text, messageId })
      return { platform: 'telegram' as const, channelId, messageId }
    }),
    sendTyping: async () => {},
    sendFile: async () => ({ platform: 'telegram' as const, channelId: '', messageId: '0' }),
    clearButtons: mock(async (channelId: string, messageId: string) => {
      calls.push({ kind: 'clearButtons', channelId, messageId })
    }),
  } as unknown as FakeAdapter
  ;(adapter as { calls: AdapterCall[] }).calls = calls
  ;(adapter as { fireButton: (press: ButtonPress) => Promise<void> }).fireButton = (press) =>
    buttonHandler!(press)
  ;(adapter as { fireMessage: (msg: IncomingMessage) => Promise<void> }).fireMessage = (msg) =>
    messageHandler!(msg)
  return adapter
}

interface StubSessionManagerOpts {
  /** Override the boolean `respondToPermission` returns (default: true). */
  respondToPermissionReturn?: boolean
}

function makeStubSessionManager(opts: StubSessionManagerOpts = {}): ISessionManager {
  const respondReturn = opts.respondToPermissionReturn ?? true
  return {
    getSession: async (id: string) => ({ id, name: id } as never),
    sendMessage: async () => {},
    cancelProcessing: async () => {},
    respondToPermission: mock(() => respondReturn),
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
}

const OPEN_TELEGRAM_CONFIG: MessagingConfig = {
  enabled: true,
  platforms: { telegram: { enabled: true, accessMode: 'open' } },
}

async function makeHarness(opts: StubSessionManagerOpts = {}): Promise<Harness> {
  const sessionManager = makeStubSessionManager(opts)
  const gateway = new MessagingGateway({
    sessionManager,
    workspaceId: 'ws-test',
    storageDir,
    getWorkspaceConfig: () => OPEN_TELEGRAM_CONFIG,
  })
  const adapter = makeFakeAdapter()
  gateway.registerAdapter(adapter)
  await gateway.start()

  // Bind a session to the chat so `findByChannel` returns a real binding.
  // approvalChannel must be 'chat' for the renderer to emit inline buttons.
  gateway.getBindingStore().bind(
    'ws-test',
    'sess-A',
    'telegram',
    'chat-1',
    undefined,
    { approvalChannel: 'chat' },
  )

  return { gateway, adapter, sessionManager }
}

/**
 * Drive a `permission_request` event through the gateway so the renderer
 * sends the inline keyboard and the gateway records a `permissionMessages`
 * entry for `requestId`. Without this, taps are correctly dropped as stale.
 */
async function registerPrompt(
  gateway: MessagingGateway,
  args: { sessionId?: string; requestId: string },
): Promise<void> {
  const event: SessionEvent = {
    type: 'permission_request',
    sessionId: args.sessionId ?? 'sess-A',
    request: {
      requestId: args.requestId,
      toolName: 'bash',
      description: 'run tests',
    },
  }
  gateway.onSessionEvent('session:event', { to: 'workspace', workspaceId: 'ws-test' }, event)
  // renderer.handle is fire-and-forget; let the chain settle.
  await Promise.resolve()
  await Promise.resolve()
}

function pressFor(buttonId: string, overrides: Partial<ButtonPress> = {}): ButtonPress {
  return {
    platform: 'telegram',
    channelId: 'chat-1',
    messageId: '1',
    senderId: 'sender-A',
    buttonId,
    ...overrides,
  }
}

describe('MessagingGateway — perm: button (#726)', () => {
  it('happy path: clears keyboard, calls respondToPermission once, posts ✅ Allowed', async () => {
    const h = await makeHarness()
    await registerPrompt(h.gateway, { requestId: 'req-1' })

    await h.adapter.fireButton(pressFor('perm:allow:req-1'))

    expect(h.sessionManager.respondToPermission).toHaveBeenCalledTimes(1)
    expect(h.adapter.clearButtons).toHaveBeenCalledTimes(1)
    const acks = h.adapter.calls.filter((c) => c.kind === 'sendText')
    expect(acks).toHaveLength(1)
    expect(acks[0]?.text).toContain('Allowed')
  })

  it('deny path posts ❌ Denied with allowed=false to respondToPermission', async () => {
    const h = await makeHarness()
    await registerPrompt(h.gateway, { requestId: 'req-1' })

    await h.adapter.fireButton(pressFor('perm:deny:req-1'))

    const respondMock = h.sessionManager.respondToPermission as unknown as ReturnType<typeof mock>
    expect(respondMock.mock.calls[0]?.[2]).toBe(false)
    const acks = h.adapter.calls.filter((c) => c.kind === 'sendText')
    expect(acks[0]?.text).toContain('Denied')
  })

  it('idempotent: a second tap on the same prompt is a silent no-op', async () => {
    const h = await makeHarness()
    await registerPrompt(h.gateway, { requestId: 'req-1' })

    await h.adapter.fireButton(pressFor('perm:allow:req-1'))
    await h.adapter.fireButton(pressFor('perm:allow:req-1'))

    expect(h.sessionManager.respondToPermission).toHaveBeenCalledTimes(1)
    expect(h.adapter.clearButtons).toHaveBeenCalledTimes(1)
    const acks = h.adapter.calls.filter((c) => c.kind === 'sendText')
    expect(acks).toHaveLength(1)
  })

  it('stale tap after desktop resolves: silent no-op (no respondToPermission, no ack)', async () => {
    const h = await makeHarness()
    await registerPrompt(h.gateway, { requestId: 'req-1' })

    // Desktop resolves first → agent moves on, emitting a tool_start. The
    // gateway sweep on this event drops the entry and clears the keyboard.
    h.gateway.onSessionEvent(
      'session:event',
      { to: 'workspace', workspaceId: 'ws-test' },
      { type: 'tool_start', sessionId: 'sess-A', toolName: 'Bash' } as SessionEvent,
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(h.adapter.clearButtons).toHaveBeenCalledTimes(1)

    // Snapshot how many texts the renderer's progress bubble already posted
    // for the tool_start event, so we can isolate the press-side ack count.
    const ackCountBeforePress = h.adapter.calls.filter((c) => c.kind === 'sendText').length

    // User now taps the (already-cleared) Telegram button.
    await h.adapter.fireButton(pressFor('perm:allow:req-1'))

    // No respondToPermission → no duplicate desktop-side flush.
    expect(h.sessionManager.respondToPermission).not.toHaveBeenCalled()

    // No ack message — we don't lie about an action that didn't take effect.
    // Compare against the pre-press snapshot so the renderer's own progress
    // bubble for tool_start doesn't contaminate the assertion.
    const sendTexts = h.adapter.calls.filter((c) => c.kind === 'sendText')
    expect(sendTexts).toHaveLength(ackCountBeforePress)
    expect(sendTexts.some((c) => /Allowed|Denied/.test(c.text ?? ''))).toBe(false)
  })

  it('respondToPermission=false (session/agent gone): clears keyboard but does NOT post ack', async () => {
    const h = await makeHarness({ respondToPermissionReturn: false })
    await registerPrompt(h.gateway, { requestId: 'req-1' })

    await h.adapter.fireButton(pressFor('perm:allow:req-1'))

    // The keyboard was cleared optimistically (we'd already claimed the entry).
    expect(h.adapter.clearButtons).toHaveBeenCalledTimes(1)
    expect(h.sessionManager.respondToPermission).toHaveBeenCalledTimes(1)
    // But no ack — the response did not actually take effect on this side.
    const acks = h.adapter.calls.filter((c) => c.kind === 'sendText')
    expect(acks).toHaveLength(0)
  })

  it('superseded prompt: a new permission_request for the same session sweeps the old entry', async () => {
    const h = await makeHarness()
    await registerPrompt(h.gateway, { requestId: 'req-1' })

    // Agent resolved req-1 silently and is now asking for a fresh permission.
    await registerPrompt(h.gateway, { requestId: 'req-2' })

    // The old req-1 keyboard was cleared; req-2's keyboard is live.
    expect(h.adapter.clearButtons).toHaveBeenCalledTimes(1)

    // A late tap on req-1 is a no-op.
    await h.adapter.fireButton(pressFor('perm:allow:req-1'))
    expect(h.sessionManager.respondToPermission).not.toHaveBeenCalled()

    // A tap on req-2 is honored.
    await h.adapter.fireButton(pressFor('perm:allow:req-2'))
    expect(h.sessionManager.respondToPermission).toHaveBeenCalledTimes(1)
    const respondMock = h.sessionManager.respondToPermission as unknown as ReturnType<typeof mock>
    expect(respondMock.mock.calls[0]?.[1]).toBe('req-2')
  })

  it('malformed buttonId: silently dropped (no entry, no respondToPermission)', async () => {
    const h = await makeHarness()
    await registerPrompt(h.gateway, { requestId: 'req-1' })

    // Missing requestId portion.
    await h.adapter.fireButton(pressFor('perm:allow:'))
    // Unknown action verb.
    await h.adapter.fireButton(pressFor('perm:foo:req-1'))

    expect(h.sessionManager.respondToPermission).not.toHaveBeenCalled()
    expect(h.adapter.clearButtons).not.toHaveBeenCalled()
    const acks = h.adapter.calls.filter((c) => c.kind === 'sendText')
    expect(acks).toHaveLength(0)
  })

  it('non-permission-request events do NOT sweep entries from other sessions', async () => {
    const h = await makeHarness()

    // Register a second session bound to a different chat with its own prompt.
    h.gateway.getBindingStore().bind(
      'ws-test',
      'sess-B',
      'telegram',
      'chat-2',
      undefined,
      { approvalChannel: 'chat' },
    )
    await registerPrompt(h.gateway, { sessionId: 'sess-A', requestId: 'req-A' })
    await registerPrompt(h.gateway, { sessionId: 'sess-B', requestId: 'req-B' })

    // Event for sess-A only — must not touch sess-B's keyboard.
    h.gateway.onSessionEvent(
      'session:event',
      { to: 'workspace', workspaceId: 'ws-test' },
      { type: 'tool_start', sessionId: 'sess-A', toolName: 'Bash' } as SessionEvent,
    )
    await Promise.resolve()
    await Promise.resolve()

    // Exactly one keyboard cleared (sess-A's).
    expect(h.adapter.clearButtons).toHaveBeenCalledTimes(1)

    // sess-B's button still works.
    await h.adapter.fireButton(
      pressFor('perm:allow:req-B', { channelId: 'chat-2' }),
    )
    expect(h.sessionManager.respondToPermission).toHaveBeenCalledTimes(1)
  })
})
