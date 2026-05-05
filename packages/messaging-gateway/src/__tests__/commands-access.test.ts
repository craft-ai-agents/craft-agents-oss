/**
 * Commands access-control integration tests.
 *
 * Covers the pre-binding gate (`/new`, `/bind`, `/unbind` are owner-only when
 * the workspace is locked down) and the `/pair` bootstrap rule (first
 * successful redeem seeds the first owner; subsequent codes only succeed for
 * existing owners).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Session } from '@craft-agent/shared/protocol'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { BindingStore } from '../binding-store'
import { Commands, type AccessControlDeps, type PairingCodeConsumer } from '../commands'
import type {
  IncomingMessage,
  MessagingConfig,
  PlatformAdapter,
  PlatformOwner,
  SentMessage,
} from '../types'

let storeDir: string

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), 'commands-access-'))
})

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true })
})

function makeSession(id: string): Session {
  return {
    id,
    name: id,
    workspaceId: 'ws1',
    workspaceName: 'Workspace',
    messages: [],
    createdAt: Date.now() - 1000,
    updatedAt: Date.now(),
    lastMessageAt: Date.now(),
    isArchived: false,
  } as unknown as Session
}

function makeSessionManager(sessions: Session[] = []): ISessionManager {
  return {
    getSessions: () => sessions,
    getSession: async (sessionId: string) => sessions.find((s) => s.id === sessionId) ?? null,
    createSession: async (_workspaceId: string, opts?: { name?: string }) =>
      makeSession(opts?.name ?? 'created'),
    sendMessage: async () => {},
    cancelProcessing: async () => {},
    respondToPermission: () => true,
  } as unknown as ISessionManager
}

function makeAdapter(): PlatformAdapter & { sent: string[] } {
  const sent: string[] = []
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
    sent,
    async initialize() {},
    async destroy() {},
    isConnected() {
      return true
    },
    onMessage() {},
    onButtonPress() {},
    async sendText(_channelId: string, text: string): Promise<SentMessage> {
      sent.push(text)
      return { platform: 'telegram', channelId: 'chan-1', messageId: String(sent.length) }
    },
    async editMessage() {},
    async sendButtons(_channelId: string, text: string): Promise<SentMessage> {
      sent.push(text)
      return { platform: 'telegram', channelId: 'chan-1', messageId: String(sent.length) }
    },
    async sendTyping() {},
    async sendFile(): Promise<SentMessage> {
      return { platform: 'telegram', channelId: 'chan-1', messageId: String(sent.length + 1) }
    },
  }
}

function buildMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    platform: 'telegram',
    channelId: 'chan-1',
    messageId: 'm1',
    senderId: 'stranger',
    senderName: 'Stranger',
    text: '/new',
    timestamp: Date.now(),
    raw: {},
    ...overrides,
  }
}

function buildPairingConsumer(
  result: ReturnType<PairingCodeConsumer['consume']> = {
    kind: 'session',
    workspaceId: 'ws1',
    sessionId: 'sess-A',
  },
): PairingCodeConsumer {
  return {
    canConsume: () => true,
    consume: () => result,
  }
}

interface AccessHarness {
  config: MessagingConfig
  seeded: PlatformOwner[]
}

function buildAccessDeps(harness: AccessHarness): AccessControlDeps {
  return {
    getWorkspaceConfig: () => harness.config,
    seedOwnerOnFirstPair: async (_platform, candidate) => {
      const existing = harness.config.platforms.telegram?.owners ?? []
      if (existing.length > 0) return existing
      const next = [candidate]
      harness.seeded = next
      harness.config = {
        ...harness.config,
        platforms: {
          ...harness.config.platforms,
          telegram: {
            ...harness.config.platforms.telegram,
            enabled: true,
            accessMode: harness.config.platforms.telegram?.accessMode ?? 'owner-only',
            owners: next,
          },
        },
      }
      return next
    },
  }
}

function buildCommands(args: {
  ownerOnly?: boolean
  owners?: PlatformOwner[]
  pairingResult?: ReturnType<PairingCodeConsumer['consume']>
}) {
  const sessions = [makeSession('sess-A')]
  const sessionManager = makeSessionManager(sessions)
  const store = new BindingStore(storeDir)
  const harness: AccessHarness = {
    config: {
      enabled: true,
      platforms: {
        telegram: {
          enabled: true,
          ...(args.ownerOnly ? { accessMode: 'owner-only' as const } : {}),
          ...(args.owners ? { owners: args.owners } : {}),
        },
      },
    },
    seeded: [],
  }
  const access = buildAccessDeps(harness)
  const consumer = args.pairingResult !== undefined
    ? buildPairingConsumer(args.pairingResult)
    : buildPairingConsumer()
  const commands = new Commands(
    sessionManager,
    store,
    'ws1',
    consumer,
    undefined,
    access,
  )
  return { commands, store, harness, sessionManager }
}

// ---------------------------------------------------------------------------
// Pre-binding gate (handle / handleCommand)
// ---------------------------------------------------------------------------

describe('Commands pre-binding gate', () => {
  it('open workspace lets a stranger run /new', async () => {
    const { commands } = buildCommands({ ownerOnly: false })
    const adapter = makeAdapter()
    await commands.handleCommand(adapter, buildMsg({ text: '/new', senderId: 'stranger' }))
    // The stranger should have received the "Created..." reply, not the
    // friendly rejection.
    expect(adapter.sent.some((s) => s.includes('private'))).toBe(false)
  })

  it('owner-only workspace rejects /new from non-owner with the friendly reply', async () => {
    const { commands } = buildCommands({
      ownerOnly: true,
      owners: [{ userId: 'owner-1', addedAt: 0 }],
    })
    const adapter = makeAdapter()
    await commands.handleCommand(adapter, buildMsg({ text: '/new', senderId: 'stranger' }))
    expect(adapter.sent.length).toBe(1)
    expect(adapter.sent[0]).toContain('private')
  })

  it('owner-only workspace lets the owner run /new', async () => {
    const { commands } = buildCommands({
      ownerOnly: true,
      owners: [{ userId: 'owner-1', addedAt: 0 }],
    })
    const adapter = makeAdapter()
    await commands.handleCommand(adapter, buildMsg({ text: '/new', senderId: 'owner-1' }))
    expect(adapter.sent.some((s) => s.includes('private'))).toBe(false)
  })

  it('always allows /help even from non-owners', async () => {
    const { commands } = buildCommands({
      ownerOnly: true,
      owners: [{ userId: 'owner-1', addedAt: 0 }],
    })
    const adapter = makeAdapter()
    await commands.handleCommand(adapter, buildMsg({ text: '/help', senderId: 'stranger' }))
    expect(adapter.sent.some((s) => s.includes('Commands:'))).toBe(true)
  })

  it('rejects bot senders silently (no reply text sent)', async () => {
    const { commands } = buildCommands({
      ownerOnly: true,
      owners: [{ userId: 'owner-1', addedAt: 0 }],
    })
    const adapter = makeAdapter()
    await commands.handleCommand(
      adapter,
      buildMsg({ text: '/new', senderId: 'bot-id', senderIsBot: true }),
    )
    // Bot rejection has no reply text by design.
    expect(adapter.sent.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// /pair bootstrap + ownership rules
// ---------------------------------------------------------------------------

describe('Commands /pair bootstrap', () => {
  it('first /pair on a fresh workspace seeds the first owner', async () => {
    const { commands, harness } = buildCommands({
      ownerOnly: true,
      owners: [],
    })
    const adapter = makeAdapter()
    await commands.handleCommand(
      adapter,
      buildMsg({
        text: '/pair 123456',
        senderId: 'first-owner',
        senderName: 'Alice',
        senderUsername: 'alice',
      }),
    )
    expect(harness.seeded.length).toBe(1)
    expect(harness.seeded[0]!.userId).toBe('first-owner')
    expect(harness.seeded[0]!.displayName).toBe('Alice')
    expect(harness.seeded[0]!.username).toBe('alice')
    // Successful redeem ends with the "Paired with" reply.
    expect(adapter.sent.some((s) => s.includes('Paired with'))).toBe(true)
  })

  it('/pair from a non-owner is blocked once owners exist', async () => {
    const { commands, harness } = buildCommands({
      ownerOnly: true,
      owners: [{ userId: 'owner-1', addedAt: 0 }],
    })
    const adapter = makeAdapter()
    await commands.handleCommand(
      adapter,
      buildMsg({ text: '/pair 123456', senderId: 'stranger' }),
    )
    // Reply mentions "Only existing bot owners".
    expect(adapter.sent.some((s) => s.includes('owner'))).toBe(true)
    // No new owners seeded.
    expect(harness.seeded.length).toBe(0)
  })

  it('/pair from an existing owner succeeds', async () => {
    const { commands } = buildCommands({
      ownerOnly: true,
      owners: [{ userId: 'owner-1', addedAt: 0 }],
    })
    const adapter = makeAdapter()
    await commands.handleCommand(
      adapter,
      buildMsg({ text: '/pair 123456', senderId: 'owner-1' }),
    )
    expect(adapter.sent.some((s) => s.includes('Paired with'))).toBe(true)
  })

  it('/pair on an open workspace still seeds when owners list is empty', async () => {
    const { commands, harness } = buildCommands({
      ownerOnly: false,
      owners: [],
    })
    const adapter = makeAdapter()
    await commands.handleCommand(
      adapter,
      buildMsg({ text: '/pair 123456', senderId: 'first-pair' }),
    )
    // Even on 'open' workspaces, the first pair seeds an owner so the
    // operator has someone to start from when they later choose to lock down.
    expect(harness.seeded.length).toBe(1)
    expect(harness.seeded[0]!.userId).toBe('first-pair')
  })

  it('accepts /pair@BotName <code> (Telegram group disambiguation form)', async () => {
    const { commands, harness } = buildCommands({ ownerOnly: false, owners: [] })
    const adapter = makeAdapter()
    await commands.handleCommand(
      adapter,
      buildMsg({ text: '/pair@MyBot 123456', senderId: 'first-pair' }),
    )
    expect(adapter.sent.some((s) => s.includes('Paired with'))).toBe(true)
    expect(harness.seeded[0]!.userId).toBe('first-pair')
  })

  it('accepts /PAIR@MyBot 123456 (case-insensitive)', async () => {
    const { commands, harness } = buildCommands({ ownerOnly: false, owners: [] })
    const adapter = makeAdapter()
    await commands.handleCommand(
      adapter,
      buildMsg({ text: '/PAIR@MyBot 123456', senderId: 'first-pair' }),
    )
    expect(adapter.sent.some((s) => s.includes('Paired with'))).toBe(true)
    expect(harness.seeded[0]!.userId).toBe('first-pair')
  })
})

describe('Commands.handle (unbound text path) — free-form gate', () => {
  it('rejects non-command text from non-owner with friendly reply + pending entry', async () => {
    const { commands, store } = buildCommands({
      ownerOnly: true,
      owners: [{ userId: 'owner-1', addedAt: 0 }],
    })
    void store
    const adapter = makeAdapter()
    await commands.handle(adapter, buildMsg({ text: 'hi', senderId: 'stranger' }))
    expect(adapter.sent.length).toBe(1)
    expect(adapter.sent[0]).toContain('private')
  })

  it('lets owner free-form text through to the help prompt', async () => {
    const { commands } = buildCommands({
      ownerOnly: true,
      owners: [{ userId: 'owner-1', addedAt: 0 }],
    })
    const adapter = makeAdapter()
    await commands.handle(adapter, buildMsg({ text: 'hi', senderId: 'owner-1' }))
    expect(adapter.sent.some((s) => s.includes('No session bound'))).toBe(true)
    expect(adapter.sent.some((s) => s.includes('private'))).toBe(false)
  })

  it('silent-drops bot senders from the unbound free-form path', async () => {
    const { commands } = buildCommands({
      ownerOnly: true,
      owners: [{ userId: 'owner-1', addedAt: 0 }],
    })
    const adapter = makeAdapter()
    await commands.handle(
      adapter,
      buildMsg({ text: 'hi', senderId: 'bot-id', senderIsBot: true }),
    )
    expect(adapter.sent.length).toBe(0)
  })

  it('open workspace lets free-form non-owner text through (legacy / migration)', async () => {
    const { commands } = buildCommands({ ownerOnly: false, owners: [] })
    const adapter = makeAdapter()
    await commands.handle(adapter, buildMsg({ text: 'hi', senderId: 'stranger' }))
    expect(adapter.sent.some((s) => s.includes('No session bound'))).toBe(true)
  })
})
