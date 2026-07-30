/**
 * treeBfsGate.ts — pure tree-policy helpers shared across every file-tree
 * component in the app.
 *
 * Two orthogonal guardrails compose into one tree-policy contract:
 *
 *   - depth=N  (shouldGateManualExpand)   — controls *how deep* each branch can go
 *   - count=K  (trimExpandedByCount)      — controls *how many* branches can stay open
 *
 * Both are pure (no React, no DOM, no IPC) so any tree consumer —
 * LayoutShell, SessionFilesSection, a future MCP file-tree panel — gets
 * the same contract for the cost of one import.
 *
 * Edge-counting model:
 *
 *   wdRootPath       → depth 0 (root; never has a chevron in the UI but
 *                       handled defensively for completeness)
 *   wdRootPath/a     → depth 1
 *   wdRootPath/a/b   → depth 2
 *   ...
 *
 * For expandDepth = N:
 *   - Nodes at depth < N → can be expanded (their children at depth+1 ≤ N)
 *   - Nodes at depth >= N → gated (their children would land at N+1+)
 *
 * Infinity ("All") is the explicit escape hatch — never gated.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Decision returned by `shouldGateManualExpand`.
 *
 *   - `allow`: forward expansion proceeds (depth within cap, or Infinity).
 *   - `gate-forward`: forward expansion refused because it would exceed
 *     expandDepth. The user can bump the depth selector.
 *   - `allow-collapse`: the dirPath is already in the expanded set, so the
 *     click is a *collapse*. Collapse is never gated — users must always
 *     be able to back out of an accidental expansion, including ones
 *     beyond the current cap.
 */
export type GateDecision =
  | { kind: 'allow' }
  | { kind: 'allow-collapse' }
  | { kind: 'gate-forward'; currentDepth: number; cap: number }

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Split a path into segments on either native separator. Mirrors the
 * cross-platform pattern used elsewhere in the renderer.
 *
 *   "/a/b/c".split(...) → ["a", "b", "c"]
 *   "C:\\a\\b".split(...) → ["C:", "a", "b"]
 *   "/a//b/".split(...) → ["a", "b"]   (consecutive/edge slashes collapsed,
 *                                       empty segments dropped)
 */
export function splitPathSegments(p: string): string[] {
  return p.split(/[/\\]+/).filter((s) => s.length > 0)
}

/**
 * Compute the depth of `dirPath` relative to `wdRootPath`, measured as
 * edges (path segments) between them. Returns 0 when both refer to the
 * same directory.
 *
 * Defensive fallbacks: if `dirPath` doesn't share `wdRootPath`'s leading
 * segments (e.g. user passed a sibling tree), we still return the
 * segment-difference so callers don't have to special-case `NaN`.
 *
 * Caveat: that fallback is *approximate*, not authoritative.  In the
 * normal flow, the IPC layer guarantees `dirPath` is rooted under
 * `wdRootPath`, so the prefix-match branch fires and the answer is
 * exact.  The fallback only runs for pathologically wrong input that
 * shouldn't reach this helper in production.  Callers that trust the
 * result for permission decisions or destructive actions should
 * separately verify the prefix relationship before relying on it.
 */
export function computeDepthFromRoot(wdRootPath: string, dirPath: string): number {
  const rootSegs = splitPathSegments(wdRootPath)
  const dirSegs = splitPathSegments(dirPath)

  // Same-directory case: walk both arrays; if all segments match and lengths
  // are equal, depth = 0.
  if (rootSegs.length === dirSegs.length && rootSegs.every((s, i) => s === dirSegs[i])) {
    return 0
  }

  // If dirPath is rooted under wdRootPath (dirSegs starts with rootSegs),
  // the depth is the segment count beyond the root.
  const isUnderRoot =
    dirSegs.length >= rootSegs.length && rootSegs.every((s, i) => dirSegs[i] === s)
  if (isUnderRoot) {
    return dirSegs.length - rootSegs.length
  }

  // Defensive: different/no-overlap roots. Return length difference so
  // callers don't get NaN; the gate will still produce a usable decision
  // (likely gate-forward, which is the safe default).
  return Math.max(0, dirSegs.length - rootSegs.length)
}

// ---------------------------------------------------------------------------
// Gate decision
// ---------------------------------------------------------------------------

/**
 * Decide whether a click on `dirPath` should be allowed to expand the
 * tree beyond its current expansion set.
 *
 *   - `expandedPaths.has(dirPath)` is checked first because the click is a
 *     collapse → always allowed. Users must be able to undo an
 *     accidental expansion, including ones past the current cap.
 *   - `expandDepth === Infinity` ("All") → always allowed; this is the
 *     user's explicit escape hatch.
 *   - Finite `expandDepth` → gate iff `computeDepth >= expandDepth`.
 *     Expanding a node at the cap would expose children at cap+1.
 *
 * @param wdRootPath    the working-directory root (depth 0)
 * @param dirPath       the row the user clicked
 * @param expandDepth   current depth-cap selector value (Infinity = no cap)
 * @param isCurrentlyExpanded  whether `dirPath` is already expanded
 */
export function shouldGateManualExpand(
  wdRootPath: string,
  dirPath: string,
  expandDepth: number,
  isCurrentlyExpanded: boolean,
): GateDecision {
  // Collapse is always allowed — the user must be able to back out.
  if (isCurrentlyExpanded) {
    return { kind: 'allow-collapse' }
  }

  // Infinity ("All") is the explicit bypass selector — never gate.
  if (!Number.isFinite(expandDepth)) {
    return { kind: 'allow' }
  }

  const depth = computeDepthFromRoot(wdRootPath, dirPath)

  // Boundary: depth strictly less than the cap means adding children at
  // depth+1, which is still within the cap. depth equal to the cap means
  // adding children at cap+1, which is precisely one beyond — gate.
  if (depth >= expandDepth) {
    return { kind: 'gate-forward', currentDepth: depth, cap: expandDepth }
  }

  return { kind: 'allow' }
}

// ---------------------------------------------------------------------------
// Cumulative count cap
// ---------------------------------------------------------------------------

/** Result of trimming expandedPaths down to a count limit. */
export interface TrimResult {
  /** The trimmed set of paths to keep (size ≤ maxOpenDirs). */
  keep: Set<string>
  /** Paths that were dropped, sorted deepest-first (leaf-most collapsed). */
  dropped: string[]
}

/**
 * Trim `expandedPaths` down to at most `maxOpenDirs` entries by collapsing
 * the leaf-most (deepest) directories.  Composes orthogonally with
 * `shouldGateManualExpand`:
 *
 *   - depth=N controls *how deep* each branch can go
 *   - count=K controls *how many* branches can stay open simultaneously
 *
 * When the set is already within the limit the returned `keep` is a clone
 * of the input and `dropped` is empty — callers can skip state writes
 * without branching.
 *
 * Pinned directories (passed via `pinnedPaths`) are exempt from eviction:
 *
 *   - The full pinned set is always retained in `keep`, even if its size
 *     alone exceeds `maxOpenDirs`. In that case the helper returns a
 *     no-op (`dropped=[]`) rather than violating the user's pinning —
 *     it's better to accept a temporary cap breach than to silently
 *     evict a dir the user explicitly protected.
 *   - Within the remaining budget (`maxOpenDirs - pinnedCount`), the
 *     unpinned paths are ranked by depth (shallowest-first) with an
 *     alphabetic tiebreaker.
 *   - The caller is responsible for surfacing the over-cap condition in
 *     the UI (e.g. an indicator chip or a toast); this helper returns
 *     `{ keep, dropped: [] }` so the caller's no-op branch is hit and
 *     no setState churn is generated.
 *
 * Tiebreaker: when two paths have equal depth, alphabetic ordering is
 * used so the same entries are consistently chosen across calls.
 *
 * @param expandedPaths   currently-open directories
 * @param wdRootPath      root for depth computation (depth 0)
 * @param maxOpenDirs     maximum number of directories to keep open
 * @param pinnedPaths     directories the user has explicitly pinned —
 *                        these are never evicted. Optional; when omitted
 *                        or empty, behaviour matches the unpinned-only
 *                        contract.
 */
export function trimExpandedByCount(
  expandedPaths: Set<string>,
  wdRootPath: string,
  maxOpenDirs: number,
  pinnedPaths: ReadonlySet<string> = new Set(),
): TrimResult {
  if (expandedPaths.size <= maxOpenDirs) {
    return { keep: new Set(expandedPaths), dropped: [] }
  }

  // Partition into pinned (always kept) and unpinned (candidates for
  // eviction).  Pinned paths never count against the trim budget — the
  // budget is "how many additional (unpinned) dirs we can keep open
  // alongside the pinned set."
  const pinnedInSet: string[] = []
  const unpinnedEntries: Array<{ path: string; depth: number }> = []
  for (const path of expandedPaths) {
    if (pinnedPaths.has(path)) {
      pinnedInSet.push(path)
    } else {
      unpinnedEntries.push({
        path,
        depth: computeDepthFromRoot(wdRootPath, path),
      })
    }
  }

  // All-pinned (or all-protected-by-pin) over-cap case: caller wants
  // every dir kept; the count cap loses to the user's explicit pins.
  // Return no-op rather than fabricating a dropped list that the caller
  // would have to suppress anyway.  The caller still sees
  // `expandedPaths.size > maxOpenDirs` via its own length check, so it
  // can surface a chip/toast informing the user.
  if (pinnedInSet.length >= maxOpenDirs) {
    return { keep: new Set(expandedPaths), dropped: [] }
  }

  const budget = maxOpenDirs - pinnedInSet.length

  // Sort unpinned shallowest-first with alphabetic tiebreaker.
  unpinnedEntries.sort((a, b) =>
    a.depth - b.depth || a.path.localeCompare(b.path),
  )

  const keep = new Set<string>(pinnedInSet)
  for (let i = 0; i < budget && i < unpinnedEntries.length; i++) {
    keep.add(unpinnedEntries[i]!.path)
  }

  const dropped = unpinnedEntries.slice(budget).map((e) => e.path)
  // Reverse so callers see deepest-first (the collapse order).
  dropped.reverse()

  return { keep, dropped }
}
