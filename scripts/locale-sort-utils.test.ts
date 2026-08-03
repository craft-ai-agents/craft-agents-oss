import { describe, expect, it } from 'bun:test'
import { localeFormattingMatches } from './locale-sort-utils'

describe('localeFormattingMatches', () => {
  it('treats a CRLF checkout as equivalent to canonical LF formatting', () => {
    const checkedOut = '{\r\n  "a": "A"\r\n}\r\n'
    const canonical = '{\n  "a": "A"\n}\n'

    expect(localeFormattingMatches(checkedOut, canonical)).toBe(true)
  })
})
