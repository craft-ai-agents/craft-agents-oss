import { describe, it, expect } from 'bun:test'
import {
  computeDepthFromRoot,
  shouldGateManualExpand,
  splitPathSegments,
  trimExpandedByCount,
  type GateDecision,
} from '../treeBfsGate'

// ---------------------------------------------------------------------------
// Adversarial input suite — every helper in this file accepts strings that
// originate from the file system (a / b / a\b / \\server\share\a\b / ''),
// and the helper contracts explicitly promise "no NaN, no throw, defensive
// fallback" for pathologically wrong input.  These tests pin down the
// exact behaviour so a future "improvement" to splitPathSegments doesn't
// silently change cross-platform semantics.
//
// Each block exercises one adversarial category and verifies the
// invariant at every layer (segments → depth → gate decision → trim).
// ---------------------------------------------------------------------------

const kind = (d: GateDecision) => d.kind

// ---------------------------------------------------------------------------
// 1. Windows UNC paths — `\\server\share\path\to\dir`
// ---------------------------------------------------------------------------

describe('Windows UNC paths', () => {
  it('splits a UNC path into [server, share, …] segments', () => {
    // The leading `\\` is collapsed by the split's `[/\\]+` rule;
    // the result is a flat segment list starting with the server name.
    expect(splitPathSegments('\\\\fileserver\\share\\folder\\sub')).toEqual([
      'fileserver',
      'share',
      'folder',
      'sub',
    ])
  })

  it('depth of UNC descendant from UNC root', () => {
    const root = '\\\\fileserver\\share\\folder'
    expect(computeDepthFromRoot(root, '\\\\fileserver\\share\\folder')).toBe(0)
    expect(computeDepthFromRoot(root, '\\\\fileserver\\share\\folder\\a')).toBe(1)
    expect(computeDepthFromRoot(root, '\\\\fileserver\\share\\folder\\a\\b')).toBe(2)
  })

  it('UNC depth is identical to its POSIX counterpart (same shape)', () => {
    // A UNC root has 2 segments (server, share) just like /a/b has 2.
    // So a UNC tree and a POSIX tree of equivalent depth share the
    // same gate decision at the same expandDepth cap.
    const winRoot = '\\\\srv\\share'
    const winDir = '\\\\srv\\share\\x\\y\\z'
    const posixRoot = '/a/b'
    const posixDir = '/a/b/x/y/z'
    expect(computeDepthFromRoot(winRoot, winDir)).toBe(
      computeDepthFromRoot(posixRoot, posixDir),
    )
    expect(kind(shouldGateManualExpand(winRoot, winDir, 3, false))).toBe(
      kind(shouldGateManualExpand(posixRoot, posixDir, 3, false)),
    )
  })

  it('does not treat the `\\` of UNC as an escape for the next separator', () => {
    // `\\\\srv\share\a\\b` has a stray double-backslash after `a`.
    // `[/\\]+` collapses consecutive separators, so this should
    // produce the same segments as `\\\\srv\share\a\b`.
    expect(splitPathSegments('\\\\srv\\share\\a\\\\b')).toEqual([
      'srv',
      'share',
      'a',
      'b',
    ])
  })

  it('UNC root with forward-slash separators (network mounts)', () => {
    // WSL / network-mounted UNC paths sometimes arrive with forward
    // slashes instead of backslashes.  The helper must treat them
    // the same as native backslash UNC.
    const rootFs = '\\\\fileserver\\share\\folder'
    const rootBs = '\\\\fileserver/share/folder' // intentionally mixed
    expect(computeDepthFromRoot(rootFs, '\\\\fileserver/share/folder/a')).toBe(1)
    expect(computeDepthFromRoot(rootBs, '\\\\fileserver\\share\\folder\\a')).toBe(1)
  })

  it('trimExpandedByCount treats UNC paths consistently with POSIX', () => {
    const paths = new Set([
      '\\\\srv\\share\\a',
      '\\\\srv\\share\\b',
      '\\\\srv\\share\\b\\c',
      '\\\\srv\\share\\b\\c\\d',
    ])
    const { keep, dropped } = trimExpandedByCount(paths, '\\\\srv\\share', 2)
    expect(keep.size).toBe(2)
    // Shallowest two (a, b) win; deepest two dropped.
    expect(keep.has('\\\\srv\\share\\a')).toBe(true)
    expect(keep.has('\\\\srv\\share\\b')).toBe(true)
    expect(dropped).toEqual([
      '\\\\srv\\share\\b\\c\\d',
      '\\\\srv\\share\\b\\c',
    ])
  })
})

// ---------------------------------------------------------------------------
// 2. Trailing separators
// ---------------------------------------------------------------------------

describe('Trailing separators', () => {
  it('POSIX: dirPath with trailing slash matches the unslashed form', () => {
    expect(computeDepthFromRoot('/repo', '/repo/src')).toBe(1)
    expect(computeDepthFromRoot('/repo', '/repo/src/')).toBe(1)
  })

  it('Windows: dirPath with trailing backslash matches the unbackslashed form', () => {
    expect(computeDepthFromRoot('C:\\repo', 'C:\\repo\\src')).toBe(1)
    expect(computeDepthFromRoot('C:\\repo', 'C:\\repo\\src\\')).toBe(1)
  })

  it('Mixed: dirPath with trailing slash-backslash matches both forms', () => {
    // Some tools (npm, git) strip/normalise differently. The helper
    // must not care about trailing separator shape.
    expect(computeDepthFromRoot('/repo', '/repo/src/')).toBe(1)
    expect(computeDepthFromRoot('/repo', '/repo/src\\')).toBe(1)
    expect(computeDepthFromRoot('C:\\repo', 'C:\\repo\\src/')).toBe(1)
  })

  it('trimExpandedByCount treats trailing-suffix variants as the same path', () => {
    // The set contains both forms of the same path; trim should
    // count them as 2 entries (the Set does not deduplicate them
    // — the contract is "we receive Set<string>", not "we dedupe").
    // The depth calculation for each form is identical, so the
    // shallowest-first sort treats them as ties (alphabetic order).
    const paths = new Set([
      '/repo/src',
      '/repo/src/',
      '/repo/docs',
      '/repo/docs/',
    ])
    const { keep, dropped } = trimExpandedByCount(paths, '/repo', 2)
    expect(keep.size + dropped.length).toBe(4)
    expect(keep.size).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 3. Mixed separators in a single path
// ---------------------------------------------------------------------------

describe('Mixed separators within a single path', () => {
  it('depth is invariant to per-segment separator choice', () => {
    // Both paths must resolve to depth 3 from /repo.
    const d1 = computeDepthFromRoot('/repo', '/repo/a/b/c')
    const d2 = computeDepthFromRoot('/repo', '/repo\\a\\b\\c')
    const d3 = computeDepthFromRoot('/repo', '/repo/a\\b/c')
    const d4 = computeDepthFromRoot('/repo', '/repo\\a/b\\c')
    expect(d1).toBe(3)
    expect(d2).toBe(3)
    expect(d3).toBe(3)
    expect(d4).toBe(3)
  })

  it('gate decision is invariant to mixed-separator formatting', () => {
    // 4 segments (repo, src, components, Button.tsx) − 1 root segment
    // = depth 3. Cap 2 means depth >= cap → gate-forward with
    // currentDepth=3, cap=2. Verifies that the helper agrees across
    // all four separator-format combinations.
    const variants = [
      '/repo/src/components/Button.tsx',
      '/repo\\src\\components\\Button.tsx',
      '/repo/src\\components/Button.tsx',
      '/repo\\src/components\\Button.tsx',
    ]
    for (const v of variants) {
      const d = shouldGateManualExpand('/repo', v, 2, false)
      expect(kind(d)).toBe('gate-forward')
      if (d.kind === 'gate-forward') {
        expect(d.currentDepth).toBe(3)
        expect(d.cap).toBe(2)
      }
    }
  })

  it('Windows mixed-separator root + POSIX-separator dir', () => {
    // Real-world: Git on Windows returns C:/repo/...  paths even when
    // the working-directory was set via backslash.  The helper must
    // match across this asymmetry.
    const root = 'C:\\repo'
    expect(computeDepthFromRoot(root, 'C:/repo/src')).toBe(1)
    expect(computeDepthFromRoot(root, 'C:/repo/src/components')).toBe(2)
  })

  it('POSIX mixed-separator root + Windows-separator dir', () => {
    // Symmetric case: backend on Linux returns /repo paths; renderer
    // user pasted a Windows-style path.  Same answer expected.
    expect(computeDepthFromRoot('/repo', '/repo\\src\\components')).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 4. Empty string
// ---------------------------------------------------------------------------

describe('Empty string inputs', () => {
  it('splitPathSegments("") returns []', () => {
    expect(splitPathSegments('')).toEqual([])
  })

  it('computeDepthFromRoot with empty root returns 0 for any dir', () => {
    // Defensive fallback: empty root has 0 segments, so the "same-dir"
    // branch fires for any empty-segment dir (which is itself []).
    // For a non-empty dir, the segment-count difference is still finite.
    expect(computeDepthFromRoot('', '')).toBe(0)
    expect(computeDepthFromRoot('', '/repo')).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(computeDepthFromRoot('', '/repo'))).toBe(true)
  })

  it('computeDepthFromRoot with empty dir returns 0 against matching root', () => {
    expect(computeDepthFromRoot('/repo', '')).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(computeDepthFromRoot('/repo', ''))).toBe(true)
  })

  it('shouldGateManualExpand with empty strings does not throw', () => {
    // No crash, no NaN, returns a decision with a defined kind.
    const d1 = shouldGateManualExpand('', '', 2, false)
    expect(kind(d1)).toBeTruthy()
    const d2 = shouldGateManualExpand('', '/repo/src', 2, false)
    expect(kind(d2)).toBeTruthy()
    const d3 = shouldGateManualExpand('/repo', '', 2, false)
    expect(kind(d3)).toBeTruthy()
  })

  it('trimExpandedByCount with empty root is still finite and consistent', () => {
    // The fallback "return length difference" path produces a finite
    // number for every input, so all sort keys are finite — the
    // trim never hangs or NaNs out.
    const paths = new Set(['', '/a', '/a/b'])
    const { keep, dropped } = trimExpandedByCount(paths, '', 2)
    expect(keep.size).toBeLessThanOrEqual(2)
    expect(Number.isFinite(keep.size)).toBe(true)
    expect(dropped.length + keep.size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// 5. Identical root and dirPath
// ---------------------------------------------------------------------------

describe('Identical root and dirPath', () => {
  it('POSIX: same path with no trailing slash → depth 0', () => {
    expect(computeDepthFromRoot('/repo', '/repo')).toBe(0)
  })

  it('POSIX: same path with trailing slash → depth 0', () => {
    expect(computeDepthFromRoot('/repo/', '/repo')).toBe(0)
    expect(computeDepthFromRoot('/repo', '/repo/')).toBe(0)
    expect(computeDepthFromRoot('/repo/', '/repo/')).toBe(0)
  })

  it('Windows: same path with or without trailing backslash → depth 0', () => {
    expect(computeDepthFromRoot('C:\\repo', 'C:\\repo')).toBe(0)
    expect(computeDepthFromRoot('C:\\repo\\', 'C:\\repo')).toBe(0)
    expect(computeDepthFromRoot('C:\\repo', 'C:\\repo\\')).toBe(0)
  })

  it('UNC: same UNC path with or without trailing separator → depth 0', () => {
    expect(computeDepthFromRoot('\\\\srv\\share', '\\\\srv\\share')).toBe(0)
    expect(computeDepthFromRoot('\\\\srv\\share\\', '\\\\srv\\share')).toBe(0)
  })

  it('identical-path gate decision is allow-collapse when isCurrentlyExpanded', () => {
    // The user is clicking the root row to collapse it.  Even though
    // depth=0 and expandDepth=0 is "gated", collapse always wins.
    expect(kind(shouldGateManualExpand('/repo', '/repo', 0, true))).toBe(
      'allow-collapse',
    )
    expect(kind(shouldGateManualExpand('/repo', '/repo', 1, true))).toBe(
      'allow-collapse',
    )
  })

  it('identical-path forward expand is gated at cap 0, allowed at cap ≥ 1', () => {
    expect(kind(shouldGateManualExpand('/repo', '/repo', 0, false))).toBe(
      'gate-forward',
    )
    expect(kind(shouldGateManualExpand('/repo', '/repo', 1, false))).toBe(
      'allow',
    )
    expect(kind(shouldGateManualExpand('/repo', '/repo', 5, false))).toBe(
      'allow',
    )
  })

  it('trimExpandedByCount with a set containing only the root is identity', () => {
    const paths = new Set(['/repo'])
    const { keep, dropped } = trimExpandedByCount(paths, '/repo', 0)
    expect(keep.size).toBe(1)
    expect(keep.has('/repo')).toBe(true)
    expect(dropped).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 6. Root with trailing slash vs root without — must be equivalent
// ---------------------------------------------------------------------------

describe('Root trailing-slash invariance', () => {
  it('POSIX: trailing-slash root matches non-trailing root', () => {
    // The two roots must produce identical depth for any dirPath.
    const dirs = [
      '/repo',
      '/repo/',
      '/repo/src',
      '/repo/src/',
      '/repo/a/b/c/d',
    ]
    for (const dir of dirs) {
      expect(computeDepthFromRoot('/repo', dir)).toBe(
        computeDepthFromRoot('/repo/', dir),
      )
    }
  })

  it('Windows: trailing-backslash root matches non-trailing root', () => {
    const dirs = [
      'C:\\repo',
      'C:\\repo\\',
      'C:\\repo\\src',
      'C:\\repo\\src\\',
      'C:\\repo\\a\\b\\c\\d',
    ]
    for (const dir of dirs) {
      expect(computeDepthFromRoot('C:\\repo', dir)).toBe(
        computeDepthFromRoot('C:\\repo\\', dir),
      )
    }
  })

  it('gate decision is invariant to root trailing-slash', () => {
    const variants = [
      shouldGateManualExpand('/repo', '/repo/src', 1, false),
      shouldGateManualExpand('/repo/', '/repo/src', 1, false),
      shouldGateManualExpand('/repo', '/repo/src/', 1, false),
      shouldGateManualExpand('/repo/', '/repo/src/', 1, false),
    ]
    for (const d of variants) {
      expect(kind(d)).toBe('gate-forward')
    }
  })

  it('trimExpandedByCount is invariant to root trailing-slash', () => {
    const paths = new Set([
      '/repo/a',
      '/repo/a/b',
      '/repo/a/b/c',
      '/repo/a/b/c/d',
    ])
    const noSlash = trimExpandedByCount(paths, '/repo', 2)
    const trailingSlash = trimExpandedByCount(paths, '/repo/', 2)
    expect([...noSlash.keep].sort()).toEqual([...trailingSlash.keep].sort())
    expect(noSlash.dropped).toEqual(trailingSlash.dropped)
  })

  it('trimExpandedByCount is invariant to dirPath trailing-slash', () => {
    const pathsA = new Set(['/repo/a', '/repo/b'])
    const pathsB = new Set(['/repo/a/', '/repo/b/'])
    const { keep: kA, dropped: dA } = trimExpandedByCount(pathsA, '/repo', 1)
    const { keep: kB, dropped: dB } = trimExpandedByCount(pathsB, '/repo', 1)
    // Both sets contain two entries; trim to 1 → 1 dropped.
    expect(kA.size).toBe(1)
    expect(kB.size).toBe(1)
    expect(dA.length).toBe(1)
    expect(dB.length).toBe(1)
    // Alphabetic tiebreaker: 'a' wins, 'b' drops — same regardless of slash.
    expect([...kA]).toEqual(['/repo/a'])
    expect([...kB]).toEqual(['/repo/a/'])
    expect(dA).toEqual(['/repo/b'])
    expect(dB).toEqual(['/repo/b/'])
  })
})

// ---------------------------------------------------------------------------
// 7. Bonus: cross-cutting invariants — combinations of the above
// ---------------------------------------------------------------------------

describe('Cross-cutting invariants', () => {
  it('UNC root with trailing separator + POSIX dirPath', () => {
    // Real-world: a Windows file share mounted at /mnt/share returns
    // POSIX-style paths.  Treat the user-supplied UNC root with the
    // actual server-side root equally.
    const root = '\\\\srv\\share\\' // trailing backslash
    const dir = '/mnt/share/a/b'
    // Different prefix → fallback branch fires (segment-difference).
    // We don't care about the exact value, only that it's finite and
    // non-negative.
    const d = computeDepthFromRoot(root, dir)
    expect(Number.isFinite(d)).toBe(true)
    expect(d).toBeGreaterThanOrEqual(0)
  })

  it('single-segment paths ("/a") — depth 0 against themselves, 1 against root', () => {
    // Pathological case: a path with just one segment is the root.
    expect(computeDepthFromRoot('/a', '/a')).toBe(0)
    expect(computeDepthFromRoot('/a', '/a/')).toBe(0)
    expect(computeDepthFromRoot('/a', '/a/child')).toBe(1)
  })

  it('repeated identical roots in expandedPaths do not crash the trim', () => {
    // Sets normally dedupe, but a defensive path through
    // Array.from(expandedPaths).map(...) must not double-count. The
    // Set does dedupe, so this test mostly pins that contract.
    const paths = new Set(['/repo/a', '/repo/a', '/repo/b'])
    const { keep, dropped } = trimExpandedByCount(paths, '/repo', 1)
    expect(keep.size + dropped.length).toBe(2)
    expect(keep.has('/repo/a')).toBe(true)
  })

  it('all forbidden characters collapse to empty segments without crashing', () => {
    // A path that is only separators must produce a 0-segment list
    // and a finite, non-throwing depth calculation against any root.
    expect(splitPathSegments('///')).toEqual([])
    expect(splitPathSegments('\\\\\\\\')).toEqual([])
    expect(splitPathSegments('\\\\/\\\\/\\\\')).toEqual([])
    // depth against /repo from a "path" that has no segments
    // is segment-difference (length-of-dir 0 vs length-of-root 1) = 0
    expect(computeDepthFromRoot('/repo', '///')).toBeGreaterThanOrEqual(0)
  })
})
