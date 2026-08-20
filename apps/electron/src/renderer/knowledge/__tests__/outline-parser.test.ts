/**
 * Tests for parseOutline — the pure markdown-heading index behind the
 * inspector OUTLINE section. Covers heading levels, closing-hash trimming,
 * fence skipping, the ATX space rule, depth > 6, and the render cap.
 */
import { describe, it, expect } from 'bun:test'
import { parseOutline } from '../outline-parser'

describe('parseOutline', () => {
  it('extracts ATX headings with levels and 0-based line numbers', () => {
    const md = '# Title\n\nsome prose\n\n## Section A\n\n### Sub A.1\ntail\n'
    expect(parseOutline(md)).toEqual([
      { level: 1, text: 'Title', line: 0 },
      { level: 2, text: 'Section A', line: 4 },
      { level: 3, text: 'Sub A.1', line: 6 },
    ])
  })

  it('covers the full depth range h1–h6', () => {
    const md = '# a\n## b\n### c\n#### d\n##### e\n###### f\n'
    expect(parseOutline(md).map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('strips closing hash runs and trims padding', () => {
    expect(parseOutline('##   Padded Heading  ##\n')).toEqual([
      { level: 2, text: 'Padded Heading', line: 0 },
    ])
    expect(parseOutline('# Sharp ###\n')).toEqual([{ level: 1, text: 'Sharp', line: 0 }])
  })

  it('rejects non-headings: no space after #, depth > 6, plain prose', () => {
    expect(parseOutline('#Tag\n####### too deep\njust text\n')).toEqual([])
  })

  it('skips headings-like lines inside fenced code blocks', () => {
    const md = '```md\n# not a heading\n```\n# Real\n~~~\n## also not\n~~~\n## Real Too\n'
    expect(parseOutline(md)).toEqual([
      { level: 1, text: 'Real', line: 3 },
      { level: 2, text: 'Real Too', line: 7 },
    ])
  })

  it('treats an unclosed fence as running to end of document', () => {
    expect(parseOutline('# Before\n```\n# swallowed\n## swallowed too\n')).toEqual([
      { level: 1, text: 'Before', line: 0 },
    ])
  })

  it('skips headings whose title is empty or only closing hashes', () => {
    expect(parseOutline('# \n## ##\n# Kept\n')).toEqual([{ level: 1, text: 'Kept', line: 2 }])
  })

  it('returns an empty list for empty input', () => {
    expect(parseOutline('')).toEqual([])
  })

  it('honours the heading cap for very long documents', () => {
    const md = Array.from({ length: 150 }, (_, i) => `# h${i}`).join('\n')
    expect(parseOutline(md)).toHaveLength(100)
    expect(parseOutline(md, 2)).toHaveLength(2)
  })
})
