import { describe, expect, it } from 'bun:test'
import {
  TELEGRAM_PARSE_MODE,
  prepareTelegramText,
  sanitizeTelegramHtml,
  telegramHtmlToPlainText,
} from './format'

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

  it('preserves existing HTML entities', () => {
    expect(sanitizeTelegramHtml('<b>AT&amp;T &lt;3</b>')).toBe('<b>AT&amp;T &lt;3</b>')
  })

  it('preserves language-qualified code tags in Telegram HTML', () => {
    expect(sanitizeTelegramHtml('<pre><code class="language-ts">const x = 1;</code></pre>')).toBe(
      '<pre><code>const x = 1;</code></pre>',
    )
  })

  it('escapes unsupported named HTML entities', () => {
    expect(sanitizeTelegramHtml('<b>&nbsp;</b>')).toBe('<b>&amp;nbsp;</b>')
  })

  it('does not throw on invalid numeric entities in plain-text fallback', () => {
    expect(telegramHtmlToPlainText('&#999999999;')).toBe('&#999999999;')
  })

  it('preserves link destinations in plain-text fallback', () => {
    expect(telegramHtmlToPlainText('<a href="https://example.com">click here</a>')).toBe(
      'click here (https://example.com/)',
    )
  })

  it('escapes unsupported raw HTML', () => {
    expect(sanitizeTelegramHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
  })

  it('sanitizes invalid links instead of preserving raw anchors', () => {
    expect(sanitizeTelegramHtml('<a href="javascript:alert(1)">bad</a>')).toBe(
      '&lt;a href="javascript:alert(1)"&gt;bad&lt;/a&gt;',
    )
  })

  it('escapes unmatched closing tags', () => {
    expect(sanitizeTelegramHtml('oops </b>')).toBe('oops &lt;/b&gt;')
  })

  it('falls back to escaped plain text for unclosed supported tags', () => {
    expect(sanitizeTelegramHtml('<b>oops')).toBe('&lt;b&gt;oops')
  })

  it('falls back to escaped plain text for mismatched nesting', () => {
    expect(sanitizeTelegramHtml('<b><i>x</b></i>')).toBe('&lt;b&gt;&lt;i&gt;x&lt;/b&gt;&lt;/i&gt;')
  })
}

)
