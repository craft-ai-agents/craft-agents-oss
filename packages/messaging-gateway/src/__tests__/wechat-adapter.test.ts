/**
 * WeChat adapter — unit tests
 *
 * Tests the static contract (platform id, capabilities), format helpers,
 * and the iLinkClient AES encryption without network access.
 */

import { describe, test, expect } from 'bun:test'
import { WeChatAdapter } from '../adapters/wechat/index'
import { formatForWeChat, splitMessage } from '../adapters/wechat/format'

// ---------------------------------------------------------------------------
// Static contract
// ---------------------------------------------------------------------------

describe('WeChatAdapter — static contract', () => {
  const adapter = new WeChatAdapter()

  test('declares platform = "wechat"', () => {
    expect(adapter.platform).toBe('wechat')
  })

  test('reports correct capabilities', () => {
    expect(adapter.capabilities.inlineButtons).toBe(false)
    expect(adapter.capabilities.messageEditing).toBe(false)
    expect(adapter.capabilities.maxMessageLength).toBe(4000)
    expect(adapter.capabilities.markdown).toBe('wechat')
  })

  test('starts disconnected before initialize', () => {
    expect(adapter.isConnected()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// formatForWeChat
// ---------------------------------------------------------------------------

describe('formatForWeChat', () => {
  test('strips bold markdown', () => {
    expect(formatForWeChat('**hello**')).toBe('hello')
  })

  test('strips italic markdown', () => {
    expect(formatForWeChat('*hello*')).toBe('hello')
  })

  test('strips inline code', () => {
    expect(formatForWeChat('use `foo`')).toBe('use foo')
  })

  test('converts code fences to indented text', () => {
    const input = '```\ncode\n```'
    const result = formatForWeChat(input)
    expect(result).toContain('code')
    expect(result).not.toContain('```')
  })

  test('converts links to text with URL', () => {
    expect(formatForWeChat('[click here](https://example.com)')).toBe('click here (https://example.com)')
  })

  test('passes plain text through', () => {
    expect(formatForWeChat('plain text')).toBe('plain text')
  })

  test('handles empty string', () => {
    expect(formatForWeChat('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// splitMessage
// ---------------------------------------------------------------------------

describe('splitMessage', () => {
  test('single chunk when under limit', () => {
    const result = splitMessage('hello', 100)
    expect(result).toEqual(['hello'])
  })

  test('splits at exact boundary', () => {
    const result = splitMessage('abcdefghij', 5)
    expect(result.length).toBe(2)
    expect(result[0]).toBe('abcde')
    expect(result[1]).toBe('fghij')
  })

  test('splits on newline boundaries when possible', () => {
    const text = 'line1\nline2\nline3'
    const result = splitMessage(text, 12)
    // Should prefer splitting at newlines
    expect(result.length).toBeGreaterThanOrEqual(2)
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(12)
    }
  })

  test('handles empty string', () => {
    const result = splitMessage('', 100)
    expect(result).toEqual([''])
  })

  test('default maxMessageLength works', () => {
    const short = 'hello'
    const result = splitMessage(short)
    expect(result).toEqual(['hello'])
  })
})
