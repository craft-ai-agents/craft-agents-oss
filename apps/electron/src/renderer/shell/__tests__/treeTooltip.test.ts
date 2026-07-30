import { describe, it, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import * as React from 'react'
import { buildTreeTooltip, formatTimestamp, TreeTooltipContent } from '../treeTooltip'

/**
 * Pure-function tests for the tree-row tooltip helpers.
 *
 * The ctime + locale-stable-timestamp upgrade changed the tooltip's
 * contract; these tests lock in the new shape without spinning up the
 * full LayoutShell render tree (which needs Jotai + IPC mocks).
 *
 * Imported from `../treeTooltip` (not `../LayoutShell`) because
 * LayoutShell has `export default LayoutShell`, which bun:test's
 * module loader rejects during test discovery.
 *
 * Assertions use regex matchers against the format pattern rather
 * than exact-string matches for the timestamp's TZ-robust and locale-
 * stable invariants.
 */

describe('formatTimestamp', () => {
  it('renders a locale-stable "Mmm DD, YYYY, HH:MM:SS" pattern for a fixed UTC date', () => {
    const utc = Date.UTC(2025, 6, 29, 15, 42, 17)
    expect(formatTimestamp(utc)).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2}:\d{2}$/)
  })

  it('uses 24-hour format without AM/PM markers', () => {
    const utc = Date.UTC(2025, 0, 1, 13, 0, 0) // 1pm UTC
    const rendered = formatTimestamp(utc)
    expect(rendered).not.toMatch(/AM|PM/)
    expect(rendered).toMatch(/\b13:00:00\b|\b01:00:00\b|\b00:00:00\b/)
  })
})

describe('buildTreeTooltip', () => {
  const FIXED_NOW = Date.UTC(2025, 6, 29, 15, 42, 17)
  const FIXED_LATER = Date.UTC(2025, 6, 29, 15, 42, 30)
  const FIXED_EARLIER = Date.UTC(2025, 6, 29, 15, 38, 4)

  describe('return shape — TooltipData', () => {
    it('returns TooltipData with path + rows[] structure for a file', () => {
      const data = buildTreeTooltip(
        { path: '/x/foo.ts', type: 'file', size: 1024, mtime: FIXED_NOW },
        {},
      )
      expect(data.path).toBe('/x/foo.ts')
      expect(Array.isArray(data.rows)).toBe(true)
      const labels = data.rows.map(r => r.label)
      expect(labels).toContain('Size')
      expect(labels).toContain('Modified')
    })

    it('returns TooltipData with path + rows[] structure for a directory', () => {
      const data = buildTreeTooltip(
        { path: '/x/dir', type: 'directory' },
        { '/x/dir': [{ type: 'file' as const, size: 100, mtime: FIXED_NOW }] },
      )
      expect(data.path).toBe('/x/dir')
      const labels = data.rows.map(r => r.label)
      expect(labels).toContain('Files')
      expect(labels).toContain('Modified')
    })
  })

  describe('row discriminator — explicit kind vs implicit default', () => {
    // Regressions guard: if a future refactor accidentally changes the
    // JSX discriminator (e.g. `row.kind !== 'hint'`), callers passing
    // bare `{ label, value }` (the implicit-default shape used by every
    // existing call site under buildTreeTooltip) would silently render
    // as no-op.  Locking in both shapes means a discriminator change
    // has to update BOTH tests simultaneously — or surface as a failure.
    it('stat rows from buildTreeTooltip never carry kind="hint" (implicit stat default preserved)', () => {
      const file = buildTreeTooltip(
        { path: '/x/foo.ts', type: 'file', size: 1024, mtime: FIXED_NOW },
        {},
      )
      expect(file.rows.length).toBeGreaterThan(0)
      for (const row of file.rows) {
        expect(row.kind ?? 'stat').toBe('stat')
      }
    })
  })

  describe('file row — three-guard ctime filter', () => {
    it('always includes Size + Modified for a file with mtime', () => {
      const data = buildTreeTooltip(
        { path: '/x/foo.ts', type: 'file', size: 1024, mtime: FIXED_NOW },
        {},
      )
      expect(data.rows.find(r => r.label === 'Size')?.value).toBe('1 KB')
      expect(data.rows.find(r => r.label === 'Modified')).toBeDefined()
    })

    it('omits Modified when mtime is absent', () => {
      const data = buildTreeTooltip(
        { path: '/x/foo.ts', type: 'file', size: 1024 },
        {},
      )
      expect(data.rows.find(r => r.label === 'Modified')).toBeUndefined()
    })

    it('adds Created row when ctime != mtime by more than 1 second', () => {
      const data = buildTreeTooltip(
        {
          path: '/x/foo.ts',
          type: 'file',
          size: 1024,
          mtime: FIXED_LATER,
          ctime: FIXED_EARLIER,
        },
        {},
      )
      const created = data.rows.find(r => r.label === 'Created')
      expect(created).toBeDefined()
      // Reparse back to a Date and assert it's earlier than Modified.
      const parsed = new Date(created!.value + ' UTC').getTime()
      expect(parsed).toBeLessThan(FIXED_LATER)
    })

    it('suppresses Created when ctime === mtime at second granularity', () => {
      const data = buildTreeTooltip(
        {
          path: '/x/just-created.ts',
          type: 'file',
          size: 100,
          mtime: FIXED_NOW,
          ctime: FIXED_NOW,
        },
        {},
      )
      expect(data.rows.find(r => r.label === 'Created')).toBeUndefined()
    })

    it('suppresses Created when ctime is undefined (filesystem without birthtime)', () => {
      const data = buildTreeTooltip(
        { path: '/x/foo.ts', type: 'file', size: 1024, mtime: FIXED_NOW, ctime: undefined },
        {},
      )
      expect(data.rows.find(r => r.label === 'Created')).toBeUndefined()
    })

    it('renders Modified using formatTimestamp — locale-stable across teammates', () => {
      const data = buildTreeTooltip(
        { path: '/x/foo.ts', type: 'file', size: 1024, mtime: FIXED_NOW },
        {},
      )
      const modified = data.rows.find(r => r.label === 'Modified')?.value ?? ''
      expect(modified).not.toMatch(/AM|PM/)
      expect(modified).toMatch(/^(\w{3} \d{1,2}, \d{4}, )?\d{2}:\d{2}:\d{2}$|\w{3} \d{1,2}, \d{4}, \d{2}:\d{2}:\d{2}/)
    })
  })

  describe('directory row — aggregate over children', () => {
    it('aggregates Files / Folders / Size / Modified from children cache', () => {
      const data = buildTreeTooltip(
        { path: '/x/proj', type: 'directory' },
        {
          '/x/proj': [
            { type: 'file' as const, size: 100, mtime: FIXED_EARLIER },
            { type: 'file' as const, size: 200, mtime: FIXED_NOW },
            { type: 'directory' as const, mtime: 0 },
          ],
        },
      )
      expect(data.rows.find(r => r.label === 'Files')?.value).toBe('2')
      expect(data.rows.find(r => r.label === 'Folders')?.value).toBe('1')
      expect(data.rows.find(r => r.label === 'Size')?.value).toBe('300 B')
    })

    it('returns empty rows when cache entry has no children', () => {
      // Use an explicit empty array — NOT a missing key — because the
      // hint-row path fires when the key is absent (unexpanded).  This
      // test locks in the distinction: a fetched-but-empty directory
      // returns empty rows; an unexpanded directory returns the hint.
      const data = buildTreeTooltip(
        { path: '/x/empty-dir', type: 'directory' },
        { '/x/empty-dir': [] },
      )
      expect(data.path).toBe('/x/empty-dir')
      expect(data.rows).toHaveLength(0)
    })
  })

  describe('directory row — discoverability hint (uncached)', () => {
    it('emits a hint row when childrenCache[path] is undefined (unexpanded)', () => {
      // No key for the directory path — the user hasn't clicked it yet.
      const data = buildTreeTooltip(
        { path: '/x/unseen-dir', type: 'directory' },
        { '/x/some-other-dir': [] },
      )
      const hint = data.rows.find(r => r.kind === 'hint')
      expect(hint).toBeDefined()
      expect(hint?.value).toBe('Click to expand…')
      // Hint should NOT appear alongside stat rows: if there are no
      // cached children, there shouldn't also be Files/Folders/Size rows.
      expect(data.rows.find(r => r.label === 'Files')).toBeUndefined()
      expect(data.rows.find(r => r.label === 'Folders')).toBeUndefined()
      expect(data.rows.find(r => r.label === 'Size')).toBeUndefined()
    })

    it('does NOT emit a hint when the directory has been expanded to empty', () => {
      // User clicked and the IPC reported [] — empty directory is
      // genuinely empty, not "unexpanded." Honesty wins over handholding.
      const data = buildTreeTooltip(
        { path: '/x/expanded-empty', type: 'directory' },
        { '/x/expanded-empty': [] },
      )
      expect(data.rows.find(r => r.kind === 'hint')).toBeUndefined()
      // Body should still be empty (no stats, no hint).
      expect(data.rows).toHaveLength(0)
    })

    it('does NOT emit a hint for files', () => {
      const data = buildTreeTooltip(
        { path: '/x/foo.ts', type: 'file', size: 1024, mtime: FIXED_NOW },
        {},
      )
      expect(data.rows.find(r => r.kind === 'hint')).toBeUndefined()
    })

    it('does NOT emit a hint for a populated directory (cached children present)', () => {
      // Sanity: a directory with children always shows stats, never a hint.
      const data = buildTreeTooltip(
        { path: '/x/full', type: 'directory' },
        { '/x/full': [{ type: 'file' as const, size: 100, mtime: FIXED_NOW }] },
      )
      expect(data.rows.find(r => r.kind === 'hint')).toBeUndefined()
      expect(data.rows.find(r => r.label === 'Files')).toBeDefined()
    })
  })
})

describe('TreeTooltipContent (JSX render)', () => {
  // renderToStaticMarkup is the simplest way to assert structure
  // without spinning up happy-dom + react-dom/client. The component
  // is pure (no hooks, no effects) so static markup is sufficient.
  it('renders path header + a row per data.rows entry', () => {
    const html = renderToStaticMarkup(
      React.createElement(TreeTooltipContent, {
        data: {
          path: '/x/foo.ts',
          rows: [
            { label: 'Size', value: '1 KB' },
            { label: 'Modified', value: 'Jul 29, 2025, 15:42:17' },
          ],
        },
      }),
    )
    expect(html).toContain('arch-tree-tooltip')
    expect(html).toContain('arch-tree-tooltip__path')
    expect(html).toContain('/x/foo.ts')
    // Each row should appear with the label and the value.
    expect(html).toContain('Size')
    expect(html).toContain('1 KB')
    expect(html).toContain('Modified')
    expect(html).toContain('Jul 29, 2025, 15:42:17')
  })

  it('renders just the path when rows is empty (no populated dir)', () => {
    const html = renderToStaticMarkup(
      React.createElement(TreeTooltipContent, {
        data: { path: '/x/empty', rows: [] },
      }),
    )
    expect(html).toContain('arch-tree-tooltip__path')
    expect(html).toContain('/x/empty')
    // Body element absent — nothing to render.
    expect(html).not.toContain('arch-tree-tooltip__body')
  })

  it('renders each row with both label and value', () => {
    const html = renderToStaticMarkup(
      React.createElement(TreeTooltipContent, {
        data: {
          path: '/x/foo',
          rows: [
            { label: 'Files', value: '5' },
            { label: 'Size', value: '12 KB' },
          ],
        },
      }),
    )
    // Every (label, value) pair should appear in the markup.
    expect(html).toContain('Files')
    expect(html).toContain('5')
    expect(html).toContain('Size')
    expect(html).toContain('12 KB')
  })

  it('renders a hint row inside the body without nested ARIA roles', () => {
    const html = renderToStaticMarkup(
      React.createElement(TreeTooltipContent, {
        data: {
          path: '/x/unseen',
          rows: [
            { value: 'Click to expand…', kind: 'hint' },
          ],
        },
      }),
    )
    expect(html).toContain('arch-tree-tooltip__hint')
    expect(html).toContain('Click to expand…')
    // No nested ARIA role — the parent Radix TooltipContent already
    // provides tooltip semantics and adding role="note" inside would
    // create nested-tooltip ambiguity for assistive tech.
    expect(html).not.toContain('role="note"')
    // Hint must NOT render as a stat row — no label, no __value wrapping it.
    expect(html).not.toMatch(/arch-tree-tooltip__value[^"]*"[^>]*>Click to expand…/)
  })
})
