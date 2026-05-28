import { describe, it, expect } from 'bun:test'

import { WeChatAdapter, parseWeChatCredentials, sniffImageExt } from '../adapters/wechat/index'
import { stripMarkdownForWeChat } from '../adapters/wechat/format'
import { weixinMessageToMsgContext } from '../adapters/wechat/ilink/messaging/inbound'
import { MessageItemType } from '../adapters/wechat/ilink/api/types'
import type { WeixinMessage } from '../adapters/wechat/ilink/api/types'

describe('parseWeChatCredentials', () => {
  it('parses a valid credential blob', () => {
    const creds = parseWeChatCredentials(
      JSON.stringify({ accountId: 'bot-1', token: 'tok', baseUrl: 'https://x.example', userId: 'u1' }),
    )
    expect(creds.accountId).toBe('bot-1')
    expect(creds.token).toBe('tok')
    expect(creds.baseUrl).toBe('https://x.example')
    expect(creds.userId).toBe('u1')
  })

  it('defaults baseUrl to the iLink endpoint when omitted', () => {
    const creds = parseWeChatCredentials(JSON.stringify({ accountId: 'bot-1', token: 'tok' }))
    expect(creds.baseUrl).toBe('https://ilinkai.weixin.qq.com')
  })

  it('throws on invalid JSON', () => {
    expect(() => parseWeChatCredentials('not json')).toThrow()
  })

  it('throws when accountId or token is missing', () => {
    expect(() => parseWeChatCredentials(JSON.stringify({ token: 'tok' }))).toThrow(/accountId/)
    expect(() => parseWeChatCredentials(JSON.stringify({ accountId: 'bot-1' }))).toThrow(/token/)
  })
})

describe('stripMarkdownForWeChat', () => {
  it('strips bold, italic, and inline code', () => {
    expect(stripMarkdownForWeChat('**bold** and *italic* and `code`')).toBe('bold and italic and code')
  })

  it('converts links to "text (url)"', () => {
    expect(stripMarkdownForWeChat('see [docs](https://example.com)')).toBe('see docs (https://example.com)')
  })

  it('drops heading and blockquote markers', () => {
    expect(stripMarkdownForWeChat('# Title\n> quote')).toBe('Title\nquote')
  })

  it('keeps the inner text of fenced code blocks', () => {
    expect(stripMarkdownForWeChat('```js\nconst x = 1\n```')).toBe('const x = 1')
  })

  it('returns empty string for empty input', () => {
    expect(stripMarkdownForWeChat('')).toBe('')
  })
})

describe('WeChatAdapter static contract', () => {
  it('declares the wechat platform and conservative v1 capabilities', () => {
    const adapter = new WeChatAdapter()
    expect(adapter.platform).toBe('wechat')
    expect(adapter.capabilities.inlineButtons).toBe(false)
    expect(adapter.capabilities.messageEditing).toBe(false)
    expect(adapter.capabilities.markdown).toBe('wechat')
    expect(adapter.capabilities.webhookSupport).toBe(false)
  })

  it('is not connected before initialize()', () => {
    const adapter = new WeChatAdapter()
    expect(adapter.isConnected()).toBe(false)
  })
})

describe('weixinMessageToMsgContext (inbound text normalization)', () => {
  it('extracts plain text from a text item', () => {
    const msg: WeixinMessage = {
      from_user_id: 'u_abc',
      create_time_ms: 1700000000000,
      context_token: 'ctx-1',
      item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'hello agent' } }],
    }
    const ctx = weixinMessageToMsgContext(msg, 'bot-1')
    expect(ctx.Body).toBe('hello agent')
    expect(ctx.From).toBe('u_abc')
    expect(ctx.context_token).toBe('ctx-1')
    expect(ctx.ChatType).toBe('direct')
  })
})

describe('sniffImageExt (inbound image extension)', () => {
  it('detects JPEG / PNG / GIF / WebP magic bytes', () => {
    expect(sniffImageExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('.jpg')
    expect(sniffImageExt(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('.png')
    expect(sniffImageExt(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('.gif')
    expect(
      sniffImageExt(Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toBe('.webp')
  })

  it('returns undefined for non-image data so the caller can fall back', () => {
    expect(sniffImageExt(Buffer.from('hello world', 'utf-8'))).toBeUndefined()
  })
})
