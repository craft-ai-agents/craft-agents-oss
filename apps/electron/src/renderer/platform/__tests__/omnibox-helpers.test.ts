import { describe, it, expect } from 'bun:test'
import { parsePrefix, scoreMatch, scoreMatchAny } from '../omnibox-helpers'

describe('parsePrefix', () => {
  it('returns empty prefix for plain text', () => {
    expect(parsePrefix('hello')).toEqual({ prefix: '', query: 'hello', raw: 'hello' })
  })

  it('parses command prefix >', () => {
    expect(parsePrefix('>new chat')).toEqual({ prefix: '>', query: 'new chat', raw: '>new chat' })
  })

  it('parses @ / ! ? # prefixes', () => {
    expect(parsePrefix('@mem').prefix).toBe('@')
    expect(parsePrefix('/skill').prefix).toBe('/')
    expect(parsePrefix('!auto').prefix).toBe('!')
    expect(parsePrefix('?full').prefix).toBe('?')
    expect(parsePrefix('#tag').prefix).toBe('#')
  })

  it('treats empty string as universal', () => {
    expect(parsePrefix('')).toEqual({ prefix: '', query: '', raw: '' })
  })

  it('escapes leading backslash-prefix into the query', () => {
    expect(parsePrefix('\\>literal')).toEqual({
      prefix: '',
      query: '>literal',
      raw: '\\>literal',
    })
  })

  it('keeps query after prefix including spaces', () => {
    expect(parsePrefix('>  spaced')).toEqual({
      prefix: '>',
      query: '  spaced',
      raw: '>  spaced',
    })
  })
})

describe('scoreMatch', () => {
  it('returns 0 for empty query or target', () => {
    expect(scoreMatch('hello', '')).toBe(0)
    expect(scoreMatch('', 'hello')).toBe(0)
  })

  it('scores exact match highest', () => {
    expect(scoreMatch('Settings', 'settings')).toBe(1)
  })

  it('scores starts-with above substring', () => {
    const start = scoreMatch('New Chat', 'new')
    const sub = scoreMatch('Open New Chat', 'chat')
    expect(start).toBeGreaterThan(0.8)
    expect(sub).toBeGreaterThan(0)
    expect(start).toBeGreaterThan(sub)
  })

  it('matches word boundary', () => {
    expect(scoreMatch('Open Cloud Runs', 'cloud')).toBe(0.75)
  })

  it('falls back to subsequence', () => {
    const s = scoreMatch('keyboard', 'kbd')
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(0.5)
  })

  it('returns 0 when nothing matches', () => {
    expect(scoreMatch('abc', 'xyz')).toBe(0)
  })
})

describe('scoreMatchAny', () => {
  it('returns the best score across candidates', () => {
    expect(scoreMatchAny(['zzz', 'Settings', null], 'set')).toBeGreaterThan(0.5)
  })
})
