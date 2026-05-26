import { describe, it, expect } from 'bun:test'
import {
  parseMarkdownPreviewSpec,
  normalizePreviewItems,
} from '../markdown-preview-helpers'

describe('parseMarkdownPreviewSpec', () => {
  it('parses a valid single-item spec with src and title', () => {
    const code = JSON.stringify({ src: '/tmp/file.md', title: 'My Title' })
    expect(parseMarkdownPreviewSpec(code)).toEqual({
      src: '/tmp/file.md',
      title: 'My Title',
    })
  })

  it('parses a valid single-item spec without a title', () => {
    const code = JSON.stringify({ src: '/tmp/file.md' })
    expect(parseMarkdownPreviewSpec(code)).toEqual({
      src: '/tmp/file.md',
      title: undefined,
    })
  })

  it('parses a valid multi-item spec', () => {
    const code = JSON.stringify({
      title: 'Versions',
      items: [
        { src: '/tmp/a.md', label: 'A' },
        { src: '/tmp/b.md' },
      ],
    })
    expect(parseMarkdownPreviewSpec(code)).toEqual({
      src: undefined,
      title: 'Versions',
      items: [
        { src: '/tmp/a.md', label: 'A' },
        { src: '/tmp/b.md' },
      ],
    })
  })

  it('prefers items over src when both are present', () => {
    const code = JSON.stringify({
      src: '/tmp/single.md',
      items: [{ src: '/tmp/a.md' }],
    })
    const spec = parseMarkdownPreviewSpec(code)
    expect(spec?.items?.[0].src).toBe('/tmp/a.md')
  })

  it('returns null for invalid JSON', () => {
    expect(parseMarkdownPreviewSpec('not json {')).toBeNull()
  })

  it('returns null when neither src nor items is present', () => {
    expect(parseMarkdownPreviewSpec('{"title":"nope"}')).toBeNull()
  })

  it('returns null when src is empty', () => {
    expect(parseMarkdownPreviewSpec('{"src":""}')).toBeNull()
  })

  it('returns null when items is an empty array and no src', () => {
    expect(parseMarkdownPreviewSpec('{"items":[]}')).toBeNull()
  })

  it('filters items missing a string src', () => {
    const code = JSON.stringify({
      items: [
        { src: '/tmp/ok.md' },
        { label: 'no src' },
        { src: '' },
        { src: 42 },
      ],
    })
    const spec = parseMarkdownPreviewSpec(code)
    expect(spec?.items).toEqual([{ src: '/tmp/ok.md' }])
  })

  it('returns null when filtered items array becomes empty', () => {
    const code = JSON.stringify({
      items: [{ label: 'no src' }, { src: '' }],
    })
    expect(parseMarkdownPreviewSpec(code)).toBeNull()
  })

  it('ignores non-string title', () => {
    const code = JSON.stringify({ src: '/tmp/file.md', title: 123 })
    const spec = parseMarkdownPreviewSpec(code)
    expect(spec?.title).toBeUndefined()
  })

  it('returns null for non-object JSON values', () => {
    expect(parseMarkdownPreviewSpec('null')).toBeNull()
    expect(parseMarkdownPreviewSpec('"a string"')).toBeNull()
    expect(parseMarkdownPreviewSpec('42')).toBeNull()
    expect(parseMarkdownPreviewSpec('[1,2]')).toBeNull()
  })
})

describe('normalizePreviewItems', () => {
  it('returns empty array for null spec', () => {
    expect(normalizePreviewItems(null)).toEqual([])
  })

  it('wraps single src into a one-element array', () => {
    expect(normalizePreviewItems({ src: '/tmp/a.md' })).toEqual([{ src: '/tmp/a.md' }])
  })

  it('returns items as-is when items array is non-empty', () => {
    const items = [{ src: '/tmp/a.md' }, { src: '/tmp/b.md', label: 'B' }]
    expect(normalizePreviewItems({ items })).toEqual(items)
  })

  it('prefers items over src', () => {
    const items = [{ src: '/tmp/a.md' }]
    expect(normalizePreviewItems({ src: '/tmp/single.md', items })).toEqual(items)
  })

  it('returns empty array when both src and items are missing', () => {
    expect(normalizePreviewItems({})).toEqual([])
  })

  it('returns empty array for empty items + no src', () => {
    expect(normalizePreviewItems({ items: [] })).toEqual([])
  })
})
