/**
 * Outbound payload regression for `WeChatAdapter.sendText`.
 *
 * Targets the bug we hit on first integration: iLink returned 200 OK to
 * sendmessage but recipients never saw the message because we omitted
 * `message_state: FINISH`, `message_type: BOT`, and `client_id`. This test
 * pins the wire format so a future refactor can't silently break delivery
 * the same way.
 *
 * Strategy: mock global fetch to capture the JSON body, manually seed a
 * context_token (skipping the inbound flow), then invoke sendText and
 * verify the critical fields. We also test that sending without a cached
 * context_token throws with a clear message — the reactive-only contract.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WeChatAdapter } from '../adapter'
import { encodeClientVersion } from '../protocol/api'
import { MessageItemType, MessageState, MessageType } from '../protocol/types'
import type { WeChatCredentials } from '../index'

interface CapturedRequest {
  url: string
  method: string
  body: unknown
}

const cleanups: Array<() => void> = []

function makeTmpStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wechat-adapter-test-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

interface FetchHarness {
  captured: CapturedRequest[]
  restore: () => void
}

/**
 * Patch global fetch with one that records every request and replies with a
 * canned 200 + empty JSON. The adapter's long-poll loop hits this too, so
 * we filter on `label` / URL when asserting.
 */
function installFetchHarness(): FetchHarness {
  const captured: CapturedRequest[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as { url: string }).url
    let body: unknown = undefined
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    captured.push({ url, method: init?.method ?? 'GET', body })
    // Mimic the iLink long-poll: park getUpdates so the loop doesn't busy-spin.
    if (url.includes('/ilink/bot/getupdates')) {
      await new Promise((r) => setTimeout(r, 50))
      return new Response(JSON.stringify({ ret: 0, msgs: [], get_updates_buf: 'cursor' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return {
    captured,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

const credentials: WeChatCredentials = {
  botToken: 'test-bot-token',
  ilinkBotId: 'test-bot-id',
  ilinkUserId: 'test-user-id',
  baseUrl: 'https://example.invalid',
}

const adapterConfig = {
  token: JSON.stringify(credentials),
  identity: {
    appId: 'bot',
    channelVersion: '0.9.0',
    clientVersion: encodeClientVersion('0.9.0'),
  },
  stateDir: '',
}

describe('WeChatAdapter.sendText — outbound payload', () => {
  it('includes message_state=FINISH, message_type=BOT, client_id, and echoes context_token', async () => {
    const harness = installFetchHarness()
    cleanups.push(harness.restore)

    const adapter = new WeChatAdapter()
    await adapter.initialize({ ...adapterConfig, stateDir: makeTmpStateDir() })
    cleanups.push(() => {
      void adapter.destroy()
    })

    // Skip the inbound flow — seed the context_token cache directly so we
    // can drive sendText in isolation.
    const channelId = 'recipient@im.wechat'
    const contextToken = 'ctx-token-abc123'
    ;(adapter as unknown as {
      contextTokens: Map<string, string>
    }).contextTokens.set(channelId, contextToken)

    await adapter.sendText(channelId, 'hello')

    const sendCall = harness.captured.find((c) => c.url.includes('/ilink/bot/sendmessage'))
    expect(sendCall).toBeDefined()

    const msg = (sendCall!.body as { msg?: Record<string, unknown> })?.msg
    expect(msg).toBeDefined()
    // The four fields the iLink server requires for delivery — every one of
    // these being absent / wrong silently drops the message in production.
    expect(msg!.message_state).toBe(MessageState.FINISH)
    expect(msg!.message_type).toBe(MessageType.BOT)
    expect(typeof msg!.client_id).toBe('string')
    expect((msg!.client_id as string).length).toBeGreaterThan(0)
    expect(msg!.from_user_id).toBe('')
    expect(msg!.to_user_id).toBe(channelId)
    expect(msg!.context_token).toBe(contextToken)

    const items = msg!.item_list as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0]?.type).toBe(MessageItemType.TEXT)
    expect((items[0]?.text_item as { text?: string })?.text).toBe('hello')
  })

  it('throws when no context_token has been cached for the recipient', async () => {
    const harness = installFetchHarness()
    cleanups.push(harness.restore)

    const adapter = new WeChatAdapter()
    await adapter.initialize({ ...adapterConfig, stateDir: makeTmpStateDir() })
    cleanups.push(() => {
      void adapter.destroy()
    })

    await expect(adapter.sendText('unknown@im.wechat', 'hi')).rejects.toThrow(/context_token/)
  })
})
