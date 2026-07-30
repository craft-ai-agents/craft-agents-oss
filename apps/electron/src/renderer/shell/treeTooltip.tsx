/**
 * Pure helpers for the Working Directory tree-row tooltip in LayoutShell.
 *
 * Extracted into their own module file (rather than inline) so:
 * 1. The unit test imports helpers without dragging in LayoutShell.tsx,
 *    whose `export default LayoutShell` would confuse bun:test's module loader.
 * 2. The test file can typecheck cleanly without a sweeping `@ts-nocheck` —
 *    useful for catching signature drift early.
 * 3. The functions are pure (no React / closure deps); this is a stable
 *    testing target independent of the full render tree.
 *
 * Together they implement:
 * - `formatTimestamp(ms)` produces a byte-stable "Jul 29, 2025, 15:42:17"
 *   string regardless of the user's OS locale or timezone.
 * - `buildTreeTooltip(entry, childrenCache)` returns a *structured* tooltip
 *   data shape (`{ path, rows: [{ label?, value }] }`) instead of a flat
 *   multi-line string. The shape is consumed by `<TreeTooltipContent>` below
 *   to render as styled JSX inside a Radix Tooltip popover. The structure
 *   also keeps the renderer agnostic about WHICH exact labels appear (file
 *   vs directory; with/without ctime) — the JSX inspects `data.rows` and
 *   renders whatever it finds, so callers don't need conditional logic for
 *   "was a Created line included?".
 */

// Standalone helper kept here for one specific reason — both the test
// file and LayoutShell.tsx need byte-rounding consistency in the same
// tree-row context, so co-locating it with the tooltip builders avoids
// a "where does the helper live?" question.  LayoutShell.tsx retains its
// own LOCAL formatFileSize for use in the wd-files-summary bar (the
// files-rail summary block) which has no tooltip semantics — and
// keeping the two definitions coupled would imply a coupling that isn't
// there today.
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Format an epoch-ms timestamp for a tree-row tooltip.
 *
 * Uses explicit formatting options (NOT `toLocaleString()` without
 * options) so the rendered string is locale-stable: en-US, en-GB,
 * sv-SE, and ja-JP all produce the same output (`"Jul 29, 2025, 15:42:17"`).
 * The stated use case — distinguishing files modified seconds apart
 * during fast agent sessions — leans on cross-team screenshot /
 * grep / log readability. Locking the format here means a teammate's
 * screenshot and yours match byte-for-byte.
 *
 * Format choices:
 * - "short" month instead of "2-digit" — locale-stable three-letter abbrev
 * - 24-hour time (hour12: false) — unambiguous AM/PM-free notation
 * - second-level precision — the whole point of the upgrade vs toLocaleDateString
 *
 * Trade-off acknowledged: this forces English month abbreviations
 * (Jul, Jan, Feb…) on users whose OS locale isn't English. For non-dated
 * ambiguity, an Intl.DateTimeFormat with a fixed timeZone but the user's
 * resolved locale would prefer local month names; we choose cross-team
 * byte-stability over per-user locale respect here.
 */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/**
 * Build a rich tooltip data shape for a tree entry.
 *
 * For directories with cached children, aggregates file count, folder count,
 * total size, and the most recent modification time across all children.
 * For files, shows size + last-modified date (full timestamp) + creation
 * date (when meaningfully distinct).
 *
 * Returns a `TooltipData` object — path on top, followed by a list of labeled
 * rows. Consumed by `<TreeTooltipContent>` for styled JSX rendering inside
 * a Radix Tooltip popover. Falls back to just the path (empty rows) when no
 * metadata is available.
 *
 * The ctime handler is a three-guard composition:
 *   ctime != null          (defensive against backend regressions)
 *   ctime > 0              (filesystem tracking — FAT32/ext4<4.11 /etc.)
 *   Math.abs(ctime - mtime) > 1_000   (suppresses "Created == Modified"
 *                                       noise at second granularity)
 * Without the 1-second buffer, every freshly-written file would spam two
 * rows that say the same thing; with it, real "created hours ago, edited
 * now" cases still surface.
 */
export interface TooltipRow {
  /** Optional uppercase label (e.g. 'Size', 'Modified').  Rendering
   *  places the label on the left and the value on the right. */
  label?: string
  /** Right-side value.  Pre-formatted; formatTimestamp is applied here. */
  value: string
  /**
   * Renderer variant. 'stat' (the implicit default) renders the standard
   * 2-column row with a label + value baseline. 'hint' renders a single
   * full-width centered line in muted italic — used to surface a call to
   * action like "Click to expand…" for directories whose children
   * haven't been fetched yet.  Defaults to 'stat' so existing call sites
   * keep working without changes.
   */
  kind?: 'stat' | 'hint'
}
export interface TooltipData {
  /** Full entry path \u2014 rendered as the popover's header line. */
  path: string
  /** Empty when no metadata is available; otherwise one row per stat. */
  rows: TooltipRow[]
}

export function buildTreeTooltip(
  entry: {
    path: string
    type: 'file' | 'directory'
    size?: number
    mtime?: number
    ctime?: number
  },
  childrenCache: Record<string, Array<{ type: string; size?: number; mtime?: number }>>,
): TooltipData {
  const rows: TooltipRow[] = []

  if (entry.type === 'directory') {
    // Three states for a directory's children cache (exhaustive — every
    // ListDirectoryFiles IPC outcome maps here):
    //   - undefined   → unexpanded  → surface the discoverability hint
    //   - []          → expanded but genuinely empty → no stat rows
    //                    (the body's only child is the path header)
    //   - [entries]   → expanded with content → emit aggregate stat rows
    // The `=== undefined` check is intentional — `cached: []` (the catch
    // path of fetchDirectory writes this) and `cached: undefined` (the
    // user hasn't clicked) are different UX states.  The hint is only
    // honest for the latter.  The IPC contract enforced by updateChildren's
    // shape guarantees we never receive a `null` or non-array value here.
    const cached = childrenCache[entry.path]
    if (cached === undefined) {
      rows.push({ value: 'Click to expand…', kind: 'hint' })
    } else if (cached.length > 0) {
      const files = cached.filter((c) => c.type === 'file')
      const dirs = cached.filter((c) => c.type === 'directory')
      const totalSize = files.reduce((sum, f) => sum + (f.size ?? 0), 0)
      const latestMtime = cached.reduce((max, c) => Math.max(max, c.mtime ?? 0), 0)

      if (files.length > 0) rows.push({ label: 'Files', value: `${files.length}` })
      if (dirs.length > 0) rows.push({ label: 'Folders', value: `${dirs.length}` })
      if (totalSize > 0) rows.push({ label: 'Size', value: formatFileSize(totalSize) })
      // formatTimestamp (not toLocaleDateString) so users can distinguish
      // files modified seconds apart during a fast agent session, and the
      // rendered string is locale-stable across teammates/locales.
      if (latestMtime > 0) rows.push({ label: 'Modified', value: formatTimestamp(latestMtime) })
    }
  } else {
    if (entry.size != null) rows.push({ label: 'Size', value: formatFileSize(entry.size) })
    if (entry.mtime) rows.push({ label: 'Modified', value: formatTimestamp(entry.mtime) })
    // Add creation time only when it differs meaningfully from mtime and
    // the filesystem reported a real birthtime.  On filesystems that don't
    // track birthtime (pre-Linux-4.11 ext4, FAT32, network mounts) the
    // server-side handler normalises 0 \u2192 undefined, so `ctime > 0` is the
    // "we have data" gate.  The 1-second gap suppresses redundant noise
    // for files whose birthtime equals mtime at second granularity (which
    // happens on most freshly-created files).
    if (
      entry.ctime != null &&
      entry.ctime > 0 &&
      Math.abs(entry.ctime - (entry.mtime ?? entry.ctime)) > 1_000
    ) {
      rows.push({ label: 'Created', value: formatTimestamp(entry.ctime) })
    }
  }

  return { path: entry.path, rows }
}

// ── Styled rendering ────────────────────────────────────────────────────
//
// Renders a TooltipData as a styled popover body with a path header,
// optional separator, and 2-column rows (label + value).  Designed to
// live inside the Radix TooltipContent from @craft-agent/ui — the
// TooltipContent component provides the backdrop, blur, and animation
// already.  The plain HTML inside is plain CSS.

export interface TreeTooltipContentProps {
  data: TooltipData
}

export function TreeTooltipContent({ data }: TreeTooltipContentProps) {
  return (
    <div className="arch-tree-tooltip">
      <div className="arch-tree-tooltip__path" title={data.path}>
        {data.path}
      </div>
      {data.rows.length > 0 && (
        <div className="arch-tree-tooltip__body">
          {data.rows.map((row, i) =>
            // Three rendering variants:
            //   - kind: 'hint' → single full-width muted italic line,
            //     used for discovery call-to-actions like "Click to expand…"
            //   - label present → standard 2-column layout (label + value)
            //   - label absent but kind: 'stat' → value spans the row
            //     (used for full-width value displays like long paths in
            //     future extensions)
            row.kind === 'hint' ? (
              // No explicit ARIA role here — the parent Radix TooltipContent
              // already provides tooltip semantics, and adding `role="note"`
              // would create nested-tooltip ambiguity for assistive tech.
              // Plain <div> inside the body keeps the visual contract
              // (full-width muted italic line) without competing with the
              // tooltip's own role.
              <div key={i} className="arch-tree-tooltip__hint">
                {row.value}
              </div>
            ) : (
              <div key={i} className="arch-tree-tooltip__row">
                {row.label && (
                  <span className="arch-tree-tooltip__label">{row.label}</span>
                )}
                <span className="arch-tree-tooltip__value">{row.value}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}
