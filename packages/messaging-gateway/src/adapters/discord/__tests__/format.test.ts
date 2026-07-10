import { describe, it, expect } from 'bun:test'
import { formatForDiscord } from '../format'

describe('formatForDiscord', () => {
  it('passes plain text through unchanged', () => {
    expect(formatForDiscord('hello world')).toBe('hello world')
  })

  it('downgrades ATX headings to bold', () => {
    expect(formatForDiscord('# Title')).toBe('**Title**')
    expect(formatForDiscord('### Sub heading')).toBe('**Sub heading**')
  })

  it('preserves bold, italic, and inline code', () => {
    const input = 'a **bold** and *italic* and `code`'
    expect(formatForDiscord(input)).toBe(input)
  })

  it('does not rewrite heading-like lines inside fenced code blocks', () => {
    const input = ['```', '# not a heading', '```'].join('\n')
    expect(formatForDiscord(input)).toBe(input)
  })

  it('handles multiple lines with a mix of headings and text', () => {
    const input = ['# H1', 'body', '## H2', 'more'].join('\n')
    const expected = ['**H1**', 'body', '**H2**', 'more'].join('\n')
    expect(formatForDiscord(input)).toBe(expected)
  })

  it('drops an empty heading to an empty line', () => {
    expect(formatForDiscord('#   ')).toBe('')
  })
})
