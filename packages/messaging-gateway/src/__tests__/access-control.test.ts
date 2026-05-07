/**
 * access-control — unit tests for the pure permission evaluator.
 *
 * Exhaustive matrix over (workspace mode, binding mode, sender state).
 * Drives both `evaluatePreBindingAccess` (used by Commands) and
 * `evaluateBindingAccess` (used by Router).
 */

import { describe, expect, it } from 'bun:test'
import {
  buildRejectionReply,
  evaluateBindingAccess,
  evaluatePreBindingAccess,
} from '../access-control'
import {
  normalizeBindingConfig,
  type BindingConfig,
  type IncomingMessage,
  type MessagingConfig,
  type PlatformAccessMode,
  type PlatformOwner,
} from '../types'

const OWNER_ID = '111'
const STRANGER_ID = '999'

function buildMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    platform: 'telegram',
    channelId: 'chat-1',
    messageId: 'm1',
    senderId: OWNER_ID,
    text: 'hi',
    timestamp: Date.now(),
    raw: {},
    ...overrides,
  }
}

function buildConfig(args: {
  accessMode?: PlatformAccessMode
  owners?: PlatformOwner[]
}): MessagingConfig {
  return {
    enabled: true,
    platforms: {
      telegram: {
        enabled: true,
        ...(args.accessMode ? { accessMode: args.accessMode } : {}),
        ...(args.owners ? { owners: args.owners } : {}),
      },
    },
  }
}

function bindingWith(overrides: Partial<BindingConfig> = {}) {
  return {
    config: normalizeBindingConfig('telegram', overrides),
  }
}

const OWNER: PlatformOwner = { userId: OWNER_ID, addedAt: 0 }

// ---------------------------------------------------------------------------
// Pre-binding (Commands) tests
// ---------------------------------------------------------------------------

describe('evaluatePreBindingAccess', () => {
  it('open mode allows any non-bot sender', () => {
    const verdict = evaluatePreBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'open' }),
    })
    expect(verdict.allow).toBe(true)
  })

  it('owner-only mode allows owners', () => {
    const verdict = evaluatePreBindingAccess({
      msg: buildMsg({ senderId: OWNER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-only', owners: [OWNER] }),
    })
    expect(verdict.allow).toBe(true)
  })

  it('owner-only mode rejects non-owners with reason "not-owner"', () => {
    const verdict = evaluatePreBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-only', owners: [OWNER] }),
    })
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('not-owner')
  })

  it('rejects bot senders with reason "bot-sender" regardless of mode', () => {
    const verdict = evaluatePreBindingAccess({
      msg: buildMsg({ senderId: OWNER_ID, senderIsBot: true }),
      workspaceConfig: buildConfig({ accessMode: 'open' }),
    })
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('bot-sender')
  })

  it('owner-only with empty owners list rejects every non-bot sender', () => {
    // Edge case: locked-down workspace with no owners is effectively
    // unusable until /pair seeds the first owner. The evaluator is
    // strict — bootstrap concerns live in handlePair, not here.
    const verdict = evaluatePreBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-only', owners: [] }),
    })
    expect(verdict.allow).toBe(false)
  })

  it('missing accessMode defaults to "open"', () => {
    const verdict = evaluatePreBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({}),
    })
    expect(verdict.allow).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Bound-channel (Router) tests
// ---------------------------------------------------------------------------

describe('evaluateBindingAccess', () => {
  it('binding accessMode "open" allows any non-bot sender', () => {
    const verdict = evaluateBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-only', owners: [OWNER] }),
      binding: bindingWith({ accessMode: 'open' }),
    })
    expect(verdict.allow).toBe(true)
  })

  it('binding "allow-list" accepts ids in allowedSenderIds', () => {
    const verdict = evaluateBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-only', owners: [OWNER] }),
      binding: bindingWith({
        accessMode: 'allow-list',
        allowedSenderIds: [STRANGER_ID],
      }),
    })
    expect(verdict.allow).toBe(true)
  })

  it('binding "allow-list" rejects ids outside the list', () => {
    const verdict = evaluateBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-only', owners: [OWNER] }),
      binding: bindingWith({
        accessMode: 'allow-list',
        allowedSenderIds: [OWNER_ID],
      }),
    })
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('not-on-binding-allowlist')
  })

  it('binding "inherit" defers to workspace owners (allow path)', () => {
    const verdict = evaluateBindingAccess({
      msg: buildMsg({ senderId: OWNER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-only', owners: [OWNER] }),
      binding: bindingWith({ accessMode: 'inherit' }),
    })
    expect(verdict.allow).toBe(true)
  })

  it('binding "inherit" defers to workspace owners (reject path)', () => {
    const verdict = evaluateBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-only', owners: [OWNER] }),
      binding: bindingWith({ accessMode: 'inherit' }),
    })
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('not-owner')
  })

  it('binding "inherit" with workspace "open" allows everyone (legacy behaviour)', () => {
    const verdict = evaluateBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'open' }),
      binding: bindingWith({ accessMode: 'inherit' }),
    })
    expect(verdict.allow).toBe(true)
  })

  it('rejects bot senders before any access mode logic runs', () => {
    const verdict = evaluateBindingAccess({
      msg: buildMsg({ senderId: OWNER_ID, senderIsBot: true }),
      workspaceConfig: buildConfig({ accessMode: 'open' }),
      binding: bindingWith({ accessMode: 'open' }),
    })
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('bot-sender')
  })
})

// ---------------------------------------------------------------------------
// Migration: legacy bindings (no accessMode field) default to 'open'
// ---------------------------------------------------------------------------

describe('normalizeBindingConfig migration', () => {
  it('persisted config without accessMode defaults to "open"', () => {
    const raw = { responseMode: 'progress', streamResponses: true } as Partial<BindingConfig>
    const normalized = normalizeBindingConfig('telegram', raw)
    expect(normalized.accessMode).toBe('open')
    expect(normalized.allowedSenderIds).toEqual([])
  })

  it('fresh BindingConfig (undefined) defaults to "inherit"', () => {
    const normalized = normalizeBindingConfig('telegram')
    expect(normalized.accessMode).toBe('inherit')
  })

  it('explicit accessMode is preserved across normalisation', () => {
    const normalized = normalizeBindingConfig('telegram', {
      accessMode: 'allow-list',
      allowedSenderIds: ['42'],
    })
    expect(normalized.accessMode).toBe('allow-list')
    expect(normalized.allowedSenderIds).toEqual(['42'])
  })
})

// ---------------------------------------------------------------------------
// Reject reply copy
// ---------------------------------------------------------------------------

describe('buildRejectionReply', () => {
  it('returns null for bot-sender (silent drop)', () => {
    expect(buildRejectionReply('bot-sender')).toBeNull()
  })

  it('returns user-friendly text for not-owner', () => {
    const text = buildRejectionReply('not-owner')
    expect(text).toBeTruthy()
    expect(text).toContain('private')
  })

  it('returns user-friendly text for not-on-binding-allowlist', () => {
    const text = buildRejectionReply('not-on-binding-allowlist')
    expect(text).toBeTruthy()
    expect(text).toContain('allow-list')
  })
})
