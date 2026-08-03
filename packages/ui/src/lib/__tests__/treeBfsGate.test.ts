import { describe, it, expect } from 'bun:test'
import {
  computeDepthFromRoot,
  shouldGateManualExpand,
  splitPathSegments,
  trimExpandedByCount,
  type GateDecision,
} from '../treeBfsGate'

// ---------------------------------------------------------------------------
// splitPathSegments
// ---------------------------------------------------------------------------

describe('splitPathSegments', () => {
  it('splits a POSIX path on forward slash', () => {
    expect(splitPathSegments('/a/b/c')).toEqual(['a', 'b', 'c'])
    expect(splitPathSegments('a/b/c')).toEqual(['a', 'b', 'c'])
  })

  it('splits a Windows path on backslash and preserves drive letter', () => {
    expect(splitPathSegments('C:\\users\\me\\docs')).toEqual(['C:', 'users', 'me', 'docs'])
    expect(splitPathSegments('C:/users/me/docs')).toEqual(['C:', 'users', 'me', 'docs'])
  })

  it('splits a path with mixed separators (WSL / network mounts)', () => {
    expect(splitPathSegments('/a/b\\c/d')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('collapses consecutive separators and drops edge empties', () => {
    expect(splitPathSegments('//a///b//')).toEqual(['a', 'b'])
    expect(splitPathSegments('\\\\a\\\\\\\\b')).toEqual(['a', 'b'])
  })

  it('returns [] for an empty string', () => {
    expect(splitPathSegments('')).toEqual([])
  })

  it('returns [] for a string that is only separators', () => {
    expect(splitPathSegments('///')).toEqual([])
    expect(splitPathSegments('\\\\\\\\\\')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// computeDepthFromRoot
// ---------------------------------------------------------------------------

describe('computeDepthFromRoot', () => {
  it('returns 0 for the same path', () => {
    expect(computeDepthFromRoot('/a/b', '/a/b')).toBe(0)
    expect(computeDepthFromRoot('C:\\a\\b', 'C:\\a\\b')).toBe(0)
    expect(computeDepthFromRoot('/a/b', '/a/b/')).toBe(0)
  })

  it('returns 1 for a direct child', () => {
    expect(computeDepthFromRoot('/a', '/a/child')).toBe(1)
    expect(computeDepthFromRoot('C:\\a', 'C:\\a\\child')).toBe(1)
  })

  it('returns N for an N-edge-deep descendant', () => {
    expect(computeDepthFromRoot('/a', '/a/b')).toBe(1)
    expect(computeDepthFromRoot('/a', '/a/b/c')).toBe(2)
    expect(computeDepthFromRoot('/a', '/a/b/c/d/e/f')).toBe(5)
  })

  it('handles mixed-separator paths consistently', () => {
    expect(computeDepthFromRoot('/a/b', '/a/b\\c/d')).toBe(2)
    expect(computeDepthFromRoot('C:\\a\\b', 'C:/a/b/c')).toBe(1)
  })

  it('falls back gracefully when paths do not share a prefix', () => {
    const d = computeDepthFromRoot('/other', '/a/b/c')
    expect(d).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(d)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// shouldGateManualExpand
// ---------------------------------------------------------------------------

const kind = (d: GateDecision) => d.kind

describe('shouldGateManualExpand', () => {
  it('always allows collapse, even at capped depth', () => {
    const d = shouldGateManualExpand('/a', '/a/b/c/d', 2, true)
    expect(kind(d)).toBe('allow-collapse')
  })

  it('always allows collapse even with Infinity cap', () => {
    const d = shouldGateManualExpand('/a', '/a/b/c/d/e', Infinity, true)
    expect(kind(d)).toBe('allow-collapse')
  })

  it('never gates when expandDepth is Infinity', () => {
    const d = shouldGateManualExpand('/a', '/a/b/c/d/e/f/g/h', Infinity, false)
    expect(kind(d)).toBe('allow')
  })

  it('never gates when expandDepth is non-finite (NaN)', () => {
    const d = shouldGateManualExpand('/a', '/a/b', Number.NaN, false)
    expect(kind(d)).toBe('allow')
  })

  it('gates a depth-1 click at cap 1 (children would land at depth 2 > cap)', () => {
    const d = shouldGateManualExpand('/a', '/a/child', 1, false)
    expect(kind(d)).toBe('gate-forward')
  })

  it('allows expansion at depth strictly less than the cap', () => {
    const d = shouldGateManualExpand('/a', '/a/b/c', 3, false)
    expect(kind(d)).toBe('allow')
  })

  it('gates expansion at depth exactly equal to the cap', () => {
    const d = shouldGateManualExpand('/a', '/a/b/c/d', 3, false)
    expect(kind(d)).toBe('gate-forward')
    if (d.kind === 'gate-forward') {
      expect(d.currentDepth).toBe(3)
      expect(d.cap).toBe(3)
    }
  })

  it('gates expansion at depth greater than the cap', () => {
    const d = shouldGateManualExpand('/a', '/a/b/c/d/e', 2, false)
    expect(kind(d)).toBe('gate-forward')
    if (d.kind === 'gate-forward') {
      expect(d.currentDepth).toBe(4)
      expect(d.cap).toBe(2)
    }
  })

  it('gates every expansion at cap 0', () => {
    const d = shouldGateManualExpand('/a', '/a', 0, false)
    expect(kind(d)).toBe('gate-forward')
  })

  it('does not throw on negative expandDepth', () => {
    const d = shouldGateManualExpand('/a', '/a/b', -1, false)
    expect(kind(d)).toBe('gate-forward')
  })

  it('agrees on equivalent Unix and Windows paths', () => {
    const unixD = shouldGateManualExpand('/a/b', '/a/b/c/d', 2, false)
    const winD = shouldGateManualExpand('C:\\a\\b', 'C:\\a\\b\\c\\d', 2, false)
    const mixedD = shouldGateManualExpand('C:\\a/b', 'C:/a/b\\c/d', 2, false)
    expect(kind(unixD)).toBe('gate-forward')
    expect(kind(winD)).toBe('gate-forward')
    expect(kind(mixedD)).toBe('gate-forward')
  })

  it('treats trailing slashes as identical to no trailing slash', () => {
    const noSlash = shouldGateManualExpand('/a/b', '/a/b/c', 2, false)
    const withSlash = shouldGateManualExpand('/a/b/', '/a/b/c/', 2, false)
    expect(kind(noSlash)).toBe(kind(withSlash))
  })

  const matrixCases: Array<[number, number, 'allow' | 'gate-forward']> = []
  for (const cap of [1, 2, 3, 4]) {
    for (const depth of [0, 1, 2, 3, 4, 5]) {
      matrixCases.push([depth, cap, depth < cap ? 'allow' : 'gate-forward'])
    }
  }

  it.each(matrixCases)('depth=%i, cap=%i → %s', (depth, cap, expected) => {
    const segs = ['a']
    for (let i = 0; i < depth; i++) segs.push(`d${i}`)
    const dirPath = '/' + segs.join('/')
    const d = shouldGateManualExpand('/a', dirPath, cap, false)
    expect(kind(d)).toBe(expected)
  })

  it('agrees with the SHRINK spec: at cap 2 a depth-2 dir is gated', () => {
    const d = shouldGateManualExpand('/repo', '/repo/src/components', 2, false)
    expect(kind(d)).toBe('gate-forward')
  })

  it('agrees with the SHRINK spec: after picking cap 3, depth-2 clicks pass', () => {
    const d = shouldGateManualExpand('/repo', '/repo/src', 3, false)
    expect(kind(d)).toBe('allow')
  })
})

// ---------------------------------------------------------------------------
// trimExpandedByCount — cumulative open-directory count cap
// ---------------------------------------------------------------------------

describe('trimExpandedByCount', () => {
  const root = '/repo'

  it('returns keep=clone and dropped=[] when within limit', () => {
    const paths = new Set(['/repo/src', '/repo/docs'])
    const { keep, dropped } = trimExpandedByCount(paths, root, 5)
    expect(keep.size).toBe(2)
    expect(keep.has('/repo/src')).toBe(true)
    expect(keep.has('/repo/docs')).toBe(true)
    expect(dropped).toEqual([])
  })

  it('trims to exactly maxOpenDirs when over limit', () => {
    const paths = new Set([
      '/repo/a',
      '/repo/b',
      '/repo/b/c',
      '/repo/b/c/d',
    ])
    const { keep, dropped } = trimExpandedByCount(paths, root, 3)
    expect(keep.size).toBe(3)
    expect(keep.has('/repo/a')).toBe(true)
    expect(keep.has('/repo/b')).toBe(true)
    expect(keep.has('/repo/b/c')).toBe(true)
    expect(dropped).toEqual(['/repo/b/c/d'])
  })

  it('drops the leaf-most (deepest) paths first', () => {
    const paths = new Set([
      '/repo/src',
      '/repo/src/components',
      '/repo/src/components/Button',
      '/repo/lib',
      '/repo/lib/utils',
    ])
    const { dropped } = trimExpandedByCount(paths, root, 3)
    expect(dropped.length).toBe(2)
    expect(dropped[0]).toBe('/repo/src/components/Button')
    expect(dropped[1]).toMatch(/^\/repo\/(src\/components|lib\/utils)$/)
  })

  it('uses alphabetic tiebreaker when depths are equal', () => {
    const paths = new Set(['/repo/b', '/repo/a'])
    const { keep, dropped } = trimExpandedByCount(paths, root, 1)
    expect(keep.has('/repo/a')).toBe(true)
    expect(dropped).toEqual(['/repo/b'])
  })

  it('returns identity when size equals limit', () => {
    const paths = new Set(['/repo/src', '/repo/docs', '/repo/lib'])
    const { keep, dropped } = trimExpandedByCount(paths, root, 3)
    expect(keep.size).toBe(3)
    expect(dropped).toEqual([])
  })

  it('handles empty input', () => {
    const { keep, dropped } = trimExpandedByCount(new Set(), '/repo', 10)
    expect(keep.size).toBe(0)
    expect(dropped).toEqual([])
  })

  it('handles cross-platform paths consistently', () => {
    const paths = new Set([
      'C:\\repo\\src',
      'C:\\repo\\src\\components',
      'C:\\repo\\lib',
    ])
    const { keep, dropped } = trimExpandedByCount(paths, 'C:\\repo', 2)
    expect(keep.size).toBe(2)
    expect(keep.has('C:\\repo\\src')).toBe(true)
    expect(keep.has('C:\\repo\\lib')).toBe(true)
    expect(dropped).toEqual(['C:\\repo\\src\\components'])
  })

  it('keep is a new Set (not same reference as input)', () => {
    const paths = new Set(['/repo/src'])
    const { keep } = trimExpandedByCount(paths, root, 10)
    expect(keep).not.toBe(paths)
  })

  it('orthogonal composition: depth gate + count cap on same tree', () => {
    const root = '/app'
    // 5 dirs expanded, all at depth 1-2 (within expandDepth=2).
    const paths = new Set([
      '/app/a',
      '/app/a/b',
      '/app/d',
      '/app/d/e',
      '/app/f',
    ])
    const { keep, dropped } = trimExpandedByCount(paths, root, 3)
    expect(keep.size).toBe(3)
    expect(dropped.length).toBe(2)
    // Keeps the 3 shallowest (depth-1 dirs: a, d, f).
    expect(keep.has('/app/a')).toBe(true)
    expect(keep.has('/app/d')).toBe(true)
    expect(keep.has('/app/f')).toBe(true)
  })

  // ---------------------------------------------------------------------
  // Pinned paths — exempt from eviction
  // ---------------------------------------------------------------------

  it('pinned paths are always retained in `keep`, even when deepest', () => {
    // /repo/b/c/d is the deepest; would normally be evicted first. Pin it.
    const paths = new Set([
      '/repo/a',
      '/repo/b',
      '/repo/b/c',
      '/repo/b/c/d',
    ])
    const pinned = new Set(['/repo/b/c/d'])
    const { keep, dropped } = trimExpandedByCount(paths, '/repo', 2, pinned)
    expect(keep.size).toBe(2)
    // Pinned entry survives even though it's the deepest.
    expect(keep.has('/repo/b/c/d')).toBe(true)
    // Only one unpinned slot remained; the shallowest unpinned (a) wins.
    expect(keep.has('/repo/a')).toBe(true)
    // b and b/c were the unpinned eviction candidates.
    expect(dropped).toContain('/repo/b')
    expect(dropped).toContain('/repo/b/c')
    expect(dropped).not.toContain('/repo/b/c/d')
  })

  it('multiple pinned paths reduce the budget for unpinned slots', () => {
    // 5 paths, cap 3, two pinned. Budget for unpinned = 3 - 2 = 1.
    const paths = new Set([
      '/repo/a',
      '/repo/b',
      '/repo/b/c',
      '/repo/b/c/d',
      '/repo/lib',
    ])
    const pinned = new Set(['/repo/b/c/d', '/repo/lib'])
    const { keep, dropped } = trimExpandedByCount(paths, '/repo', 3, pinned)
    // keep = the 2 pinned + the shallowest unpinned.
    expect(keep.size).toBe(3)
    expect(keep.has('/repo/b/c/d')).toBe(true)
    expect(keep.has('/repo/lib')).toBe(true)
    expect(keep.has('/repo/a')).toBe(true) // shallowest unpinned wins
    // The 2 deepest unpinned entries are dropped.
    expect(dropped.length).toBe(2)
    expect(dropped).toContain('/repo/b/c')
    expect(dropped).toContain('/repo/b')
  })

  it('all-pinned over-cap returns a no-op (no fabricated drops)', () => {
    // Every expanded dir is pinned and the set already exceeds the cap.
    // The helper returns the full set unchanged rather than violating
    // the user's explicit pins — the caller surfaces the over-cap
    // condition via its own length check (chip / toast).
    const paths = new Set([
      '/repo/a',
      '/repo/b',
      '/repo/b/c',
      '/repo/b/c/d',
    ])
    const pinned = new Set(['/repo/a', '/repo/b', '/repo/b/c', '/repo/b/c/d'])
    const { keep, dropped } = trimExpandedByCount(paths, '/repo', 2, pinned)
    expect(keep.size).toBe(4)
    expect(keep).toEqual(paths)
    expect(dropped).toEqual([])
  })

  it('pinned paths not in expandedPaths are ignored', () => {
    // Pinned contains an entry not in the expanded set — the helper
    // should treat the missing entry as absent and proceed with the
    // normal trim. This guards against stale-pin drift (user pinned a
    // dir, it got collapsed somehow, pin still references the path).
    const paths = new Set(['/repo/a', '/repo/b', '/repo/b/c'])
    const pinned = new Set(['/repo/never-expanded'])
    const { keep, dropped } = trimExpandedByCount(paths, '/repo', 2, pinned)
    expect(keep.size).toBe(2)
    expect(keep.has('/repo/a')).toBe(true)
    expect(keep.has('/repo/b')).toBe(true)
    expect(dropped).toEqual(['/repo/b/c'])
  })

  it('empty pinnedPaths is equivalent to omitting the parameter', () => {
    const paths = new Set(['/repo/a', '/repo/b', '/repo/b/c'])
    const withEmpty = trimExpandedByCount(paths, '/repo', 2, new Set())
    const withOmitted = trimExpandedByCount(paths, '/repo', 2)
    expect(withEmpty.keep).toEqual(withOmitted.keep)
    expect(withEmpty.dropped).toEqual(withOmitted.dropped)
  })
})
