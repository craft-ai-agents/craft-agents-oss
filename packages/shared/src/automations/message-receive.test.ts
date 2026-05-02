import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AutomationSystem } from './automation-system.ts'
import { matcherMatches } from './utils.ts'
import type { AutomationMatcher } from './types.ts'
import type { MessageReceivePayload } from './event-bus.ts'

function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'craft-msg-test-'))
}

describe('MessageReceive — AutomationSystem integration', () => {
  test('fires the event on the workspace bus with full payload', async () => {
    const dir = tmpWorkspace()
    try {
      const system = new AutomationSystem({
        workspaceRootPath: dir,
        workspaceId: 'ws-1',
      })

      const received: MessageReceivePayload[] = []
      system.eventBus.on('MessageReceive', async (p) => { received.push(p) })

      await system.fireMessageReceive({
        platform: 'whatsapp',
        channelId: 'chat-42',
        messageId: 'm-1',
        senderId: '+15551234567',
        senderName: 'Mikey',
        text: 'process this please',
        bound: false,
        wasBound: false,
        boundAfterRoute: true,
        attachmentCount: 1,
        sentAt: 1714560000000,
      })

      expect(received).toHaveLength(1)
      const ev = received[0]!
      expect(ev.platform).toBe('whatsapp')
      expect(ev.channelId).toBe('chat-42')
      expect(ev.text).toBe('process this please')
      expect(ev.bound).toBe(false)
      expect(ev.wasBound).toBe(false)
      expect(ev.boundAfterRoute).toBe(true)
      expect(ev.attachmentCount).toBe(1)
      expect(ev.hasAttachment).toBe(true)
      expect(ev.workspaceId).toBe('ws-1')

      await system.dispose()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('MessageReceive — matcher behavior', () => {
  test('matcher regex matches against message text', () => {
    const matcher: AutomationMatcher = {
      id: 'm1',
      matcher: '^/triage\\b',
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const matchPayload = (text: string): Record<string, unknown> => ({
      platform: 'telegram',
      channelId: 'c1',
      messageId: 'm',
      senderId: 's',
      senderName: null,
      text,
      bound: false,
      attachmentCount: 0,
      hasAttachment: false,
      sentAt: 0,
      workspaceId: 'w',
      timestamp: 0,
    })

    expect(matcherMatches(matcher, 'MessageReceive', matchPayload('/triage urgent'))).toBe(true)
    expect(matcherMatches(matcher, 'MessageReceive', matchPayload('hello world'))).toBe(false)
  })

  test('state condition on `bound` filters un-bound messages only', () => {
    const matcher: AutomationMatcher = {
      id: 'm1',
      conditions: [{ condition: 'state', field: 'bound', value: false }],
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const buildPayload = (bound: boolean): Record<string, unknown> => ({
      platform: 'whatsapp',
      channelId: 'c1',
      messageId: 'm',
      senderId: 's',
      senderName: null,
      text: 'hi',
      bound,
      attachmentCount: 0,
      hasAttachment: false,
      sentAt: 0,
      workspaceId: 'w',
      timestamp: 0,
    })

    expect(matcherMatches(matcher, 'MessageReceive', buildPayload(false))).toBe(true)
    expect(matcherMatches(matcher, 'MessageReceive', buildPayload(true))).toBe(false)
  })

  test('state condition on `platform` filters by adapter', () => {
    const matcher: AutomationMatcher = {
      id: 'm1',
      conditions: [{ condition: 'state', field: 'platform', value: 'whatsapp' }],
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const buildPayload = (platform: string): Record<string, unknown> => ({
      platform,
      channelId: 'c',
      messageId: 'm',
      senderId: 's',
      senderName: null,
      text: 'x',
      bound: false,
      attachmentCount: 0,
      hasAttachment: false,
      sentAt: 0,
      workspaceId: 'w',
      timestamp: 0,
    })
    expect(matcherMatches(matcher, 'MessageReceive', buildPayload('whatsapp'))).toBe(true)
    expect(matcherMatches(matcher, 'MessageReceive', buildPayload('telegram'))).toBe(false)
  })
})

describe('FileWatch/PollUrl direct emit matcher routing', () => {
  test('FileWatch requires an exact payload matcherId', () => {
    const matcher: AutomationMatcher = {
      id: 'fw-1',
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const basePayload = {
      workspaceId: 'w',
      timestamp: 0,
      path: '/tmp/a.md',
      relativePath: 'a.md',
      changeType: 'add',
      size: 1,
      isDirectory: false,
    }

    expect(matcherMatches(matcher, 'FileWatch', { ...basePayload, matcherId: 'fw-1' })).toBe(true)
    expect(matcherMatches(matcher, 'FileWatch', { ...basePayload, matcherId: 'fw-2' })).toBe(false)
    expect(matcherMatches(matcher, 'FileWatch', basePayload)).toBe(false)
    expect(matcherMatches(matcher, 'FileWatch', { ...basePayload, matcherId: 42 })).toBe(false)
  })

  test('PollUrl requires an exact payload matcherId', () => {
    const matcher: AutomationMatcher = {
      id: 'poll-1',
      actions: [{ type: 'prompt', prompt: 'noop' }],
    }
    const basePayload = {
      workspaceId: 'w',
      timestamp: 0,
      url: 'https://example.com',
      status: 200,
      fingerprintKind: 'status',
      fingerprint: '200',
      previousFingerprint: null,
      body: null,
      headers: {},
    }

    expect(matcherMatches(matcher, 'PollUrl', { ...basePayload, matcherId: 'poll-1' })).toBe(true)
    expect(matcherMatches(matcher, 'PollUrl', { ...basePayload, matcherId: 'poll-2' })).toBe(false)
    expect(matcherMatches(matcher, 'PollUrl', basePayload)).toBe(false)
    expect(matcherMatches(matcher, 'PollUrl', { ...basePayload, matcherId: '' })).toBe(false)
  })
})
