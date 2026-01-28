/**
 * Tests for linkify.ts — URL/file-path detection and markdown link preprocessing.
 *
 * Focuses on the bug where preprocessLinks() would detect bare domains inside
 * the text portion of existing markdown links (e.g. [help.figma.com - Title](url))
 * and double-wrap them, producing broken nested markdown.
 */

import { describe, it, expect } from 'bun:test'
import { preprocessLinks, detectLinks } from '../linkify'

// ============================================================================
// preprocessLinks — existing markdown links should NOT be corrupted
// ============================================================================

describe('preprocessLinks', () => {
  describe('preserves existing markdown links', () => {
    it('does not wrap a domain inside markdown link text', () => {
      const input = '- [help.figma.com - Pan and zoom in FigJam](https://help.figma.com/hc/en-us/articles/123)'
      expect(preprocessLinks(input)).toBe(input)
    })

    it('does not wrap a full URL used as link text', () => {
      const input = '[https://example.com](https://example.com)'
      expect(preprocessLinks(input)).toBe(input)
    })

    it('does not wrap the href URL of a markdown link', () => {
      const input = '[Click here](https://example.com/page)'
      expect(preprocessLinks(input)).toBe(input)
    })

    it('preserves multiple markdown links in the same text', () => {
      const input = 'See [docs.github.com - Actions](https://docs.github.com/actions) and [api.stripe.com - Charges](https://api.stripe.com/charges)'
      expect(preprocessLinks(input)).toBe(input)
    })

    it('preserves markdown reference links', () => {
      const input = 'Check [example.com docs][ref1] for details'
      expect(preprocessLinks(input)).toBe(input)
    })

    it('preserves link with domain and extra description in text', () => {
      const input = '- [stackoverflow.com - How to fix React hydration errors](https://stackoverflow.com/questions/123)'
      expect(preprocessLinks(input)).toBe(input)
    })
  })

  describe('still wraps bare URLs that are not already linked', () => {
    it('wraps a bare URL', () => {
      const input = 'Visit https://example.com for more info'
      expect(preprocessLinks(input)).toBe('Visit [https://example.com](https://example.com) for more info')
    })

    it('wraps a bare domain', () => {
      const input = 'Check out example.com for details'
      expect(preprocessLinks(input)).toBe('Check out [example.com](http://example.com) for details')
    })

    it('wraps bare URL but preserves adjacent markdown link', () => {
      const input = 'See https://bare.example.com and [linked.example.com - Title](https://linked.example.com/page)'
      const result = preprocessLinks(input)
      // The bare URL should be wrapped
      expect(result).toContain('[https://bare.example.com](https://bare.example.com)')
      // The existing markdown link should be untouched
      expect(result).toContain('[linked.example.com - Title](https://linked.example.com/page)')
    })
  })

  describe('does not touch links inside code blocks', () => {
    it('skips URLs in fenced code blocks', () => {
      const input = '```\nhttps://example.com\n```'
      expect(preprocessLinks(input)).toBe(input)
    })

    it('skips URLs in inline code', () => {
      const input = 'Run `curl https://example.com` to test'
      expect(preprocessLinks(input)).toBe(input)
    })
  })
})

// ============================================================================
// detectLinks — basic detection sanity checks
// ============================================================================

describe('detectLinks', () => {
  it('detects a bare URL', () => {
    const links = detectLinks('Visit https://example.com today')
    expect(links).toHaveLength(1)
    expect(links[0].url).toBe('https://example.com')
    expect(links[0].type).toBe('url')
  })

  it('detects a bare domain', () => {
    const links = detectLinks('Check example.com')
    expect(links).toHaveLength(1)
    expect(links[0].type).toBe('url')
  })

  it('detects file paths', () => {
    const links = detectLinks('See /Users/foo/bar.ts for details')
    expect(links).toHaveLength(1)
    expect(links[0].type).toBe('file')
    expect(links[0].url).toBe('/Users/foo/bar.ts')
  })
})
