import { describe, expect, it } from 'bun:test'
import { TELEGRAM_PARSE_MODE, formatForTelegram } from './format'

describe('formatForTelegram', () => {
  it('exports HTML parse mode', () => {
    expect(TELEGRAM_PARSE_MODE).toBe('HTML')
  })

  it('renders common markdown as Telegram HTML', () => {
    const formatted = formatForTelegram('# Title\n\n**bold** *italic* ~~strike~~ [link](https://example.com) `code`')

    expect(formatted).toContain('<b>Title</b>')
    expect(formatted).toContain('<b>bold</b>')
    expect(formatted).toContain('<i>italic</i>')
    expect(formatted).toContain('<s>strike</s>')
    expect(formatted).toContain('<a href="https://example.com/">link</a>')
    expect(formatted).toContain('<code>code</code>')
  })

  it('preserves supported Telegram HTML tags', () => {
    const formatted = formatForTelegram('already <b>bold</b> and <i>italic</i>')

    expect(formatted).toBe('already <b>bold</b> and <i>italic</i>')
  })

  it('renders fenced code blocks and escapes their contents', () => {
    const formatted = formatForTelegram('```ts\nconst x = 1 < 2 && 3 > 1\n```')

    expect(formatted).toBe('<pre><code>const x = 1 &lt; 2 &amp;&amp; 3 &gt; 1</code></pre>')
  })

  it('escapes unsupported raw HTML', () => {
    const formatted = formatForTelegram('<script>alert(1)</script>')

    expect(formatted).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})
