import { describe, test, expect } from 'bun:test'
import { encodeMeta, decodeMeta, hasMeta, stripMeta } from '../src/orchestrate/meta-codec.ts'
import type { OrchestrateMeta } from '../src/orchestrate/types.ts'

describe('meta-codec', () => {
  const sampleMeta: OrchestrateMeta = {
    storyId: 'US-001',
    orchestrateId: 'orch-123-abc',
    lineNumber: 42,
  }

  describe('encodeMeta', () => {
    test('appends metadata as HTML comment', () => {
      const content = '## Story Content\n\nThis is a test.'
      const encoded = encodeMeta(content, sampleMeta)

      expect(encoded).toContain(content)
      expect(encoded).toContain('<!-- orchestrate-meta:')
      expect(encoded).toContain('-->')
    })

    test('handles empty content', () => {
      const encoded = encodeMeta('', sampleMeta)
      expect(encoded).toContain('orchestrate-meta')
    })
  })

  describe('decodeMeta', () => {
    test('extracts metadata from encoded string', () => {
      const content = '## Story'
      const encoded = encodeMeta(content, sampleMeta)
      const decoded = decodeMeta(encoded)

      expect(decoded).not.toBeNull()
      expect(decoded?.storyId).toBe('US-001')
      expect(decoded?.orchestrateId).toBe('orch-123-abc')
      expect(decoded?.lineNumber).toBe(42)
    })

    test('returns null for content without metadata', () => {
      expect(decodeMeta('Just plain content')).toBeNull()
    })

    test('returns null for malformed metadata', () => {
      expect(decodeMeta('<!-- orchestrate-meta: not-json -->')).toBeNull()
    })
  })

  describe('hasMeta', () => {
    test('returns true for encoded content', () => {
      const encoded = encodeMeta('content', sampleMeta)
      expect(hasMeta(encoded)).toBe(true)
    })

    test('returns false for plain content', () => {
      expect(hasMeta('plain content')).toBe(false)
    })
  })

  describe('stripMeta', () => {
    test('removes metadata from encoded content', () => {
      const content = '## Story Content'
      const encoded = encodeMeta(content, sampleMeta)
      const stripped = stripMeta(encoded)

      expect(stripped).toBe(content)
      expect(hasMeta(stripped)).toBe(false)
    })
  })

  describe('round-trip', () => {
    test('encode then decode preserves all fields', () => {
      const content = 'Test content with special chars: <>&"'
      const encoded = encodeMeta(content, sampleMeta)
      const decoded = decodeMeta(encoded)

      expect(decoded).toEqual(sampleMeta)
    })
  })
})
