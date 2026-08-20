/**
 * Tests for the knowledge mention grammar (spec K-03 §3.1/§3.5.2):
 *   [knowledge:siyuan/block/<id>] — full form (provider/kind/id)
 *   [knowledge:block/<id>]        — compact form → default provider 'siyuan'
 * Round-trip: token → parseMentions().knowledge serialized ref → re-token.
 */
import { describe, it, expect } from 'bun:test'
import {
  parseMentions,
  stripAllMentions,
  resolveKnowledgeMentions,
  serializeKnowledgeRef,
  KNOWLEDGE_MENTION_PATTERN,
  DEFAULT_KNOWLEDGE_PROVIDER,
} from '../index.ts'

// ============================================================================
// KNOWLEDGE_MENTION_PATTERN
// ============================================================================

describe('KNOWLEDGE_MENTION_PATTERN', () => {
  it('matches the full form [knowledge:siyuan/block/<id>]', () => {
    const re = new RegExp(KNOWLEDGE_MENTION_PATTERN.source, 'g')
    const m = re.exec('[knowledge:siyuan/block/20240101120000-abcde]')
    expect(m).not.toBeNull()
    expect(m![1]).toBe('siyuan')
    expect(m![2]).toBe('block')
    expect(m![3]).toBe('20240101120000-abcde')
  })

  it('matches the compact form [knowledge:block/<id>] with empty provider group', () => {
    const re = new RegExp(KNOWLEDGE_MENTION_PATTERN.source, 'g')
    const m = re.exec('[knowledge:block/abc123]')
    expect(m).not.toBeNull()
    expect(m![1]).toBeUndefined()
    expect(m![2]).toBe('block')
    expect(m![3]).toBe('abc123')
  })

  it('matches every kind in the grammar', () => {
    for (const kind of ['notebook', 'document', 'block', 'database', 'asset']) {
      const re = new RegExp(KNOWLEDGE_MENTION_PATTERN.source, 'g')
      expect(re.exec(`[knowledge:siyuan/${kind}/x1]`)).not.toBeNull()
    }
  })

  it('rejects unknown kinds', () => {
    const re = new RegExp(KNOWLEDGE_MENTION_PATTERN.source, 'g')
    expect(re.exec('[knowledge:siyuan/widget/x1]')).toBeNull()
  })

  it('rejects ids containing whitespace', () => {
    const re = new RegExp(KNOWLEDGE_MENTION_PATTERN.source, 'g')
    expect(re.exec('[knowledge:siyuan/block/abc def]')).toBeNull()
  })

  it('rejects empty ids', () => {
    const re = new RegExp(KNOWLEDGE_MENTION_PATTERN.source, 'g')
    expect(re.exec('[knowledge:siyuan/block/]')).toBeNull()
  })

  it('rejects provider segments that start with a digit', () => {
    const re = new RegExp(KNOWLEDGE_MENTION_PATTERN.source, 'g')
    expect(re.exec('[knowledge:9cloud/block/x1]')).toBeNull()
  })
})

// ============================================================================
// parseMentions — knowledge extraction
// ============================================================================

describe('parseMentions - knowledge mentions', () => {
  it('serializes the full form to siyuan/<kind>/<id>', () => {
    const result = parseMentions('[knowledge:siyuan/block/20240101120000-abcde]', [], [])
    expect(result.knowledge).toEqual(['siyuan/block/20240101120000-abcde'])
  })

  it('serializes the compact form with the default provider', () => {
    const result = parseMentions('[knowledge:block/abc123]', [], [])
    expect(result.knowledge).toEqual([`${DEFAULT_KNOWLEDGE_PROVIDER}/block/abc123`])
  })

  it('preserves a non-default provider', () => {
    const result = parseMentions('[knowledge:obsidian/document/note-x]', [], [])
    expect(result.knowledge).toEqual(['obsidian/document/note-x'])
  })

  it('collects multiple distinct refs in order', () => {
    const result = parseMentions(
      'see [knowledge:siyuan/document/doc-1] and [knowledge:siyuan/block/block-2]',
      [],
      []
    )
    expect(result.knowledge).toEqual(['siyuan/document/doc-1', 'siyuan/block/block-2'])
  })

  it('deduplicates repeated tokens', () => {
    const result = parseMentions('[knowledge:block/abc] twice [knowledge:block/abc]', [], [])
    expect(result.knowledge).toEqual(['siyuan/block/abc'])
  })

  it('leaves other parsed fields untouched', () => {
    const result = parseMentions('[skill:commit] [knowledge:block/abc] [source:linear]', ['commit'], ['linear'])
    expect(result.skills).toEqual(['commit'])
    expect(result.sources).toEqual(['linear'])
    expect(result.knowledge).toEqual(['siyuan/block/abc'])
  })

  it('returns an empty knowledge array when no knowledge mentions exist', () => {
    const result = parseMentions('[skill:commit] plain text', ['commit'], [])
    expect(result.knowledge).toEqual([])
  })

  it('does not treat malformed knowledge tokens as mentions', () => {
    const result = parseMentions('[knowledge:siyuan] [knowledge:block/ abc] [knowledge:block/]', [], [])
    expect(result.knowledge).toEqual([])
  })
})

// ============================================================================
// Grammar round-trip: token → serialized ref → token
// ============================================================================

describe('knowledge mention round-trip', () => {
  it('serialized ref re-tokenized parses to the identical ref', () => {
    const tokens = [
      '[knowledge:siyuan/notebook/nb-1]',
      '[knowledge:siyuan/document/doc-20240101]',
      '[knowledge:siyuan/database/db-42]',
      '[knowledge:block/asset-7]',
      '[knowledge:siyuan/asset/20240101120000-abcde.png]',
    ]
    for (const token of tokens) {
      const parsed = parseMentions(token, [], [])
      expect(parsed.knowledge).toHaveLength(1)
      const rebuilt = `[knowledge:${parsed.knowledge[0]!}]`
      const reparsed = parseMentions(rebuilt, [], [])
      expect(reparsed.knowledge).toEqual(parsed.knowledge)
    }
  })

  it('compact form round-trips through the default provider', () => {
    const parsed = parseMentions('[knowledge:block/xyz]', [], [])
    expect(parsed.knowledge).toEqual(['siyuan/block/xyz'])
    const rebuilt = `[knowledge:${parsed.knowledge[0]!}]`
    expect(rebuilt).toBe('[knowledge:siyuan/block/xyz]')
    expect(parseMentions(rebuilt, [], []).knowledge).toEqual(['siyuan/block/xyz'])
  })
})

// ============================================================================
// serializeKnowledgeRef
// ============================================================================

describe('serializeKnowledgeRef', () => {
  it('serializes with an explicit provider', () => {
    expect(serializeKnowledgeRef('siyuan', 'block', 'id-1')).toBe('siyuan/block/id-1')
  })

  it('falls back to the default provider when undefined', () => {
    expect(serializeKnowledgeRef(undefined, 'block', 'id-1')).toBe(`${DEFAULT_KNOWLEDGE_PROVIDER}/block/id-1`)
  })
})

// ============================================================================
// resolveKnowledgeMentions
// ============================================================================

describe('resolveKnowledgeMentions', () => {
  it('resolves the full form to a semantic marker', () => {
    expect(resolveKnowledgeMentions('read [knowledge:siyuan/block/20240101120000-abcde] please'))
      .toBe('read [Knowledge: block 20240101120000-abcde] please')
  })

  it('resolves the compact form identically', () => {
    expect(resolveKnowledgeMentions('[knowledge:block/abc]'))
      .toBe('[Knowledge: block abc]')
  })

  it('resolves multiple mentions', () => {
    expect(resolveKnowledgeMentions('[knowledge:siyuan/document/d1] and [knowledge:block/b2]'))
      .toBe('[Knowledge: document d1] and [Knowledge: block b2]')
  })

  it('leaves other mention types untouched', () => {
    expect(resolveKnowledgeMentions('[skill:commit] [source:github] [knowledge:block/abc]'))
      .toBe('[skill:commit] [source:github] [Knowledge: block abc]')
  })

  it('leaves text without mentions unchanged', () => {
    expect(resolveKnowledgeMentions('no mentions here')).toBe('no mentions here')
  })
})

// ============================================================================
// stripAllMentions — knowledge coverage
// ============================================================================

describe('stripAllMentions - knowledge tokens', () => {
  it('replaces the full form with the serialized ref', () => {
    expect(stripAllMentions('[knowledge:siyuan/block/20240101120000-abcde] read this'))
      .toBe('siyuan/block/20240101120000-abcde read this')
  })

  it('replaces the compact form with the default-provider ref', () => {
    expect(stripAllMentions('see [knowledge:block/xyz]'))
      .toBe('see siyuan/block/xyz')
  })

  it('keeps replacing skills and sources with their slug', () => {
    expect(stripAllMentions('[skill:commit] and [source:github] and [knowledge:block/x]'))
      .toBe('commit and github and siyuan/block/x')
  })
})
