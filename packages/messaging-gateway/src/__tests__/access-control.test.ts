/**
 * access-control — permission evaluator.
 * Legacy missing/open/inherit modes must become public-inbox, never tool routing.
 */

import { describe, expect, it } from 'bun:test'
import {
  buildRejectionReply,
  evaluateBindingAccess,
  evaluatePreBindingAccess,
  readPlatformAccessMode,
} from '../access-control'
import {
  normalizeBindingConfig,
  normalizeMessagingAccessMode,
  type BindingConfig,
  type IncomingMessage,
  type MessagingAccessMode,
  type MessagingConfig,
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
  accessMode?: MessagingAccessMode | 'open' | 'owner-only'
  owners?: PlatformOwner[]
  platform?: IncomingMessage['platform']
}): MessagingConfig {
  const platform = args.platform ?? 'telegram'
  return {
    enabled: true,
    platforms: {
      [platform]: {
        enabled: true,
        ...(args.accessMode ? { accessMode: args.accessMode as MessagingAccessMode } : {}),
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

describe('normalizeMessagingAccessMode', () => {
  it('maps every legacy missing/open/inherit value to public-inbox', () => {
    expect(normalizeMessagingAccessMode(undefined)).toBe('public-inbox')
    expect(normalizeMessagingAccessMode('open')).toBe('public-inbox')
    expect(normalizeMessagingAccessMode('inherit')).toBe('public-inbox')
  })

  it('maps owner-only and allow-list to owner-control', () => {
    expect(normalizeMessagingAccessMode('owner-only')).toBe('owner-control')
    expect(normalizeMessagingAccessMode('allow-list')).toBe('owner-control')
    expect(normalizeMessagingAccessMode('owner-control')).toBe('owner-control')
  })
})

describe('evaluatePreBindingAccess', () => {
  it('legacy open/missing is public-inbox, not route', () => {
    for (const accessMode of [undefined, 'open'] as const) {
      const verdict = evaluatePreBindingAccess({
        msg: buildMsg({ senderId: STRANGER_ID }),
        workspaceConfig: buildConfig(accessMode ? { accessMode } : {}),
      })
      expect(verdict).toEqual({ kind: 'public-inbox' })
    }
  })

  it('public-inbox is the same on every platform', () => {
    for (const platform of ['telegram', 'whatsapp', 'lark', 'discord', 'wechat'] as const) {
      const verdict = evaluatePreBindingAccess({
        msg: buildMsg({ platform, senderId: STRANGER_ID }),
        workspaceConfig: buildConfig({ platform }),
      })
      expect(verdict.kind).toBe('public-inbox')
      expect(readPlatformAccessMode(buildConfig({ platform }), platform)).toBe('public-inbox')
    }
  })

  it('owner-control routes owners and rejects strangers', () => {
    expect(evaluatePreBindingAccess({
      msg: buildMsg({ senderId: OWNER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-control', owners: [OWNER] }),
    })).toEqual({ kind: 'route' })
    expect(evaluatePreBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-only', owners: [OWNER] }),
    })).toEqual({ kind: 'reject', reason: 'not-owner' })
  })

  it('rejects bots and disabled platforms', () => {
    expect(evaluatePreBindingAccess({
      msg: buildMsg({ senderIsBot: true }),
      workspaceConfig: buildConfig({ accessMode: 'open' }),
    })).toEqual({ kind: 'reject', reason: 'bot-sender' })
    expect(evaluatePreBindingAccess({
      msg: buildMsg({ senderId: OWNER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'disabled', owners: [OWNER] }),
    })).toEqual({ kind: 'reject', reason: 'disabled' })
  })
})

describe('evaluateBindingAccess', () => {
  it('legacy open/inherit binding cannot make an unknown sender tool-capable', () => {
    for (const accessMode of ['open', 'inherit'] as const) {
      const verdict = evaluateBindingAccess({
        msg: buildMsg({ senderId: STRANGER_ID }),
        workspaceConfig: buildConfig({ accessMode: 'open' }),
        binding: bindingWith({ accessMode: accessMode as never }),
      })
      expect(verdict.kind).not.toBe('route')
      expect(verdict.kind).toBe('public-inbox')
    }
  })

  it('owner-control plus allow-list routes only listed senders', () => {
    expect(evaluateBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-control', owners: [OWNER] }),
      binding: bindingWith({ accessMode: 'allow-list' as never, allowedSenderIds: [STRANGER_ID] }),
    })).toEqual({ kind: 'route' })
    expect(evaluateBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-control', owners: [OWNER] }),
      binding: bindingWith({ accessMode: 'owner-control', allowedSenderIds: [OWNER_ID] }),
    })).toEqual({ kind: 'reject', reason: 'not-allowlisted' })
  })

  it('owner-control on discord routes a listed owner', () => {
    expect(evaluateBindingAccess({
      msg: buildMsg({ platform: 'discord', senderId: OWNER_ID }),
      workspaceConfig: buildConfig({ platform: 'discord', accessMode: 'owner-control', owners: [OWNER] }),
      binding: bindingWith({ accessMode: 'owner-control', allowedSenderIds: [] }),
    })).toEqual({ kind: 'route' })
  })

  it('owner-control without a sender list uses workspace owners', () => {
    expect(evaluateBindingAccess({
      msg: buildMsg({ senderId: OWNER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-control', owners: [OWNER] }),
      binding: bindingWith({ accessMode: 'owner-control', allowedSenderIds: [] }),
    })).toEqual({ kind: 'route' })
    expect(evaluateBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-control', owners: [OWNER] }),
      binding: bindingWith({ accessMode: 'owner-control', allowedSenderIds: [] }),
    })).toEqual({ kind: 'reject', reason: 'not-owner' })
  })
})

describe('normalizeBindingConfig migration', () => {
  it('persisted config without accessMode becomes public-inbox', () => {
    const normalized = normalizeBindingConfig('telegram', { responseMode: 'progress', streamResponses: true })
    expect(normalized.accessMode).toBe('public-inbox')
  })

  it('fresh BindingConfig defaults to owner-control', () => {
    expect(normalizeBindingConfig('telegram').accessMode).toBe('owner-control')
  })

  it('legacy inherit/open persist as public-inbox', () => {
    expect(normalizeBindingConfig('telegram', { accessMode: 'inherit' as never }).accessMode).toBe('public-inbox')
    expect(normalizeBindingConfig('telegram', { accessMode: 'open' as never }).accessMode).toBe('public-inbox')
  })

  it('fresh bindings on every platform write owner-control, never open', () => {
    for (const platform of ['telegram', 'whatsapp', 'lark', 'discord', 'wechat'] as const) {
      expect(normalizeBindingConfig(platform).accessMode).toBe('owner-control')
    }
  })
})

describe('buildRejectionReply', () => {
  it('returns null for bot-sender (silent drop)', () => {
    expect(buildRejectionReply('bot-sender')).toBeNull()
  })

  it('returns user-friendly text for not-owner', () => {
    expect(buildRejectionReply('not-owner')).toContain('private')
  })
})
