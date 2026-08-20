/**
 * In-repo LexoRank-style mid-string ranks (no external dependency).
 *
 * Alphabet is base62 (`0-9A-Za-z`). Ranks are non-empty strings matching
 * `/^[0-9A-Za-z]+$/`. Order is ordinary JS string comparison.
 *
 * Insertion averages digit codes; when two ranks are adjacent with no single
 * mid digit, the algorithm lengthens the string (append / refine) so the
 * result stays strictly between the neighbors.
 */

const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = ALPHA.length
const MID = Math.floor(BASE / 2) // 31 → 'V'
const MID_CHAR = ALPHA[MID]!
const RANK_RE = /^[0-9A-Za-z]+$/
/** Hard cap — rejects multi-KB garbage (NFR-3). Normal ranks stay well under this. */
export const LEXORANK_MAX_LENGTH = 64

/** digit code → char, char → code (static tables) */
const CHAR_CODE: Record<string, number> = Object.fromEntries(
  Array.from(ALPHA, (ch, i) => [ch, i]),
)

/** True when rank is a non-empty base62 string within LEXORANK_MAX_LENGTH. */
export function lexorankValidate(rank: string): boolean {
  return (
    typeof rank === 'string' &&
    rank.length > 0 &&
    rank.length <= LEXORANK_MAX_LENGTH &&
    RANK_RE.test(rank)
  )
}

/**
 * Rank strictly between `prev` and `next` (open bounds when nullish/empty).
 * `lexorankBetween()` with no bounds returns the initial middle rank.
 */
export function lexorankBetween(
  prev?: string | null,
  next?: string | null,
): string {
  const left = prev == null || prev === '' ? null : prev
  const right = next == null || next === '' ? null : next

  if (left != null && !lexorankValidate(left)) {
    throw new Error(`Invalid lexorank prev: ${left}`)
  }
  if (right != null && !lexorankValidate(right)) {
    throw new Error(`Invalid lexorank next: ${right}`)
  }
  if (left != null && right != null && left >= right) {
    throw new Error(`lexorankBetween: prev must be < next (got ${left} >= ${right})`)
  }

  if (left == null && right == null) return MID_CHAR
  if (left == null) return before(right!)
  if (right == null) return after(left)
  return between(left, right)
}

/** Strictly less than `next`. */
function before(next: string): string {
  if (next > MID_CHAR) return MID_CHAR

  // Decrement the first non-zero digit and drop the suffix.
  for (let i = 0; i < next.length; i++) {
    const v = CHAR_CODE[next[i]!]!
    if (v > 0) {
      const candidate = next.slice(0, i) + ALPHA[v - 1]
      if (candidate.length > 0 && candidate < next) return candidate
    }
  }

  // next is all zeros ("0", "00", …). String order puts any longer "0…0X" after
  // a shorter zero string only when X makes it larger — but "0" > "00", so a
  // longer string of zeros is actually *smaller*. Prefer "0"*(len+1).
  const zeros = '0'.repeat(next.length + 1)
  if (zeros < next) return zeros

  throw new Error(`lexorankBetween: no rank before ${next}`)
}

/** Strictly greater than `prev`. */
function after(prev: string): string {
  if (prev < MID_CHAR) return MID_CHAR

  // Increment the rightmost non-max digit; trim trailing maxes.
  for (let i = prev.length - 1; i >= 0; i--) {
    const v = CHAR_CODE[prev[i]!]!
    if (v < BASE - 1) {
      return prev.slice(0, i) + ALPHA[v + 1]
    }
  }

  // All max chars — append mid so prev is a proper prefix (prev < prev+MID).
  return prev + MID_CHAR
}

/** Strictly between two existing ranks. */
function between(prev: string, next: string): string {
  // Fast path: extending prev with MID often lands in (prev, next).
  const extended = prev + MID_CHAR
  if (extended > prev && extended < next) return extended

  // Digit-wise midpoint. Pad missing digits of prev with 0 and of next with
  // "virtual BASE" only when we have passed next's end (impossible gap) —
  // instead, when prefixes match, keep walking / lengthening.
  const out: number[] = []
  const maxLen = Math.max(prev.length, next.length) + 2

  for (let i = 0; i < maxLen; i++) {
    const a = i < prev.length ? CHAR_CODE[prev[i]!]! : 0
    const b = i < next.length ? CHAR_CODE[next[i]!]! : -1

    if (b === -1) {
      // `next` exhausted while still building: any extension of `next` is > next
      // in string order, so we cannot go past next's end. Fall through to
      // lengthen-under-prev strategy below.
      break
    }

    if (a === b) {
      out.push(a)
      continue
    }

    if (b - a > 1) {
      out.push(Math.floor((a + b) / 2))
      const rank = digitsToRank(out)
      if (rank > prev && rank < next) return rank
      // Mid collapsed oddly; keep refining.
      continue
    }

    // Adjacent digits (diff === 1): commit `a` and refine in the open space
    // (a…, b…) by appending a mid digit on the next iteration.
    out.push(a)
    // Force a mid suffix after this position.
    const withMid = digitsToRank(out) + MID_CHAR
    if (withMid > prev && withMid < next) return withMid
  }

  // Lengthen prev until we land strictly inside (prev, next).
  let rank = prev + MID_CHAR
  for (let k = 0; k < 32; k++) {
    if (rank > prev && rank < next) return rank
    // If we overshot next, step down by refining last char space under next.
    if (rank >= next) {
      // Replace last char with something smaller mid-way between prev-pad and next.
      return refineUnder(prev, next)
    }
    rank += MID_CHAR
  }

  return refineUnder(prev, next)
}

function digitsToRank(digits: number[]): string {
  return digits.map((d) => ALPHA[d]!).join('')
}

/**
 * Walk shared prefix; at the first gap place a midpoint, lengthening under
 * `next` when digits are adjacent.
 */
function refineUnder(prev: string, next: string): string {
  let i = 0
  let prefix = ''

  while (i < next.length) {
    const a = i < prev.length ? CHAR_CODE[prev[i]!]! : 0
    const b = CHAR_CODE[next[i]!]!

    if (a === b && i < prev.length) {
      prefix += next[i]!
      i++
      continue
    }

    if (b - a > 1) {
      const mid = Math.floor((a + b) / 2)
      const rank = prefix + ALPHA[mid]
      if (rank > prev && rank < next) return rank
    }

    // Adjacent or past-prev: take the lower bound digit when still inside prev,
    // then drop into a mid suffix.
    if (i < prev.length) {
      prefix += ALPHA[a]!
      i++
      const trial = prefix + MID_CHAR
      if (trial > prev && trial < next) return trial
      continue
    }

    // Past prev length, still under next: pick half of remaining head digit.
    if (b > 0) {
      const half = Math.floor(b / 2)
      const rank = prefix + ALPHA[half]!
      if (rank > prev && rank < next) return rank
      // half === 0: descend with explicit zero then mid
      prefix += '0'
      i++
      const trial = prefix + MID_CHAR
      if (trial > prev && trial < next) return trial
      continue
    }

    prefix += '0'
    i++
  }

  // Between p="a" and n="a0…" can be empty in pure string order. As a last
  // resort, return prev+MID only when valid; otherwise throw.
  const fallback = prev + MID_CHAR
  if (fallback > prev && fallback < next) return fallback

  throw new Error(`lexorankBetween: failed to place between ${prev} and ${next}`)
}

/**
 * `count` strictly increasing valid ranks for bulk initial assignment.
 * Values are evenly spaced fixed-width base62 integers in (0, BASE^width).
 */
export function lexorankN(count: number): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`lexorankN: count must be a non-negative integer (got ${count})`)
  }
  if (count === 0) return []
  if (count === 1) return [MID_CHAR]

  let width = 1
  let capacity = BASE
  while (capacity < count + 2) {
    width += 1
    capacity *= BASE
    if (width > 12) throw new Error(`lexorankN: count too large: ${count}`)
  }

  const ranks: string[] = []
  for (let i = 0; i < count; i++) {
    const value = Math.floor(((i + 1) * capacity) / (count + 1))
    ranks.push(encodeFixed(value, width))
  }

  // Guard against rare floor collisions — nudge forward with between().
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i]! <= ranks[i - 1]!) {
      ranks[i] = lexorankBetween(ranks[i - 1], i + 1 < ranks.length ? ranks[i + 1] : null)
    }
  }

  return ranks
}

function encodeFixed(value: number, width: number): string {
  let v = value
  const chars: string[] = new Array(width)
  for (let i = width - 1; i >= 0; i--) {
    chars[i] = ALPHA[v % BASE]!
    v = Math.floor(v / BASE)
  }
  return chars.join('')
}

/**
 * Assign initial ranks for workspace backfill.
 * Order: `lastMessageAt` DESC, then `id` ASC; ranks from `lexorankN`.
 */
export function backfillRanks(
  sessions: Array<{ id: string; lastMessageAt: number }>,
): Array<{ id: string; rank: string }> {
  const sorted = sessions.slice().sort((a, b) => {
    if (a.lastMessageAt !== b.lastMessageAt) return b.lastMessageAt - a.lastMessageAt
    if (a.id < b.id) return -1
    if (a.id > b.id) return 1
    return 0
  })

  const ranks = lexorankN(sorted.length)
  return sorted.map((s, i) => ({ id: s.id, rank: ranks[i]! }))
}
