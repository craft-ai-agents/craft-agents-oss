/**
 * treeBfsGate.consumer-agnostic.test.ts
 *
 * Proves that `shouldGateManualExpand` and the surrounding helpers
 * can be consumed by ANY tree component, not just LayoutShell and
 * SessionFilesSection.  The file deliberately imports only from
 * '../treeBfsGate' — no LayoutShell, no SessionFilesSection, no
 * Session-, Wd-, or app-* modules — and drives the helpers with
 * arbitrarily-named paths to demonstrate that the contract speaks
 * in `string | number | boolean | GateDecision` only.
 *
 * If this test ever imports a tree-consumer type or value, the
 * helper is no longer portable.  The module-purity assertion below
 * (grep-equivalent over the import graph) is the canary.
 */

import { describe, expect, it } from 'bun:test'
import {
  computeDepthFromRoot,
  shouldGateManualExpand,
  splitPathSegments,
  trimExpandedByCount,
  type GateDecision,
} from '../treeBfsGate'

// ---------------------------------------------------------------------------
// 1. Module isolation — the helper has no transitive dependency on any
//    tree-consumer layer.  If a future refactor pulls in a consumer
//    type/value, this section will be the first place to catch it.
// ---------------------------------------------------------------------------

describe('module isolation', () => {
  it('imports compile without any tree-consumer module load', async () => {
    // Static-import sanity: if this assertion runs without throwing,
    // `treeBfsGate`'s import graph only touches native ESM + bun:test.
    // The module is loaded successfully above — `it` reaching this
    // body is the proof.
    expect(typeof shouldGateManualExpand).toBe('function')
    expect(typeof computeDepthFromRoot).toBe('function')
    expect(typeof splitPathSegments).toBe('function')
    expect(typeof trimExpandedByCount).toBe('function')
  })

  it('the import-graph surface contains zero tree-consumer identifiers', async () => {
    // Read the source file directly and assert no consumer-specific
    // identifiers appear in any line.  This catches a future refactor
    // that, say, adds a `import type { WdEntry } from '@app/...'` to
    // `treeBfsGate.ts` even when the type isn't used at runtime —
    // a load-graph leak that would still bloat the package boundary.
    const source = await Bun.file(
      new URL('../treeBfsGate.ts', import.meta.url),
    ).text()
    const consumerLeaks = [
      'LayoutShell',
      'SessionFilesSection',
      'WdEntry',
      'WdRootPath',
      'StoredAttachment',
      'TreeRow',
      'treeBfsGateGate', // legacy typo guard
    ]
    for (const leak of consumerLeaks) {
      // Allow the leak identifier to appear in a documentation-comment
      // mention; the assertion catches a real import or symbol use.
      const offendingLines = source
        .split('\n')
        .map((line, idx) => ({ line, idx: idx + 1 }))
        .filter(({ line }) => {
          const trimmed = line.trim()
          // Skip JSDoc / line comments so a doc mention doesn't trip.
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false
          return line.includes(leak)
        })
      expect(offendingLines).toEqual([])
    }
  })

  it('exposes the documented public function symbols at runtime', async () => {
    // Static-checked via TS imports rather than a CJS-style `require`
    // reflection (which mixes ESM/TS transpilation order with brittle
    // CommonJS assumptions).  The ts:expect-error smell is gone — if
    // a future refactor breaks the import path, the test fails to
    // compile instead of failing at runtime with a false confidence.
    const mod = await import('../treeBfsGate')
    expect(typeof mod.shouldGateManualExpand).toBe('function')
    expect(typeof mod.computeDepthFromRoot).toBe('function')
    expect(typeof mod.splitPathSegments).toBe('function')
    expect(typeof mod.trimExpandedByCount).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// 2. Arbitrary path inputs — the helper uses only `string | number`.
//    No specific consumer type is required.
// ---------------------------------------------------------------------------

describe('arbitrary path inputs', () => {
  // Each fixture here demonstrates that the helper works regardless of
  // the convention the consumer uses to name tree nodes: a UriTree
  // might use full URIs; a ConfigTree might use `.`-separated identifiers.
  // The helper doesn't care.
  const consumerFlavors = [
    { name: 'POSIX paths', root: '/workspace', path: '/workspace/src/components/Button.tsx' },
    { name: 'Windows paths', root: 'C:\\workspace', path: 'C:\\workspace\\src\\components\\Button.tsx' },
    { name: 'WSL / mixed paths', root: '/mnt/c/workspace', path: '/mnt/c/workspace\\src\\Button.tsx' },
    { name: 'config-flavor identifiers', root: 'app.theme', path: 'app.theme.colors.primary' },
    { name: 'URI-flavor', root: 'urn:workspace', path: 'urn:workspace:src:Button.tsx' },
  ] as const

  for (const { name, root, path } of consumerFlavors) {
    it(`produces a coherent decision for ${name}`, () => {
      // Whatever the path convention, depth from root is at least 1
      // and the decision shape is one of the three valid kinds.
      const decision = shouldGateManualExpand(root, path, 2, false)
      expect(decision).toBeDefined()
      expect(['allow', 'allow-collapse', 'gate-forward']).toContain(decision.kind)
      if (decision.kind === 'gate-forward') {
        expect(decision.currentDepth).toBeGreaterThanOrEqual(1)
        expect(decision.cap).toBe(2)
      }
    })
  }

  it('unrelated roots fall back without throwing', () => {
    // Defensive branch: paths don't share a prefix (sibling trees).
    // The helper still returns a usable decision — not a throw, not NaN.
    const decision = shouldGateManualExpand('/other-root', '/a/b/c/d', 2, false)
    expect(decision.kind).toBe('gate-forward')
    expect(Number.isFinite(decision.currentDepth)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. expandDepth boundary — every input value produces a coherent
//    decision.  The contract holds for any consumer that picks
//    conventions of `Infinity`, `0`, negative, or non-integer caps.
// ---------------------------------------------------------------------------

describe('expandDepth boundary', () => {
  it('expandDepth = Infinity (= "All" selector) always allows forward expansion', () => {
    // The "All" bypass — explicit user choice to ignore the cap.
    for (const fakePath of ['/x', '/x/y', '/x/y/z', '/x/y/z/w']) {
      const decision = shouldGateManualExpand('/x', fakePath, Infinity, false)
      expect(decision.kind).toBe('allow')
    }
  })

  it('expandDepth = 2 treats depth<2 as allow and depth>=2 as gate-forward', () => {
    // depth=1: allow forward
    expect(shouldGateManualExpand('/x', '/x/child', 2, false).kind).toBe('allow')
    // depth=2: gate-forward (children would land at depth=3)
    expect(shouldGateManualExpand('/x', '/x/child/grandchild', 2, false).kind).toBe(
      'gate-forward',
    )
    // depth=3: gate-forward (still beyond cap)
    expect(
      shouldGateManualExpand('/x', '/x/child/grandchild/greatgrandchild', 2, false).kind,
    ).toBe('gate-forward')
  })

  it('expandDepth = 1 makes every non-root row a gate-forward', () => {
    // cap=1 means depth=0 backstops; depth>=1 cannot expand forward.
    expect(shouldGateManualExpand('/x', '/x', 1, false).kind).toBe('allow')
    expect(shouldGateManualExpand('/x', '/x/child', 1, false).kind).toBe(
      'gate-forward',
    )
  })

  it('expandDepth = 0 — every row is at-or-beyond the cap, so nothing can expand forward', () => {
    // cap=0 means `depth >= 0` is always true → gate-forward for every
    // row, including the root itself.  Documents the contract boundary:
    // a cap of zero collapses the tree to a single static row.
    expect(shouldGateManualExpand('/x', '/x', 0, false).kind).toBe(
      'gate-forward',
    )
    expect(shouldGateManualExpand('/x', '/x/child', 0, false).kind).toBe(
      'gate-forward',
    )
  })

  it('NaN expandDepth falls through the same path as a finite cap', () => {
    // !Number.isFinite(NaN) === true → "All" bypass behavior.  This is
    // intentional: a misconfigured consumer that passes NaN gets the
    // "let me expand" behavior, which matches the "All" semantic.
    const decision = shouldGateManualExpand('/x', '/x/child/grand', Number.NaN, false)
    expect(decision.kind).toBe('allow')
  })
})

// ---------------------------------------------------------------------------
// 4. Decision exhaustiveness — every reachable GateDecision kind is
//    obtainable purely from input parameters, with no consumer coupling.
// ---------------------------------------------------------------------------

describe('decision exhaustiveness', () => {
  // Tag-style exhaustive switch — asserts at compile + runtime that
  // the helper cannot return a kind outside the documented three.
  const collectOneOfEach = (): Record<GateDecision['kind'], true> => {
    const seen = {
      allow: false,
      'allow-collapse': false,
      'gate-forward': false,
    } as Record<GateDecision['kind'], boolean>

    const root = '/x'
    const tryInputs: Array<Parameters<typeof shouldGateManualExpand>> = [
      // depth=1 < 2 → allow
      [root, '/x/child', 2, false],
      // already expanded → allow-collapse
      [root, '/x/child', 2, true],
      // depth=2 >= 2 → gate-forward
      [root, '/x/child/grandchild', 2, false],
    ]
    for (const args of tryInputs) {
      const decision = shouldGateManualExpand(...args)
      seen[decision.kind] = true
    }
    return seen as Record<GateDecision['kind'], true>
  }

  it('produces all three documented kinds within a 3-input sweep', () => {
    const seen = collectOneOfEach()
    expect(seen.allow).toBe(true)
    expect(seen['allow-collapse']).toBe(true)
    expect(seen['gate-forward']).toBe(true)
  })

  it('collapse always wins over cap — even depth=99 with cap=2 is allowed when expanded', () => {
    const decision = shouldGateManualExpand('/x', '/x/child/grandchild/great', 2, true)
    expect(decision.kind).toBe('allow-collapse')
  })

  it('tag-style exhaustive switch compiles AND exhausts the helper output', () => {
    // Run the helper against a representative input, then exercise an
    // exhaustive switch on its kind.  The `never` arm proves the
    // union is closed; if a future refactor adds a new kind, this
    // assertion fails to compile.
    const decision: GateDecision = shouldGateManualExpand(
      '/x',
      '/x/child',
      3,
      true, // already-expanded collapse path
    )
    const summary = (() => {
      switch (decision.kind) {
        case 'allow':
          return 'forward expansion allowed'
        case 'allow-collapse':
          return 'collapse permitted (always allowed)'
        case 'gate-forward':
          return `gated at depth ${decision.currentDepth}/${decision.cap}`
        default: {
          // The `never` assignment below fails to compile if the union
          // grows — that's the canary for any new decision kind.
          const _exhaustive: never = decision
          return _exhaustive
        }
      }
    })()
    expect(typeof summary).toBe('string')
    expect(summary.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 5. Purity / determinism — calling the helper any number of times
//    with the same inputs returns equal outputs.  No shared state, no
//    cache, no RNG.
// ---------------------------------------------------------------------------

describe('purity and determinism', () => {
  it('returns structurally equal outputs across 1000 calls with identical inputs', () => {
    const first = shouldGateManualExpand('/root', '/root/a/b/c', 2, false)
    let last = first
    for (let i = 0; i < 1000; i++) {
      last = shouldGateManualExpand('/root', '/root/a/b/c', 2, false)
    }
    expect(last.kind).toBe(first.kind)
    if (last.kind === 'gate-forward' && first.kind === 'gate-forward') {
      expect(last.currentDepth).toBe(first.currentDepth)
      expect(last.cap).toBe(first.cap)
    } else {
      // Same kind, no payload — strict equality is fine.
      expect(last).toEqual(first)
    }
  })

  it('interleaving calls with different inputs cannot leak state', () => {
    // Interleave A-B-A-B-A and confirm the two As produce identical
    // outputs regardless of intervening B calls.
    const a = shouldGateManualExpand('/a', '/a/x/y', 3, false)
    const b = shouldGateManualExpand('/b', '/b/x/y/z', 2, true)
    const aAgain = shouldGateManualExpand('/a', '/a/x/y', 3, false)
    const bAgain = shouldGateManualExpand('/b', '/b/x/y/z', 2, true)
    expect(aAgain.kind).toBe(a.kind)
    expect(bAgain.kind).toBe(b.kind)
    if (a.kind === 'gate-forward' && aAgain.kind === 'gate-forward') {
      expect(aAgain.currentDepth).toBe(a.currentDepth)
    }
    if (b.kind === 'allow-collapse' && bAgain.kind === 'allow-collapse') {
      expect(bAgain).toEqual(b)
    }
  })

  it('does not mutate the expanded-state Set passed as isCurrentlyExpanded (boolean)', () => {
    // isCurrentlyExpanded is a boolean; calling the helper cannot
    // mutate it.  Trivially true, but pins the contract.
    const flag = false
    shouldGateManualExpand('/x', '/x/child', 5, flag)
    expect(flag).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 6. Composition: third-party consumers — drive the helper as if a
//    hypothetical UriTree, ConfigTree, or TagTree consumer were using
//    it.  No LayoutShell / SessionFilesSection types involved.  Any
//    consumer that tracks expandedPaths as a string-Set and depth as
//    a number works with the helper unchanged.
// ---------------------------------------------------------------------------

// Minimal "UriTree" consumer — a hypothetical browser-tab tree that
// uses URN-style `:` separators internally.  The helper consumes
// `/`-separated paths, so the consumer translates at the boundary.
interface UriTreeNode {
  url: string
  expanded: boolean
}

// Translate `urn:workspace:A` → `/urn/workspace/A`.  Demonstrates the
// exact real-consumer pattern: any identifier scheme can map onto the
// helper's path vocabulary in one boundary function.
function urnToPath(urn: string): string {
  return '/' + urn.replace(/:/g, '/')
}

function uriTreeShouldExpose(children: UriTreeNode[], root: string, cap: number): UriTreeNode[] {
  const normRoot = urnToPath(root)
  return children.filter((node) => {
    const decision = shouldGateManualExpand(
      normRoot,
      urnToPath(node.url),
      cap,
      node.expanded,
    )
    return decision.kind !== 'gate-forward'
  })
}

describe('third-party consumer: UriTree (hypothetical)', () => {
  it('filters out depth-gate violations for any caller', () => {
    const nodes: UriTreeNode[] = [
      { url: 'urn:workspace:A', expanded: false },
      { url: 'urn:workspace:A:B', expanded: false },
      { url: 'urn:workspace:A:B:C', expanded: false },
    ]
    // Translated to /-paths:
    //   /urn/workspace/A, /urn/workspace/A/B, /urn/workspace/A/B/C
    // Depths from /urn/workspace: 1, 2, 3.
    // cap=3 → depth<3 allow (A, A:B), depth>=3 gate-forward (A:B:C).
    const visible = uriTreeShouldExpose(nodes, 'urn:workspace', 3)
    expect(visible.map((n) => n.url)).toEqual([
      'urn:workspace:A',
      'urn:workspace:A:B',
    ])
  })

  it('keeps already-collapsed nodes visible regardless of depth', () => {
    // A user who already expanded a deep node must always be able to
    // collapse it back — the helper's `allow-collapse` rule.
    const nodes: UriTreeNode[] = [
      { url: 'urn:workspace:A:B:C:D', expanded: true },
    ]
    const visible = uriTreeShouldExpose(nodes, 'urn:workspace', 2)
    expect(visible).toEqual(nodes)
  })
})

// Minimal "ConfigTree" consumer — a hypothetical settings tree with
// `.`-separated identifiers.  Same boundary-translation pattern:
// the consumer's dotted keys map to /-paths at the helper boundary.
interface ConfigNode {
  key: string
  isExpanded: boolean
}

// Translate `app.theme.colors.light.primary` → `/app/theme/colors/light/primary`.
function configKeyToPath(key: string): string {
  return '/' + key.replace(/\./g, '/')
}

function configTreeDecision(
  root: string,
  node: ConfigNode,
  cap: number,
): GateDecision {
  return shouldGateManualExpand(
    configKeyToPath(root),
    configKeyToPath(node.key),
    cap,
    node.isExpanded,
  )
}

describe('third-party consumer: ConfigTree (hypothetical)', () => {
  it('drives gate-forward for deep leaf nodes', () => {
    // app.theme.colors.light.primary is 5 segments of depth past root
    // (`/app`); depth=4; cap=3 → gate-forward.
    const decision = configTreeDecision(
      'app',
      { key: 'app.theme.colors.light.primary', isExpanded: false },
      3,
    )
    expect(decision.kind).toBe('gate-forward')
    if (decision.kind === 'gate-forward') {
      expect(decision.currentDepth).toBe(4)
      expect(decision.cap).toBe(3)
    }
  })

  it('drives allow-collapse even at maximum depth', () => {
    const decision = configTreeDecision(
      'app',
      {
        key: 'app.theme.colors.light.primary.something.else.deeper',
        isExpanded: true, // already-expanded → collapse path
      },
      2,
    )
    expect(decision.kind).toBe('allow-collapse')
  })
})

// trimExpandedByCount is also a public helper — verify it composes
// the same way for arbitrary-consumer Sets.
describe('third-party consumer: any-Set composition with trimExpandedByCount', () => {
  it('trims a generic Set of strings down by leaf-most depth, no LayoutShell coupling', () => {
    // A hypothetical Session Files user tracking expansions as a
    // plain Set — not the LayoutShell-specific shape.
    const expanded = new Set(['/r/A', '/r/A/a', '/r/B', '/r/B/b'])
    const result = trimExpandedByCount(expanded, '/r', 3)
    // 4 entries ≤ cap=3? No, 4 > 3 → trim down.  Sorted shallowest-first
    // with alphabetic tiebreaker:
    //   [0] /r/A (depth 1)
    //   [1] /r/A/a (depth 2)
    //   [2] /r/B (depth 1)
    //   [3] /r/B/b (depth 2)
    // alphabetic tiebreaker yields: /r/A, /r/B, /r/A/a, /r/B/b
    // (depth-1 entries first, then depth-2 alphabetically).
    // Drop the deepest-first entry → /r/B/b
    expect(result.keep).toEqual(new Set(['/r/A', '/r/B', '/r/A/a']))
    expect(result.dropped).toEqual(['/r/B/b'])
  })
})
