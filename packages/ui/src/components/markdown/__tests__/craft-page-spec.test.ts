/**
 * Parsing and identity for the ```craft-page fence.
 *
 * Pure logic, separated from the React component so the two things most likely
 * to break are testable directly: rejecting malformed specs the model may emit,
 * and deriving a frame key that CHANGES when a page is edited.
 *
 * That second one is not cosmetic. MarkdownHtmlBlock caches on the src path
 * with no version, so a re-generated page renders the OLD content — the user
 * says "make the header blue", the agent does it, and nothing appears to
 * happen. Keying on pageId:rev is the fix, and it only works if rev is in the
 * fence.
 */
import { describe, expect, it } from 'bun:test'
import { parseCraftPageSpec, craftPageFrameKey } from '../craft-page-spec.ts'

describe('parseCraftPageSpec', () => {
  it('parses a well-formed spec', () => {
    const r = parseCraftPageSpec('{"pageId":"abc-123","rev":2}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.spec.pageId).toBe('abc-123')
      expect(r.spec.rev).toBe(2)
    }
  })

  it('accepts an optional title', () => {
    const r = parseCraftPageSpec('{"pageId":"a","rev":1,"title":"Pottery Studio"}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.spec.title).toBe('Pottery Studio')
  })

  it('tolerates surrounding whitespace and newlines', () => {
    const r = parseCraftPageSpec('\n  {"pageId":"a","rev":1}\n')
    expect(r.ok).toBe(true)
  })

  it('rejects malformed JSON rather than throwing', () => {
    const r = parseCraftPageSpec('{not json')
    expect(r.ok).toBe(false)
  })

  it('rejects a missing or empty pageId', () => {
    expect(parseCraftPageSpec('{"rev":1}').ok).toBe(false)
    expect(parseCraftPageSpec('{"pageId":"","rev":1}').ok).toBe(false)
    expect(parseCraftPageSpec('{"pageId":123,"rev":1}').ok).toBe(false)
  })

  it('rejects a missing or nonsensical rev', () => {
    // rev drives cache invalidation. Defaulting it would silently reintroduce
    // the stale-preview bug, so an absent rev is an error, not a default.
    expect(parseCraftPageSpec('{"pageId":"a"}').ok).toBe(false)
    expect(parseCraftPageSpec('{"pageId":"a","rev":0}').ok).toBe(false)
    expect(parseCraftPageSpec('{"pageId":"a","rev":-1}').ok).toBe(false)
    expect(parseCraftPageSpec('{"pageId":"a","rev":1.5}').ok).toBe(false)
    expect(parseCraftPageSpec('{"pageId":"a","rev":"2"}').ok).toBe(false)
  })

  it('rejects a non-object payload', () => {
    for (const s of ['null', '[]', '"str"', '42']) {
      expect(parseCraftPageSpec(s).ok).toBe(false)
    }
  })

  it('gives a human-readable reason on failure', () => {
    const r = parseCraftPageSpec('{"rev":1}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0)
  })
})

describe('craftPageFrameKey', () => {
  it('changes when the revision changes', () => {
    // THE assertion that prevents the stale-preview bug.
    expect(craftPageFrameKey({ pageId: 'a', rev: 1 }))
      .not.toBe(craftPageFrameKey({ pageId: 'a', rev: 2 }))
  })

  it('differs between pages at the same revision', () => {
    expect(craftPageFrameKey({ pageId: 'a', rev: 1 }))
      .not.toBe(craftPageFrameKey({ pageId: 'b', rev: 1 }))
  })

  it('is stable for the same page and revision', () => {
    expect(craftPageFrameKey({ pageId: 'a', rev: 3 }))
      .toBe(craftPageFrameKey({ pageId: 'a', rev: 3 }))
  })
})
