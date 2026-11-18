import { describe, it, expect } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import {
  classifyMarkdownLinkTarget,
  describeFileLinkClick,
  resolveMarkdownLinkTarget,
  type FileLinkClickEvent,
} from '../link-target'
import { markdownUrlTransform } from '../url-transform'

describe('resolveMarkdownLinkTarget', () => {
  it('resolves absolute unix file paths as file targets', () => {
    expect(resolveMarkdownLinkTarget('/Users/balintorosz/.craft-agent/sessions/abc/image.jpg')).toEqual({
      kind: 'file',
      path: '/Users/balintorosz/.craft-agent/sessions/abc/image.jpg',
    })
  })

  it('resolves parent-relative file paths as file targets', () => {
    expect(resolveMarkdownLinkTarget('../downloads/assets/screenshot.png')).toEqual({
      kind: 'file',
      path: '../downloads/assets/screenshot.png',
    })
  })

  it('resolves repo-relative file paths as file targets', () => {
    expect(resolveMarkdownLinkTarget('apps/electron/resources/docs/browser-tools.md')).toEqual({
      kind: 'file',
      path: 'apps/electron/resources/docs/browser-tools.md',
    })
  })

  it('resolves unix file URLs as file targets', () => {
    expect(resolveMarkdownLinkTarget('file:///Users/tester/report.xlsx')).toEqual({
      kind: 'file',
      path: '/Users/tester/report.xlsx',
    })
  })

  it('decodes percent-encoded unix file URLs', () => {
    expect(resolveMarkdownLinkTarget('file:///Users/tester/report%20final.pdf')).toEqual({
      kind: 'file',
      path: '/Users/tester/report final.pdf',
    })
  })

  it('decodes a percent-encoded space in a BARE local file path (#944)', () => {
    expect(resolveMarkdownLinkTarget('/Users/tester/My%20Docs/report%20final.pptx')).toEqual({
      kind: 'file',
      path: '/Users/tester/My Docs/report final.pptx',
    })
  })

  it('leaves a bare path with an invalid percent-sequence untouched (#944)', () => {
    expect(resolveMarkdownLinkTarget('/Users/tester/100%done/notes.md')).toEqual({
      kind: 'file',
      path: '/Users/tester/100%done/notes.md',
    })
  })

  it('normalizes windows drive-letter file URLs to local paths', () => {
    expect(resolveMarkdownLinkTarget('file:///C:/Users/Tester/Deck.pptx')).toEqual({
      kind: 'file',
      path: 'C:/Users/Tester/Deck.pptx',
    })
  })

  it('resolves https links as url targets', () => {
    expect(resolveMarkdownLinkTarget('https://example.com/image.jpg')).toEqual({
      kind: 'url',
      url: 'https://example.com/image.jpg',
    })
  })

  it('resolves mailto links as url targets', () => {
    expect(resolveMarkdownLinkTarget('mailto:test@example.com')).toEqual({
      kind: 'url',
      url: 'mailto:test@example.com',
    })
  })
})

describe('markdownUrlTransform', () => {
  it('preserves dangerous anchor hrefs for custom click routing', () => {
    const anchorNode = { tagName: 'a' }
    expect(markdownUrlTransform('file:///tmp/test.md', 'href', anchorNode as never)).toBe('file:///tmp/test.md')
    expect(markdownUrlTransform('javascript:alert(1)', 'href', anchorNode as never)).toBe('javascript:alert(1)')
  })

  it('still sanitizes dangerous non-anchor URL attributes', () => {
    const imageNode = { tagName: 'img' }
    expect(markdownUrlTransform('javascript:alert(1)', 'src', imageNode as never)).toBe('')
  })

  it('keeps safe anchor hrefs unchanged', () => {
    const anchorNode = { tagName: 'a' }
    expect(markdownUrlTransform('https://example.com', 'href', anchorNode as never)).toBe('https://example.com')
  })
})

describe('ReactMarkdown anchor rendering with markdownUrlTransform', () => {
  function render(markdown: string): string {
    return renderToStaticMarkup(React.createElement(ReactMarkdown, {
      urlTransform: markdownUrlTransform,
      components: {
        a: ({ href, children }) => React.createElement('a', {
          href: href ? defaultUrlTransform(href) || undefined : undefined,
          'data-raw-href': href,
        }, children),
      },
      children: markdown,
    }))
  }

  it('lets file links reach the custom anchor while keeping the DOM href sanitized', () => {
    const html = render('[report](file:///Users/tester/report.pdf)')
    expect(html).toContain('data-raw-href="file:///Users/tester/report.pdf"')
    expect(html).not.toContain('<a href="file:///Users/tester/report.pdf"')
  })

  it('lets javascript links reach the custom anchor while keeping the DOM href sanitized', () => {
    const html = render('[boom](javascript:alert(1))')
    expect(html).toContain('data-raw-href="javascript:alert(1)"')
    expect(html).not.toContain('<a href="javascript:alert')
  })

  it('keeps safe web links in the DOM href for normal browser affordances', () => {
    const html = render('[site](https://example.com/path)')
    expect(html).toContain('href="https://example.com/path"')
  })
})

describe('classifyMarkdownLinkTarget', () => {
  it('classifies absolute unix file paths as file', () => {
    expect(classifyMarkdownLinkTarget('/Users/balintorosz/.craft-agent/sessions/abc/image.jpg')).toBe('file')
  })

  it('classifies file URLs as file', () => {
    expect(classifyMarkdownLinkTarget('file:///Users/tester/report.xlsx')).toBe('file')
  })

  it('classifies https links as url', () => {
    expect(classifyMarkdownLinkTarget('https://example.com/image.jpg')).toBe('url')
  })

  it('classifies mailto links as url', () => {
    expect(classifyMarkdownLinkTarget('mailto:test@example.com')).toBe('url')
  })
})

describe('describeFileLinkClick', () => {
  const box = (left: number, top: number, width: number, height = 18) => ({ left, top, width, height, bottom: top + height })
  // A link that wraps onto a second line: one box per line, the bounding box spans both.
  const firstLine = box(300, 100, 200)
  const secondLine = box(16, 118, 140)
  const link = (lines: ReturnType<typeof box>[]) => ({
    getClientRects: () => lines,
    getBoundingClientRect: () => box(16, 100, 484, 36),
  }) as unknown as FileLinkClickEvent['currentTarget']

  it('anchors on the line that was clicked', () => {
    const click = describeFileLinkClick({ currentTarget: link([firstLine, secondLine]), detail: 1, clientY: 125, altKey: false })
    expect(click).toEqual({ anchor: { x: 16, y: 118, width: 140, height: 18 }, altKey: false })
  })

  it('anchors a keyboard activation (no pointer position) on the first line', () => {
    const click = describeFileLinkClick({ currentTarget: link([firstLine, secondLine]), detail: 0, clientY: 0, altKey: false })
    expect(click.anchor).toEqual({ x: 300, y: 100, width: 200, height: 18 })
  })

  it('falls back to the bounding box when the link has no line boxes', () => {
    const click = describeFileLinkClick({ currentTarget: link([]), detail: 1, clientY: 110, altKey: true })
    expect(click).toEqual({ anchor: { x: 16, y: 100, width: 484, height: 36 }, altKey: true })
  })
})
