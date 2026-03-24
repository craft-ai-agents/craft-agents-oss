import { describe, it, expect } from 'bun:test'
import { classifyMarkdownLinkTarget } from '../link-target'

describe('classifyMarkdownLinkTarget', () => {
  it('classifies absolute unix file paths as file', () => {
    expect(classifyMarkdownLinkTarget('/Users/balintorosz/.craft-agent/sessions/abc/image.jpg')).toBe('file')
  })

  it('classifies parent-relative file paths as file', () => {
    expect(classifyMarkdownLinkTarget('../downloads/assets/screenshot.png')).toBe('file')
  })

  it('classifies repo-relative file paths as file', () => {
    expect(classifyMarkdownLinkTarget('apps/electron/resources/docs/browser-tools.md')).toBe('file')
  })

  it('classifies https links as url', () => {
    expect(classifyMarkdownLinkTarget('https://example.com/image.jpg')).toBe('url')
  })

  it('classifies mailto links as url', () => {
    expect(classifyMarkdownLinkTarget('mailto:test@example.com')).toBe('url')
  })

  // Percent-encoded file paths (from markdown renderers)
  it('classifies percent-encoded file paths with spaces as file', () => {
    expect(classifyMarkdownLinkTarget('/Users/foo/my%20project/README.md')).toBe('file')
  })

  it('classifies percent-encoded file paths with CJK characters as file', () => {
    expect(classifyMarkdownLinkTarget('/Users/foo/%E9%A1%B9%E7%9B%AE/design.md')).toBe('file')
  })

  it('classifies percent-encoded file paths with brackets as file', () => {
    expect(classifyMarkdownLinkTarget('/Users/foo/%5Bdesign%5D%20doc.md')).toBe('file')
  })

  it('classifies a complex percent-encoded CJK path as file', () => {
    const encoded = '/Users/foo/notes/1.%20%E9%A1%B9%E7%9B%AE/my-app/%5B%E8%AE%BE%E8%AE%A1%5D%20%E6%9E%B6%E6%9E%84%E6%96%87%E6%A1%A3%EF%BC%88%E4%BF%AE%E8%AE%A2%E7%89%88%EF%BC%89.md'
    expect(classifyMarkdownLinkTarget(encoded)).toBe('file')
  })

  // Decoded file paths with special characters
  it('classifies decoded paths with CJK and brackets as file', () => {
    expect(classifyMarkdownLinkTarget('/Users/foo/[设计] 架构文档（修订版）.md')).toBe('file')
  })
})
