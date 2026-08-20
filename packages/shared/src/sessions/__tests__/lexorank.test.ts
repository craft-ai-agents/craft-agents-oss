import { describe, expect, it } from 'bun:test'
import {
  backfillRanks,
  lexorankBetween,
  lexorankN,
  lexorankValidate,
} from '../lexorank.ts'

describe('lexorankValidate', () => {
  it('accepts non-empty base62 ranks', () => {
    expect(lexorankValidate('V')).toBe(true)
    expect(lexorankValidate('0')).toBe(true)
    expect(lexorankValidate('z')).toBe(true)
    expect(lexorankValidate('abcXYZ012')).toBe(true)
  })

  it('rejects empty, garbage, and oversized ranks', () => {
    expect(lexorankValidate('')).toBe(false)
    expect(lexorankValidate(' ')).toBe(false)
    expect(lexorankValidate('a-b')).toBe(false)
    expect(lexorankValidate('a_b')).toBe(false)
    expect(lexorankValidate('hello!')).toBe(false)
    expect(lexorankValidate('a.b')).toBe(false)
    expect(lexorankValidate('V'.repeat(65))).toBe(false)
    expect(lexorankValidate('V'.repeat(64))).toBe(true)
  })
})

describe('lexorankBetween', () => {
  it('returns a middle initial with no bounds', () => {
    const mid = lexorankBetween(undefined, undefined)
    expect(lexorankValidate(mid)).toBe(true)
    expect(mid.length).toBeGreaterThan(0)
  })

  it('returns a rank before next when only upper bound', () => {
    const next = lexorankBetween(undefined, undefined)
    const before = lexorankBetween(undefined, next)
    expect(lexorankValidate(before)).toBe(true)
    expect(before < next).toBe(true)
  })

  it('returns a rank after prev when only lower bound', () => {
    const prev = lexorankBetween(undefined, undefined)
    const after = lexorankBetween(prev, undefined)
    expect(lexorankValidate(after)).toBe(true)
    expect(after > prev).toBe(true)
  })

  it('returns a rank strictly between prev and next', () => {
    const a = lexorankBetween(undefined, undefined)
    const c = lexorankBetween(a, undefined)
    const b = lexorankBetween(a, c)
    expect(lexorankValidate(b)).toBe(true)
    expect(a < b && b < c).toBe(true)
  })

  it('can keep inserting between adjacent-looking ranks', () => {
    let left = lexorankBetween(undefined, undefined)
    let right = lexorankBetween(left, undefined)
    for (let i = 0; i < 20; i++) {
      const mid = lexorankBetween(left, right)
      expect(lexorankValidate(mid)).toBe(true)
      expect(mid > left).toBe(true)
      expect(mid < right).toBe(true)
      // narrow the window from the left
      left = mid
    }
  })

  it('null bounds behave like missing bounds', () => {
    const mid = lexorankBetween(null, null)
    expect(lexorankValidate(mid)).toBe(true)
    const after = lexorankBetween(mid, null)
    const before = lexorankBetween(null, mid)
    expect(after > mid).toBe(true)
    expect(before < mid).toBe(true)
  })
})

describe('lexorankN', () => {
  it('returns empty for 0 and one mid for 1', () => {
    expect(lexorankN(0)).toEqual([])
    const one = lexorankN(1)
    expect(one).toHaveLength(1)
    expect(lexorankValidate(one[0]!)).toBe(true)
  })

  it('returns strictly increasing valid ranks', () => {
    const ranks = lexorankN(25)
    expect(ranks).toHaveLength(25)
    for (let i = 0; i < ranks.length; i++) {
      expect(lexorankValidate(ranks[i]!)).toBe(true)
      if (i > 0) expect(ranks[i]! > ranks[i - 1]!).toBe(true)
    }
  })
})

describe('backfillRanks', () => {
  it('orders by lastMessageAt DESC then id ASC', () => {
    const input = [
      { id: 'b', lastMessageAt: 100 },
      { id: 'a', lastMessageAt: 300 },
      { id: 'c', lastMessageAt: 200 },
      { id: 'd', lastMessageAt: 200 },
    ]
    const out = backfillRanks(input)
    expect(out.map((r) => r.id)).toEqual(['a', 'c', 'd', 'b'])
    // ranks strictly increase in that list order (rank asc ≈ lastMessageAt desc)
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.rank > out[i - 1]!.rank).toBe(true)
      expect(lexorankValidate(out[i]!.rank)).toBe(true)
    }
    expect(lexorankValidate(out[0]!.rank)).toBe(true)
  })

  it('is deterministic for the same input', () => {
    const input = [
      { id: 'x', lastMessageAt: 5 },
      { id: 'y', lastMessageAt: 9 },
      { id: 'z', lastMessageAt: 5 },
    ]
    const a = backfillRanks(input)
    const b = backfillRanks(input)
    expect(a).toEqual(b)
    // also stable across shuffled copies
    const shuffled = [
      { id: 'z', lastMessageAt: 5 },
      { id: 'x', lastMessageAt: 5 },
      { id: 'y', lastMessageAt: 9 },
    ]
    expect(backfillRanks(shuffled)).toEqual(a)
  })

  it('does not mutate the input array', () => {
    const input = [
      { id: 'b', lastMessageAt: 1 },
      { id: 'a', lastMessageAt: 2 },
    ]
    const copy = input.map((s) => ({ ...s }))
    backfillRanks(input)
    expect(input).toEqual(copy)
  })
})
