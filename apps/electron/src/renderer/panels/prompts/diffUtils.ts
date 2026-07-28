/**
 * Simple LCS (Longest-Common-Subsequence) line diff utility.
 *
 * Returns an array of diff hunks, each with a `type` ('added' | 'removed' | 'unchanged')
 * and the line content. Added lines are prefixed with `+`, removed lines with `-`,
 * unchanged lines with `  `, matching the unified-diff convention.
 *
 * The algorithm is a standard Myers-like LCS approach — O(n*m) space/time, fine for
 * prompt-sized strings (typically <500 lines).
 */

export type DiffLine = {
  type: 'added' | 'removed' | 'unchanged'
  content: string
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  const n = oldLines.length
  const m = newLines.length

  // Build LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Trace back to build the diff
  const result: DiffLine[] = []
  let i = n
  let j = m

  // We'll collect in reverse, then reverse at the end
  const reversed: DiffLine[] = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      reversed.push({ type: 'unchanged', content: oldLines[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ type: 'added', content: newLines[j - 1] })
      j--
    } else if (i > 0) {
      reversed.push({ type: 'removed', content: oldLines[i - 1] })
      i--
    }
  }

  // Reverse to get correct order
  for (let k = reversed.length - 1; k >= 0; k--) {
    result.push(reversed[k])
  }

  return result
}

/**
 * Group consecutive lines of the same type into hunks, trimming unchanged edges.
 * This makes the diff display more readable — only shows regions that actually changed.
 */
export function groupDiffHunks(diff: DiffLine[]): DiffLine[] {
  // If everything is unchanged, return empty (no diff to show)
  const hasChanges = diff.some((l) => l.type !== 'unchanged')
  if (!hasChanges) return []

  // Find the range of changed lines, then show context of 2 unchanged lines around each hunk
  const ranges: { start: number; end: number }[] = []
  let inHunk = false
  let hunkStart = 0

  for (let i = 0; i < diff.length; i++) {
    if (diff[i].type !== 'unchanged') {
      if (!inHunk) {
        hunkStart = Math.max(0, i - 2) // 2 lines of context before
        inHunk = true
      }
    } else if (inHunk) {
      // Check if we've had 2+ unchanged lines — if so, close the hunk
      if (i > 1 && diff[i - 1].type === 'unchanged' && diff[i - 2]?.type === 'unchanged') {
        ranges.push({ start: hunkStart, end: i })
        inHunk = false
      }
    }
  }
  if (inHunk) {
    ranges.push({ start: hunkStart, end: diff.length })
  }

  // If no ranges found (edge case), return the whole diff
  if (ranges.length === 0) return diff

  // Merge overlapping ranges
  const merged: typeof ranges = []
  for (const r of ranges) {
    if (merged.length > 0 && r.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end)
    } else {
      merged.push({ ...r })
    }
  }

  // Extract the hunk lines
  const result: DiffLine[] = []
  for (const r of merged) {
    for (let i = r.start; i < r.end && i < diff.length; i++) {
      result.push(diff[i])
    }
  }

  return result
}
