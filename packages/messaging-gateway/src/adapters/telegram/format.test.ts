import { describe, expect, it } from 'bun:test'
import { TELEGRAM_PARSE_MODE, prepareTelegramText, sanitizeTelegramHtml } from './format'

describe('prepareTelegramText', () => {
  it('keeps plain text untouched by default', () => {
    expect(prepareTelegramText('**bold** <b>tag</b>')).toEqual({ text: '**bold** <b>tag</b>' })
  })

  it('uses HTML parse mode only when explicitly requested', () => {
    expect(prepareTelegramText('<b>bold</b>', { format: 'html' })).toEqual({
      text: '<b>bold</b>',
      parseMode: TELEGRAM_PARSE_MODE,
    })
  })
})

describe('sanitizeTelegramHtml', () => {
  it('preserves supported Telegram HTML tags', () => {
    expect(sanitizeTelegramHtml('already <b>bold</b> and <i>italic</i>')).toBe(
      'already <b>bold</b> and <i>italic</i>',
    )
  })

  it('escapes unsupported raw HTML', () => {
    expect(sanitizeTelegramHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
  })

  it('sanitizes invalid links instead of preserving raw anchors', () => {
    expect(sanitizeTelegramHtml('<a href="javascript:alert(1)">bad</a>')).toBe(
      '&lt;a href="javascript:alert(1)"&gt;bad</a>',
    )
  })
})
