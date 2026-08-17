/**
 * Requested queries — the agent's REQUEST, never an authorization.
 *
 * `page.json` is agent-writable, so nothing here is a security control: a
 * hand-edited manifest can claim any query it likes. The real checks are the
 * allowlist and schema validation at approval time (server-core grants/store).
 * What these rules buy is that a malformed or abusive request is rejected at
 * the tool boundary, where the agent gets a usable error, rather than surfacing
 * as a broken or hostile consent dialog.
 */
import { describe, expect, it } from 'bun:test'
import { validateRequestedQueries, MAX_REQUESTED_QUERIES } from './requested-queries.ts'

const ok = { name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages', fixedArgs: {}, paramSchema: {} }

describe('shape', () => {
  it('accepts a well-formed request', () => {
    const r = validateRequestedQueries([ok])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.queries).toEqual([ok])
  })

  it('accepts an empty list and undefined alike', () => {
    for (const input of [undefined, []]) {
      const r = validateRequestedQueries(input)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.queries).toEqual([])
    }
  })

  it('fills in absent fixedArgs and paramSchema rather than rejecting', () => {
    // The common case is a query with neither. Requiring both would be noise.
    const r = validateRequestedQueries([
      { name: 'all', sourceSlug: 'gmail', toolName: 'list_messages' },
    ])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.queries[0]).toEqual({
      name: 'all', sourceSlug: 'gmail', toolName: 'list_messages', fixedArgs: {}, paramSchema: {},
    })
  })

  for (const [label, bad] of [
    ['a missing name', { ...ok, name: undefined }],
    ['an empty name', { ...ok, name: '' }],
    ['a missing sourceSlug', { ...ok, sourceSlug: undefined }],
    ['a missing toolName', { ...ok, toolName: undefined }],
    ['a non-object entry', 'gmail.list_messages'],
    ['a null entry', null],
    ['array fixedArgs', { ...ok, fixedArgs: [1, 2] }],
    ['string paramSchema', { ...ok, paramSchema: 'q' }],
  ] as const) {
    it(`rejects ${label}`, () => {
      expect(validateRequestedQueries([bad]).ok).toBe(false)
    })
  }
})

describe('the name is a handle the page will use in code', () => {
  for (const good of ['unread', 'recent-issues', 'a', 'q1', 'my_query']) {
    it(`accepts "${good}"`, () => {
      expect(validateRequestedQueries([{ ...ok, name: good }]).ok).toBe(true)
    })
  }

  for (const bad of [
    'has space', 'has.dot', 'has/slash', '../escape', 'ünïcode', '<script>',
    'x'.repeat(33), '-leading', '__proto__',
  ]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(validateRequestedQueries([{ ...ok, name: bad }]).ok).toBe(false)
    })
  }

  it('rejects duplicate names in one page', () => {
    // The name resolves to exactly one grant at runtime; two would make the
    // lookup order decide which of the user's approvals a call actually used.
    const r = validateRequestedQueries([ok, { ...ok, toolName: 'search_messages' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/duplicate/i)
  })

  it('treats names as case-insensitively distinct to avoid confusable pairs', () => {
    expect(validateRequestedQueries([ok, { ...ok, name: 'UNREAD' }]).ok).toBe(false)
  })
})

describe('bounded', () => {
  it(`accepts up to ${MAX_REQUESTED_QUERIES} queries`, () => {
    const many = Array.from({ length: MAX_REQUESTED_QUERIES }, (_, i) => ({ ...ok, name: `q${i}` }))
    expect(validateRequestedQueries(many).ok).toBe(true)
  })

  it('rejects more than that', () => {
    // A page requesting dozens of queries is a consent-fatigue attack: the
    // dialog becomes unreadable and the user clicks approve to make it stop.
    const many = Array.from({ length: MAX_REQUESTED_QUERIES + 1 }, (_, i) => ({ ...ok, name: `q${i}` }))
    const r = validateRequestedQueries(many)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/at most/i)
  })

  it('rejects a request that is not an array', () => {
    expect(validateRequestedQueries({ name: 'unread' } as never).ok).toBe(false)
  })
})

describe('no prototype smuggling', () => {
  it('does not let fixedArgs carry __proto__ through to a merged object', () => {
    const r = validateRequestedQueries([
      { ...ok, fixedArgs: JSON.parse('{"__proto__": {"polluted": true}}') },
    ])
    // Either rejected outright or carried as an own property that cannot
    // pollute — never silently applied to Object.prototype.
    if (r.ok) {
      const merged = { ...r.queries[0]!.fixedArgs }
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
      expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
