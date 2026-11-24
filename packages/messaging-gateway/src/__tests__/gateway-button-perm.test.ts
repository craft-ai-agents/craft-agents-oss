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
 *  - once a prompt can no longer be answered (answered elsewhere, its tool
 *    finished, or the turn ended) the gateway drops the entry and clears the
 *    keyboard, so users can't tap a stale prompt. Other events leave it live
 *    (craft-agents-oss#1130: clearing on any event dropped prompts that were
 *    still waiting, and their taps were ignored).
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
    // A turn never ends here: anything awaiting it instead of admission hangs.
    sendMessage: () => new Promise<void>(() => {}),
    admitMessage: mock(async () => ({ messageId: 'msg-1', outcome: 'started' })),
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

async function emit(gateway: MessagingGateway, event: SessionEvent): Promise<void> {
  gateway.onSessionEvent('session:event', { to: 'workspace', workspaceId: 'ws-test' }, event)
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

  it('stale tap after the desktop answered: silent no-op (no respondToPermission, no ack)', async () => {
    const h = await makeHarness()
    await registerPrompt(h.gateway, { requestId: 'req-1' })

    // The desktop answers first; the server announces it to every client.
    await emit(h.gateway, { type: 'permission_resolved', sessionId: 'sess-A', requestId: 'req-1', allowed: true })
    expect(h.adapter.clearButtons).toHaveBeenCalledTimes(1)

    // User now taps the (already-cleared) Telegram button.
    await h.adapter.fireButton(pressFor('perm:allow:req-1'))

    // No respondToPermission → no duplicate desktop-side flush, and no ack:
    // we don't claim an action that didn't take effect.
    expect(h.sessionManager.respondToPermission).not.toHaveBeenCalled()
    const sendTexts = h.adapter.calls.filter((c) => c.kind === 'sendText')
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

  it('a second prompt leaves the first one live: both can be answered', async () => {
    const h = await makeHarness()
    await registerPrompt(h.gateway, { requestId: 'req-1' })
    // Parallel tool calls or a background agent ask while req-1 still waits.
    await registerPrompt(h.gateway, { requestId: 'req-2' })

    expect(h.adapter.clearButtons).not.toHaveBeenCalled()

    await h.adapter.fireButton(pressFor('perm:allow:req-1'))
    await h.adapter.fireButton(pressFor('perm:deny:req-2'))
    const respondMock = h.sessionManager.respondToPermission as unknown as ReturnType<typeof mock>
    expect(respondMock.mock.calls.map((c) => [c[1], c[2]])).toEqual([['req-1', true], ['req-2', false]])
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

  it('a turn ending in one session does not clear prompts of another', async () => {
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

    // sess-A's turn ends — must not touch sess-B's keyboard.
    await emit(h.gateway, { type: 'complete', sessionId: 'sess-A' })

    // Exactly one keyboard cleared (sess-A's).
    expect(h.adapter.clearButtons).toHaveBeenCalledTimes(1)

    // sess-B's button still works.
    await h.adapter.fireButton(
      pressFor('perm:allow:req-B', { channelId: 'chat-2' }),
    )
    expect(h.sessionManager.respondToPermission).toHaveBeenCalledTimes(1)
  })
})

describe('MessagingGateway — which events settle a permission prompt (#1130)', () => {
  const keeps: Array<[string, SessionEvent]> = [
    ['a status update', { type: 'status', sessionId: 'sess-A', message: 'Compacting…' }],
    ['a generated title', { type: 'title_generated', sessionId: 'sess-A', title: 'Run the tests' }],
    ['a queued user message', { type: 'user_message', sessionId: 'sess-A', status: 'queued' }],
    ['background task progress', { type: 'task_progress', sessionId: 'sess-A', toolUseId: 'tu-9', elapsedSeconds: 30 }],
    ['another tool starting', { type: 'tool_start', sessionId: 'sess-A', toolName: 'Read', toolUseId: 'tu-2' }],
    ['another tool finishing', { type: 'tool_result', sessionId: 'sess-A', toolName: 'Read', toolUseId: 'tu-2', result: 'ok' }],
    ['another prompt answered', { type: 'permission_resolved', sessionId: 'sess-A', requestId: 'perm-tu-2', allowed: true }],
    ['an info line', { type: 'info', sessionId: 'sess-A', message: 'Token expired, refreshing session…' }],
  ]

  for (const [what, event] of keeps) {
    it(`keeps the prompt live on ${what}`, async () => {
      const h = await makeHarness()
      await registerPrompt(h.gateway, { requestId: 'perm-tu-1' })

      await emit(h.gateway, event)

      expect(h.adapter.clearButtons).not.toHaveBeenCalled()
      await h.adapter.fireButton(pressFor('perm:allow:perm-tu-1'))
      expect(h.sessionManager.respondToPermission).toHaveBeenCalledTimes(1)
    })
  }

  const settles: Array<[string, SessionEvent]> = [
    ['its own answer from another channel', { type: 'permission_resolved', sessionId: 'sess-A', requestId: 'perm-tu-1', allowed: false }],
    ["its own tool's result", { type: 'tool_result', sessionId: 'sess-A', toolName: 'Bash', toolUseId: 'tu-1', result: 'ok' }],
    ['the end of the turn', { type: 'complete', sessionId: 'sess-A' }],
    ['a stop', { type: 'interrupted', sessionId: 'sess-A' }],
    ['the session being deleted', { type: 'session_deleted', sessionId: 'sess-A' }],
  ]

  for (const [what, event] of settles) {
    it(`clears the prompt on ${what}`, async () => {
      const h = await makeHarness()
      await registerPrompt(h.gateway, { requestId: 'perm-tu-1' })

      await emit(h.gateway, event)

      expect(h.adapter.clearButtons).toHaveBeenCalledTimes(1)
      await h.adapter.fireButton(pressFor('perm:allow:perm-tu-1'))
      expect(h.sessionManager.respondToPermission).not.toHaveBeenCalled()
    })
  }
})

describe('MessagingGateway — chat updates never wait for a turn (#1130)', () => {
  /** Resolves to 'done', or 'still waiting' if `work` takes longer than 200 ms. */
  function settlesQuickly(work: Promise<unknown>): Promise<string> {
    return Promise.race([
      work.then(() => 'done'),
      new Promise<string>((resolve) => setTimeout(() => resolve('still waiting'), 200)),
    ])
  }

  it('a tap is handled right after a message that started a turn', async () => {
    const h = await makeHarness()

    // grammY hands the bot one update at a time: the message handler must
    // return before the tap is even fetched.
    expect(await settlesQuickly(h.adapter.fireMessage({
      platform: 'telegram',
      channelId: 'chat-1',
      messageId: '7',
      senderId: 'sender-A',
      text: 'clean up the build folder',
      timestamp: Date.now(),
      raw: {},
    }))).toBe('done')
    expect(h.sessionManager.admitMessage).toHaveBeenCalledTimes(1)

    await registerPrompt(h.gateway, { requestId: 'req-1' })
    await h.adapter.fireButton(pressFor('perm:allow:req-1'))
    expect(h.sessionManager.respondToPermission).toHaveBeenCalledTimes(1)
  })

  it('Accept & compact sends /compact through admission', async () => {
    const h = await makeHarness()
    await emit(h.gateway, {
      type: 'plan_submitted',
      sessionId: 'sess-A',
      message: { planPath: '/tmp/plan.md', content: 'Delete the build folder.' },
    })
    const sendButtons = h.adapter.sendButtons as unknown as ReturnType<typeof mock>
    const buttons = sendButtons.mock.calls[0]?.[2] as Array<{ id: string }>
    const compactId = buttons.find((b) => b.id.startsWith('plan:compact:'))!.id

    expect(await settlesQuickly(h.adapter.fireButton(pressFor(compactId)))).toBe('done')

    const admit = h.sessionManager.admitMessage as unknown as ReturnType<typeof mock>
    expect(admit.mock.calls[0]?.slice(0, 2)).toEqual(['sess-A', '/compact'])
    expect(h.adapter.calls.some((c) => c.kind === 'sendText' && /Compacting conversation/.test(c.text ?? ''))).toBe(true)
  })
})
