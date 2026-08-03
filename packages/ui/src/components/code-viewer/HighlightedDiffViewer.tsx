/**
 * HighlightedDiffViewer — lightweight regex-based diff viewer.
 *
 * Renders original and modified content side-by-side (or unified) with
 * per-line syntax highlighting via the tokenizer.  Designed as a simpler,
 * zero-dependency alternative to ShikiDiffViewer for inline diff panels
 * where loading a full Shiki grammar would be wasteful.
 */

import './HighlightedDiffViewer.css'

import * as React from 'react'
import { useMemo, useState, useCallback } from 'react'
import { tokenizeLine, detectCodeLanguageFromPath, type TokenSpan } from './tokenizer'

// Scoped styles for the expandable separator — hover, focus-visible, and
// the expanded variant.  Inlined because the component ships as a
// zero-dependency utility and we want the affordance to live with the
// usage.  Rules are namespaced under `.hl-diff-viewer` so they only
// apply inside one viewer instance and never leak to other surfaces.
const HL_DIFF_SEP_STYLES = `
.hl-diff-viewer .hl-diff-hunk-sep:hover {
  background: color-mix(in oklch, var(--foreground) 9%, transparent);
}
.hl-diff-viewer .hl-diff-hunk-sep:focus-visible {
  outline: 2px solid color-mix(in oklch, var(--brand-purple, var(--foreground)) 50%, transparent);
  outline-offset: -2px;
}
.hl-diff-viewer .hl-diff-hunk-sep:active {
  background: color-mix(in oklch, var(--foreground) 14%, transparent);
}
/* Color shift + chevron rotation together mark the bar as 'active content
   you're viewing' rather than 'skipped context.' Both of the .is-expanded
   rules here form one visual contract — collapsing either without the
   other would leave the row visually ambiguous. */
.hl-diff-viewer .hl-diff-hunk-sep.is-expanded {
  color: var(--foreground);
}
.hl-diff-viewer .hl-diff-hunk-sep .hl-diff-hunk-sep__chevron {
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 4px solid currentColor;
  transition: transform 150ms ease;
}
.hl-diff-viewer .hl-diff-hunk-sep.is-expanded .hl-diff-hunk-sep__chevron {
  transform: rotate(180deg);
}

/* ── Split view ───────────────────────────────────────────────────
   Two-column side-by-side rendering. Each row is a 4-column grid:
   [oldGutter 32px][oldText 1fr][newGutter 32px][newText 1fr]. The
   modifiers below tint changed sides while keeping the gutter aligned
   across both halves — paired add/del rows visually cancel into one
   row via shared height. Empty cells (the shorter side when dels
   and adds have unequal counts) carry no number and stay neutral. */
.hl-diff-viewer .hl-diff-split-row {
  display: grid;
  grid-template-columns: 32px 1fr 32px 1fr;
  align-items: stretch;
  min-height: 14px;
}
.hl-diff-viewer .hl-diff-split-gutter {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 6px;
  flex-shrink: 0;
  font-size: 8px;
  user-select: none;
  color: var(--shell-text-dim);
  background: var(--shell-surface-muted);
  border-right: 1px solid var(--shell-border-soft);
}
.hl-diff-viewer .hl-diff-split-gutter--empty {
  background: transparent;
  border-right-color: var(--shell-border-soft);
}
.hl-diff-viewer .hl-diff-split-cell {
  padding: 0 8px;
  white-space: pre;
  overflow-x: auto;
  color: var(--foreground);
}
.hl-diff-viewer .hl-diff-split-cell--empty {
  background: color-mix(in oklch, var(--foreground) 3%, transparent);
}
.hl-diff-viewer .hl-diff-split-row--del .hl-diff-split-cell--left {
  background: color-mix(in oklch, var(--destructive) 6%, transparent);
}
.hl-diff-viewer .hl-diff-split-row--add .hl-diff-split-cell--right {
  background: color-mix(in oklch, var(--success) 6%, transparent);
}
.hl-diff-viewer .hl-diff-split-cell__indicator {
  display: inline-block;
  width: 14px;
  font-size: 9px;
  font-weight: 700;
  user-select: none;
}
`

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiffViewMode = 'hunks' | 'full' | 'split'

export interface HighlightedDiffViewerProps {
  /** Original (before) content */
  original: string
  /** Modified (after) content */
  modified: string
  /** File path for language detection */
  filePath?: string
  /** Explicit language id (overrides file-path detection) */
  language?: string
  /** Max rendered height before scrolling (CSS value, e.g. '240px') */
  maxHeight?: string
  /** Number of unchanged context lines to show around each changed region.
   *  Default 3 — matches `git diff` convention. Set 0 to render only changed lines.
   *  @deprecated Use the `mode: 'full'` prop for whole-file rendering.
   *  `Infinity` still works for back-compat but is no longer recommended. */
  contextLines?: number
  /** Rendering mode. `'hunks'` collapses unchanged regions to N context
   *  lines (controlled by `contextLines`); `'full'` renders everything
   *  linearly with no separators. Default `'hunks'`. */
  mode?: DiffViewMode
  /** Additional class names */
  className?: string
}

interface DiffLine {
  kind: 'add' | 'del' | 'context'
  oldNum?: number
  newNum?: number
  text: string
}

/**
 * Split-mode row. Each row carries an explicit per-side Cell so the
 * grid layout always renders both columns — `kind: 'empty'` is a
 * legitimately-rendered empty cell (with gutter + soft bg), distinct
 * from rendering nothing at all. Pairing is greedy: max(del, add)
 * rows per consecutive change run, fills the longer side first.
 */
type SplitCellKind = 'add' | 'del' | 'context' | 'empty'
interface SplitCell {
  kind: SplitCellKind
  oldNum?: number
  newNum?: number
  text: string
}
interface SplitDiffRow {
  left: SplitCell
  right: SplitCell
}

// Right-align modifier so the diff's '+' / '-' sign indicator stays
// close to the gutter rather than floating left in the cell.
const SPLIT_HALF_INDICATORS: Record<SplitCellKind, string> = {
  add: '+',
  del: '-',
  context: ' ',
  empty: '',
}

/**
 * Walk the flat diff line array and pair adjacent changes into
 * aligned rows for the split view. Pure context lines map 1:1 to
 * (ctx, ctx). Runs of dels + adds become max(N, M) rows — empty
 * cells on the shorter side carry no number and no text. The
 * algorithm preserves the input ordering of dels-before-adds that
 * `computeDiff` produces.
 */
function alignLinesToRows(diffLines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  let i = 0
  while (i < diffLines.length) {
    // `i < length` guarantees a hit; the assertions satisfy
    // noUncheckedIndexedAccess without widening the row types.
    const line = diffLines[i]!
    if (line.kind === 'context') {
      rows.push({
        left: { kind: 'context', oldNum: line.oldNum, text: line.text },
        right: { kind: 'context', newNum: line.newNum, text: line.text },
      })
      i++
      continue
    }
    // Consume a contiguous run of non-context lines.
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (i < diffLines.length) {
      const next = diffLines[i]!
      if (next.kind === 'context') break
      if (next.kind === 'del') dels.push(next)
      else adds.push(next)
      i++
    }
    const pairCount = Math.max(dels.length, adds.length)
    for (let k = 0; k < pairCount; k++) {
      const dl = dels[k]
      const al = adds[k]
      rows.push({
        left: dl
          ? { kind: 'del', oldNum: dl.oldNum, text: dl.text }
          : { kind: 'empty', text: '' },
        right: al
          ? { kind: 'add', newNum: al.newNum, text: al.text }
          : { kind: 'empty', text: '' },
      })
    }
  }
  return rows
}

/** Input-line caps — bound the LCS DP table (O(m·n)) on large files.
 *  Hunked view keeps the smaller cap; full mode widens it so the user's
 *  "show me the whole file" intent isn't immediately truncated.  2000 is
 *  chosen as the upper edge where the table stays under ~32 MB on V8. */
const MAX_LINES_HUNKS = 500
const MAX_LINES_FULL = 2000

// ---------------------------------------------------------------------------
// Simple Myers-like diff (line-level only — not character-level)
// ---------------------------------------------------------------------------

function computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const m = oldLines.length
  const n = newLines.length

  // LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    // Hoist both rows: every index below is bounded by the loop, and caching
    // them keeps the inner loop free of repeated bounds-checked lookups.
    const row = dp[i]!
    const prevRow = dp[i - 1]!
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        row[j] = prevRow[j - 1]! + 1
      } else {
        row[j] = Math.max(prevRow[j]!, row[j - 1]!)
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ kind: 'context', oldNum: i, newNum: j, text: oldLines[i - 1]! })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.unshift({ kind: 'add', newNum: j, text: newLines[j - 1]! })
      j--
    } else {
      result.unshift({ kind: 'del', oldNum: i, text: oldLines[i - 1]! })
      i--
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Hunk extraction — like `git diff`, show N lines of context around changes
// ---------------------------------------------------------------------------

interface HunkEntry {
  lines: DiffLine[]
  /** Context gap size between this hunk and the previous one */
  gapLines: number
  /** Diff lines in the gap (skipped when collapsed, revealed when expanded) */
  hiddenLines: DiffLine[]
}

function extractHunks(diffLines: DiffLine[], contextLines: number): HunkEntry[] {
  // 'No hunking' is signalled by callers passing Infinity for contextLines
  // — a JS-native sentinel that reads as intent rather than coupling to
  // the hunk-mode input cap (MAX_LINES_HUNKS). This is the only signal
  // the component uses; the `< 0` legacy escape hatch was dropped when
  // the `mode` prop landed (use `mode: 'full'` instead).
  if (contextLines === Infinity) {
    // Full file — no hunking needed
    return [{ lines: diffLines, gapLines: 0, hiddenLines: [] }]
  }

  const n = diffLines.length

  // Mark which indices are "changed" (add or del, not context)
  const changed = new Set<number>()
  for (const [i, line] of diffLines.entries()) {
    if (line.kind !== 'context') {
      changed.add(i)
    }
  }

  if (changed.size === 0) {
    // No changes at all — show a summary if contextLines > 0, else return
    // an empty array so the caller renders a placeholder.
    if (contextLines === 0) return []
    const preview = diffLines.slice(0, Math.min(contextLines, n))
    return [{ lines: preview, gapLines: 0, hiddenLines: [] }]
  }

  // Expand each changed index to include contextLines before and after
  const visible = new Set<number>()
  for (const ci of changed) {
    const start = Math.max(0, ci - contextLines)
    const end = Math.min(n - 1, ci + contextLines)
    for (let j = start; j <= end; j++) {
      visible.add(j)
    }
  }

  // Group consecutive visible indices into hunks
  const hunks: HunkEntry[] = []
  let hunkStart = -1
  let prevEnd = -1

  for (let i = 0; i < n; i++) {
    if (visible.has(i)) {
      if (hunkStart === -1) {
        hunkStart = i
      }
    } else if (hunkStart !== -1) {
      const gapLines = prevEnd === -1 ? 0 : hunkStart - prevEnd - 1
      hunks.push({
        lines: diffLines.slice(hunkStart, i),
        gapLines: Math.max(0, gapLines),
        hiddenLines: prevEnd === -1 ? [] : diffLines.slice(prevEnd + 1, hunkStart),
      })
      prevEnd = i - 1
      hunkStart = -1
    }
  }

  // Flush the last hunk if we ended inside one
  if (hunkStart !== -1) {
    const gapLines = prevEnd === -1 ? 0 : hunkStart - prevEnd - 1
    hunks.push({
      lines: diffLines.slice(hunkStart),
      gapLines: Math.max(0, gapLines),
      hiddenLines: prevEnd === -1 ? [] : diffLines.slice(prevEnd + 1, hunkStart),
    })
  }

  return hunks
}

// ---------------------------------------------------------------------------
// Line renderer
// ---------------------------------------------------------------------------

function HighlightedLine({
  text,
  lang,
}: {
  text: string
  lang: string
}) {
  const spans = useMemo((): TokenSpan[] => {
    if (!lang || !text) return []
    return tokenizeLine(text, lang)
  }, [text, lang])

  if (spans.length === 0) {
    return <span>{text}</span>
  }

  const children: React.ReactNode[] = []
  let pos = 0

  for (const [i, s] of spans.entries()) {
    if (s.start > pos) {
      children.push(<span key={`t${pos}`}>{text.slice(pos, s.start)}</span>)
    }
    children.push(
      <span key={`s${i}`} className={`hl-${s.className}`}>
        {text.slice(s.start, s.end)}
      </span>,
    )
    pos = s.end
  }
  if (pos < text.length) {
    children.push(<span key={`t${pos}`}>{text.slice(pos)}</span>)
  }

  return <>{children}</>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HighlightedDiffViewer({
  original,
  modified,
  filePath = '',
  language,
  maxHeight = '240px',
  contextLines = 3,
  mode = 'hunks',
  className,
}: HighlightedDiffViewerProps) {
  // `mode === 'full'` widens the input-line cap and signals 'no hunking'
  // to extractHunks simultaneously. The two derived values share the
  // same mode source so they stay in lockstep without coordination.
  const maxLines = mode === 'full' ? MAX_LINES_FULL : MAX_LINES_HUNKS
  // Match extractHunks' early-return sentinel. Carrying the comment on
  // the variable it explains keeps the 'no hunking = Infinity' contract
  // local rather than dangling in a multi-line block above.
  const effectiveContextLines = mode === 'full' ? Infinity : contextLines
  const lang = useMemo(
    () => language || detectCodeLanguageFromPath(filePath),
    [language, filePath],
  )

  const oldLines = useMemo(() => {
    const lines = original.split('\n')
    return lines.length > maxLines ? lines.slice(0, maxLines) : lines
  }, [original, maxLines])
  const newLines = useMemo(() => {
    const lines = modified.split('\n')
    return lines.length > maxLines ? lines.slice(0, maxLines) : lines
  }, [modified, maxLines])

  const diffLines = useMemo(
    () => computeDiff(oldLines, newLines),
    [oldLines, newLines],
  )

  const hunks = useMemo(
    () => extractHunks(diffLines, effectiveContextLines),
    [diffLines, effectiveContextLines],
  )

  // Split-mode row alignment runs only when mode === 'split'. Split view
  // skips extractHunks entirely because the row-pairing layout naturally
  // accounts for all change runs — there are no gaps to collapse, so
  // hunks/separation semantics don't apply.
  const splitRows = useMemo(
    () => (mode === 'split' ? alignLinesToRows(diffLines) : null),
    [diffLines, mode],
  )

  // Track which inter-hunk gaps are expanded to reveal the skipped context.
  // Indexed by target hunk: gapLines on hunks[hi] is the gap BEFORE hunks[hi],
  // so toggling `hi` reveals the lines between hunks[hi-1] and hunks[hi].
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(new Set())
  const toggleGap = useCallback((gapIndex: number) => {
    setExpandedGaps(prev => {
      const next = new Set(prev)
      if (next.has(gapIndex)) next.delete(gapIndex)
      else next.add(gapIndex)
      return next
    })
  }, [])

  // Render a single diff line
  const renderDiffLine = (line: DiffLine, i: number) => (
    <div
      key={i}
      className={`hl-diff-line hl-diff-line--${line.kind}`}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        minHeight: '14px',
        background:
          line.kind === 'add'
            ? 'color-mix(in oklch, var(--success) 6%, transparent)'
            : line.kind === 'del'
              ? 'color-mix(in oklch, var(--destructive) 6%, transparent)'
              : undefined,
      }}
    >
      {/* Line numbers */}
      <span
        className="hl-diff-num hl-diff-num--old"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          flexShrink: 0,
          width: '32px',
          padding: '0 6px',
          color: 'var(--shell-text-dim)',
          fontSize: '8px',
          userSelect: 'none',
          borderRight: '1px solid var(--shell-border-soft)',
          background: 'var(--shell-surface-muted)',
        }}
      >
        {line.oldNum ?? ''}
      </span>
      <span
        className="hl-diff-num hl-diff-num--new"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          flexShrink: 0,
          width: '32px',
          padding: '0 6px',
          color: 'var(--shell-text-dim)',
          fontSize: '8px',
          userSelect: 'none',
          borderRight: '1px solid var(--shell-border-soft)',
          background: 'var(--shell-surface-muted)',
        }}
      >
        {line.newNum ?? ''}
      </span>
      {/* Kind indicator */}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width: '18px',
          fontSize: '9px',
          fontWeight: 700,
          userSelect: 'none',
          color:
            line.kind === 'add'
              ? 'var(--success)'
              : line.kind === 'del'
                ? 'var(--destructive)'
                : 'var(--shell-text-dim)',
        }}
      >
        {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
      </span>
      {/* Highlighted text */}
      <span
        className="hl-diff-text"
        style={{
          flex: 1,
          padding: '0 8px',
          whiteSpace: 'pre',
          overflowX: 'auto',
          color: 'var(--foreground)',
        }}
      >
        <HighlightedLine text={line.text} lang={lang} />
      </span>
    </div>
  )

  const totalHunkLines = hunks.reduce((sum, h) => sum + h.lines.length, 0)
  const fullLineCount = original.split('\n').length

  return (
    <div
      className={`hl-diff-viewer${className ? ` ${className}` : ''}`}
      style={{
        maxHeight,
        overflowY: 'auto',
        fontFamily: 'var(--font-mono, ui-monospace, "SF Mono", Monaco, monospace)',
        fontSize: '9px',
        lineHeight: 1.55,
        background: 'var(--shell-surface)',
        borderRadius: '0 0 6px 6px',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: HL_DIFF_SEP_STYLES }} />
      {mode === 'split' && splitRows && splitRows.length > 0 ? (
        splitRows.map((row, ri) => (
          <div
            key={`split-${ri}`}
            className={
              'hl-diff-split-row'
              + (row.left.kind !== 'empty' && row.right.kind !== 'empty'
                ? (row.left.kind === 'del' ? ' hl-diff-split-row--del' : '')
                  + (row.right.kind === 'add' ? ' hl-diff-split-row--add' : '')
                : '')
            }
            style={{
              display: 'grid',
              gridTemplateColumns: '32px 1fr 32px 1fr',
              alignItems: 'stretch',
              minHeight: '14px',
            }}
          >
            <div className={`hl-diff-split-gutter${row.left.kind === 'empty' ? ' hl-diff-split-gutter--empty' : ''}`}>
              {row.left.oldNum ?? ''}
            </div>
            <div className={`hl-diff-split-cell hl-diff-split-cell--${row.left.kind}`}>
              <span
                className="hl-diff-split-cell__indicator"
                style={{
                  color: row.left.kind === 'del'
                    ? 'var(--destructive)'
                    : row.left.kind === 'add'
                      ? 'var(--success)'
                      : 'var(--shell-text-dim)',
                }}
              >
                {SPLIT_HALF_INDICATORS[row.left.kind]}
              </span>
              {row.left.kind === 'empty' ? null : <HighlightedLine text={row.left.text} lang={lang} />}
            </div>
            <div className={`hl-diff-split-gutter${row.right.kind === 'empty' ? ' hl-diff-split-gutter--empty' : ''}`}>
              {row.right.newNum ?? ''}
            </div>
            <div className={`hl-diff-split-cell hl-diff-split-cell--${row.right.kind}`}>
              <span
                className="hl-diff-split-cell__indicator"
                style={{
                  color: row.right.kind === 'add'
                    ? 'var(--success)'
                    : row.right.kind === 'del'
                      ? 'var(--destructive)'
                      : 'var(--shell-text-dim)',
                }}
              >
                {SPLIT_HALF_INDICATORS[row.right.kind]}
              </span>
              {row.right.kind === 'empty' ? null : <HighlightedLine text={row.right.text} lang={lang} />}
            </div>
          </div>
        ))
      ) : hunks.length === 0 ? (
        <div
          style={{
            padding: '16px 12px',
            color: 'var(--shell-text-dim)',
            fontSize: '10px',
            fontStyle: 'italic',
            textAlign: 'center',
          }}
        >
          No changes to display
        </div>
      ) : (
        hunks.map((hunk, hi) => (
        <React.Fragment key={hi}>              {/* Hunk separator — click to reveal the skipped context.
                  gapLines on hunks[hi] is the gap BEFORE hunks[hi], so toggling
                  `hi` reveals the lines between hunks[hi-1] and hunks[hi]. */}
              {hunk.gapLines > 0 && (
                <button
                  type="button"
                  className={`hl-diff-hunk-sep${expandedGaps.has(hi) ? ' is-expanded' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '4px 0',
                    border: 0,
                    font: 'inherit',
                    color: 'var(--shell-text-dim)',
                    fontSize: '9px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    background: 'var(--shell-surface-muted)',
                    borderTop: '1px solid var(--shell-border-soft)',
                    borderBottom: '1px solid var(--shell-border-soft)',
                    transition: 'background 100ms ease, color 100ms ease',
                  }}
                  onClick={() => toggleGap(hi)}
                  aria-expanded={expandedGaps.has(hi)}
                  aria-label={expandedGaps.has(hi)
                    ? `Hide ${hunk.gapLines} unchanged line${hunk.gapLines !== 1 ? 's' : ''}`
                    : `Show ${hunk.gapLines} unchanged line${hunk.gapLines !== 1 ? 's' : ''}`}
                >
                  <span className="hl-diff-hunk-sep__chevron" aria-hidden="true" />
                  <span style={{ letterSpacing: '4px' }}>&middot;&middot;&middot;</span>
                  <span style={{ fontStyle: 'italic' }}>
                    {hunk.gapLines} unchanged line{hunk.gapLines !== 1 ? 's' : ''}{' '}
                    {expandedGaps.has(hi) ? 'shown' : 'skipped'}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: '8px', opacity: 0.7 }}>
                    {expandedGaps.has(hi) ? 'click to collapse' : 'click to expand'}
                  </span>
                </button>
              )}
              {/* Expanded hidden lines for this hunk's leading gap */}
              {hunk.gapLines > 0 && expandedGaps.has(hi) && hunk.hiddenLines.map((line, i) =>
                renderDiffLine(line, hi * 10000 + 5000 + i),
              )}
          {/* Hunk lines */}
          {hunk.lines.map((line, i) => renderDiffLine(line, hi * 10000 + i))}
        </React.Fragment>
      )))}
      {fullLineCount > maxLines && (
        <div
          style={{
            padding: '8px 12px',
            color: 'var(--shell-text-dim)',
            fontSize: '10px',
            fontStyle: 'italic',
            textAlign: 'center',
            borderTop: '1px solid var(--shell-border-soft)',
          }}
        >
          Truncated — showing first {maxLines} of {fullLineCount} lines (exceeds the full-mode cap; switch to Hunks mode for context grouping)
        </div>
      )}
      {/* Hide this footer in full mode — the single hunk already covers
          the full diff length. */}
      {mode === 'hunks' && hunks.length > 0 && totalHunkLines < diffLines.length && (
        <div
          style={{
            padding: '6px 12px',
            color: 'var(--shell-text-dim)',
            fontSize: '9px',
            fontStyle: 'italic',
            textAlign: 'center',
            borderTop: '1px solid var(--shell-border-soft)',
          }}
        >
          {hunks.length} hunk{hunks.length !== 1 ? 's' : ''} &middot; {totalHunkLines} of {diffLines.length} lines shown &middot; {contextLines === 0 ? 'All changes shown — no context' : `${contextLines} context line${contextLines !== 1 ? 's' : ''} around changes`}
        </div>
      )}
    </div>
  )
}
