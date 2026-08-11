/**
 * Which sources the workspace pool is allowed to connect.
 *
 * A page can only ever call tools on the curated read-only allowlist, so
 * connecting anything else spawns subprocesses and refreshes OAuth tokens for
 * capability the page can never reach. Narrowing here is both leaner and a
 * smaller blast radius: a source that is never connected cannot be called by
 * mistake.
 */
import { describe, expect, it } from 'bun:test'
import { eligibleSourcesForPages } from './pool-builder.ts'

const src = (slug: string, usable = true) => ({
  config: { slug, type: 'mcp' as const },
  usable,
})

describe('eligibleSourcesForPages', () => {
  it('keeps sources that have trusted read-only tools', () => {
    const kept = eligibleSourcesForPages(
      [src('gmail'), src('linear')],
      s => s.usable,
    )
    expect(kept.map(s => s.config.slug).sort()).toEqual(['gmail', 'linear'])
  })

  it('drops sources with no trusted tools at all', () => {
    // Nothing a page could call lives here, so connecting it only costs a
    // subprocess and a token refresh.
    const kept = eligibleSourcesForPages(
      [src('gmail'), src('some-random-source')],
      s => s.usable,
    )
    expect(kept.map(s => s.config.slug)).toEqual(['gmail'])
  })

  it('drops unusable sources (missing credentials, broken config)', () => {
    const kept = eligibleSourcesForPages(
      [src('gmail', false), src('linear', true)],
      s => s.usable,
    )
    expect(kept.map(s => s.config.slug)).toEqual(['linear'])
  })

  it('returns an empty list rather than throwing when nothing qualifies', () => {
    expect(eligibleSourcesForPages([], () => true)).toEqual([])
    expect(eligibleSourcesForPages([src('nope')], () => true)).toEqual([])
  })
})
