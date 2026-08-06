/**
 * LarkAdapter tests — focused on pure / unit-testable surface.
 *
 * The full adapter relies on Lark's WSClient (long-polling socket) and a
 * concrete `Client` instance, neither of which can be exercised in a unit
 * test without integration infrastructure. These tests cover the credential
 * parser and confirm the adapter's static contract (capabilities, platform).
 *
 * End-to-end behaviour (event dispatch, send/edit roundtrips) is verified
 * via manual smoke against a real Lark Custom App.
 */
import { describe, expect, it } from 'bun:test'
import { parseLarkCredentials, LarkAdapter } from '../adapters/lark/index'

describe('parseLarkCredentials', () => {
  it('parses a valid JSON-encoded credential blob', () => {
    const creds = parseLarkCredentials(
      JSON.stringify({ appId: 'cli_abc', appSecret: 'secret', domain: 'lark' }),
    )
    expect(creds.appId).toBe('cli_abc')
    expect(creds.appSecret).toBe('secret')
    expect(creds.domain).toBe('lark')
  })

  it('accepts feishu domain', () => {
    const creds = parseLarkCredentials(
      JSON.stringify({ appId: 'cli_abc', appSecret: 'x', domain: 'feishu' }),
    )
    expect(creds.domain).toBe('feishu')
  })

  it('throws on missing token', () => {
    expect(() => parseLarkCredentials(undefined)).toThrow(/missing/i)
    expect(() => parseLarkCredentials('')).toThrow(/missing/i)
  })

  it('throws on non-JSON input', () => {
    expect(() => parseLarkCredentials('not-json')).toThrow(/JSON/i)
  })

  it('throws on missing appId or appSecret', () => {
    expect(() =>
      parseLarkCredentials(JSON.stringify({ appSecret: 'x', domain: 'lark' })),
    ).toThrow(/appId/i)
    expect(() =>
      parseLarkCredentials(JSON.stringify({ appId: 'cli_x', domain: 'lark' })),
    ).toThrow(/appSecret/i)
  })

  it('throws on invalid domain', () => {
    expect(() =>
      parseLarkCredentials(JSON.stringify({ appId: 'cli_x', appSecret: 'x', domain: 'larksuite' })),
    ).toThrow(/domain/i)
  })
})

describe('LarkAdapter — static contract', () => {
  it('declares platform = "lark"', () => {
    const adapter = new LarkAdapter()
    expect(adapter.platform).toBe('lark')
  })

  it('reports Phase 2 capabilities (edits, buttons, lark-post)', () => {
    const adapter = new LarkAdapter()
    expect(adapter.capabilities.messageEditing).toBe(true)
    expect(adapter.capabilities.inlineButtons).toBe(true)
    expect(adapter.capabilities.markdown).toBe('lark-post')
    expect(adapter.capabilities.maxButtons).toBe(10)
    expect(adapter.capabilities.webhookSupport).toBe(false)
  })

  it('starts disconnected before initialize', () => {
    const adapter = new LarkAdapter()
    expect(adapter.isConnected()).toBe(false)
  })
})
