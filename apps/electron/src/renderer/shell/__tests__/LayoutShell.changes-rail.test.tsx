/**
 * Recent Changes rail — unit tests.
 *
 * Pins the states the rail must show for each kind of git-status response:
 *   - no git repo      → "Not a git repository"
 *   - clean tree       → "Working tree clean" + branch label
 *   - dirty (modified) → "Unstaged" section, file path, +/- diff counts
 *   - dirty (added)    → "Staged"   section, file path
 *   - dirty (deleted)  → "Unstaged" section, file path, deletion indicator
 *   - dual-state AM    → the SAME path appears under BOTH Staged and
 *                        Unstaged sections (this is what porcelain `AM`
 *                        produces, and what the renderer must show as two
 *                        distinct rows)
 *   - untracked        → dedicated Untracked section with the FilePlus icon
 *
 * Test infrastructure
 * --------------------
 * Only `bun:test` is imported statically at the top. Everything else (the
 * LayoutShell module + `react-dom/server`) is dynamically imported inside
 * `beforeAll` AFTER the `mock.module` calls register. This is the same
 * pattern `mention-menu.test.ts` uses to defeat `pdfjs-dist`'s Vite-style
 * `?url` worker import under bun's test loader
 * ("Missing 'default' export in module '...pdf.worker.min.mjs?url'").
 *
 * We use `renderToStaticMarkup` for SSR, which skips `useEffect` entirely —
 * the rail's `gitStatus` state is fully determined by the `initialGitStatus`
 * prop we seed, so we don't need the IPC fetch path.
 */

// Vite-only imports (?url, .css, import.meta.glob) are stubbed by the
// `scripts/test-setup.ts` preload configured in bunfig.toml. We only need
// to dynamic-import LayoutShell itself here.
//
// IMPORTANT: this file holds NO static reference to LayoutShell or
// `react-dom/server`. bun's fast transpiler does not fully erase
// `import type` or `typeof import(...)` in TSX files, which would
// otherwise force a real module load before the mocks register.
// Instead we declare a local interface + use `any` for the bindings
// and resolve them inside `beforeAll`.
import { describe, expect, it, beforeAll, afterAll } from 'bun:test'

// Local copy of the subset of ShellSessionContext the rail reads.
// Mirrors the renderer-side type — keep in sync if the rail grows new
// fields. Declared locally so we don't depend on LayoutShell at all.
interface ShellSessionContext {
  sessionName: string
  connectionLabel: string
  permissionModeLabel: string
  thinkingLabel: string
  sourceNames: string[]
  workingDirectory?: string
  isProcessing?: boolean
}

let renderToStaticMarkup: any
let LayoutShell: any
let resetActiveSession: () => void

beforeAll(async () => {
  const renderer = await import('react-dom/server')
  renderToStaticMarkup = renderer.renderToStaticMarkup
  LayoutShell = (await import('../LayoutShell')).default
  // The Changes rail gates on `useAtomValue(activeSessionIdAtom)` — without
  // a seeded session it shows the "No session selected" placeholder. Seed
  // Jotai's default store once for the suite so the rail renders its full
  // state from `initialGitStatus`.
  const jotai = await import('jotai')
  const { activeSessionIdAtom } = await import('../../atoms/sessions')
  const store = jotai.getDefaultStore()
  store.set(activeSessionIdAtom, 'test-session-id')
  // Cleanup so other suites in the same process don't see a stale session.
  resetActiveSession = () => store.set(activeSessionIdAtom, undefined)
})

afterAll(() => {
  resetActiveSession?.()
})

// ── Helpers ─────────────────────────────────────────────────────────────────
const SESSION: ShellSessionContext = {
  sessionName: 'Recent Changes — unit',
  connectionLabel: 'Local Model',
  permissionModeLabel: 'Safe',
  thinkingLabel: 'Medium',
  sourceNames: [],
  workingDirectory: '/mock/repo',
}

interface FileEntry {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied'
  bucket: 'staged' | 'unstaged' | 'untracked'
  // Field names must match `GitFileEntry` in LayoutShell.tsx (additions, not
  // insertions) — the renderer reads `file.additions` for the +N badge.
  additions: number
  deletions: number
}

interface GitStatusFixture {
  branch: string | null
  files: FileEntry[]
}

function render(fixture: GitStatusFixture): string {
  return renderToStaticMarkup(
    <LayoutShell
      initialRailTab="changes"
      sessionContext={SESSION}
      initialGitStatus={{
        branch: fixture.branch,
        dirPath: SESSION.workingDirectory!,
        files: fixture.files,
      }}
    >
      <div>chat</div>
    </LayoutShell>,
  )
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('LayoutShell — Recent Changes rail', () => {
  it('shows "Not a git repository" when the fixture has a null branch', () => {
    const html = render({ branch: null, files: [] })
    expect(html).toContain('Not a git repository')
    // Branch bar should NOT render in the no-repo branch.
    expect(html).not.toContain('arch-changes-branch')
  })

  it('shows "Working tree clean" + branch label when there are no files', () => {
    const html = render({ branch: 'main', files: [] })
    expect(html).toContain('Working tree clean')
    // Branch label class is `arch-changes-branch__label`; text content is the branch name.
    expect(html).toContain('main')
    // No section dividers when there's nothing dirty.
    expect(html).not.toContain('arch-changes-section')
  })

  it('renders a modified file under "Unstaged" with +/- counts', () => {
    const html = render({
      branch: 'main',
      files: [
        { path: 'src/foo.ts', status: 'modified', bucket: 'unstaged', additions: 10, deletions: 5 },
      ],
    })
    expect(html).toContain('Unstaged')
    expect(html).toContain('src/foo.ts')
    // Modified rows render the inline +/- diff badges.
    expect(html).toContain('+10')
    expect(html).toContain('-5')
    // No Staged section header in this scenario.
    expect(html).not.toContain('arch-changes-section--staged')
  })

  it('renders an added file under "Staged"', () => {
    const html = render({
      branch: 'main',
      files: [
        { path: 'src/new.ts', status: 'added', bucket: 'staged', additions: 12, deletions: 0 },
      ],
    })
    expect(html).toContain('Staged')
    expect(html).toContain('src/new.ts')
    // 'added' rows don't show the inline +/- block (that branch is gated to
    // modified/renamed/copied), but the section-summary "1 staged" still counts it.
    expect(html).toContain('1 staged')
    expect(html).not.toContain('arch-changes-section--unstaged')
  })

  it('renders a deleted file with deletion indicator under "Unstaged"', () => {
    const html = render({
      branch: 'main',
      files: [
        { path: 'src/removed.ts', status: 'deleted', bucket: 'unstaged', additions: 0, deletions: 30 },
      ],
    })
    expect(html).toContain('Unstaged')
    expect(html).toContain('src/removed.ts')
    // 'deleted' rows DO get a data-status="deleted" attribute (drives icon + bg colour).
    expect(html).toContain('data-status="deleted"')
    expect(html).not.toContain('arch-changes-section--staged')
  })

  it('renders the same path twice under both Staged and Unstaged for dual-state AM', () => {
    // porcelain XY = "AM" → backend emits TWO records with the same `path`
    // but different `bucket`. The renderer MUST show both rows so the user
    // can see the half-staged state. Composite React key (`path|bucket`) and
    // composite diffFile state (also `path|bucket`) prevent collapse or
    // cross-row collapse bugs in this scenario.
    const html = render({
      branch: 'main',
      files: [
        { path: 'src/dual.ts', status: 'added',    bucket: 'staged',   additions: 8, deletions: 0 },
        { path: 'src/dual.ts', status: 'modified', bucket: 'unstaged', additions: 3, deletions: 1 },
      ],
    })
    expect(html).toContain('arch-changes-section--staged')
    expect(html).toContain('arch-changes-section--unstaged')
    // Tighten the dual-state assertion: rather than counting text occurrences,
    // verify the path appears INSIDE each section's container. This catches a
    // regression that put both bucket entries inside a single section.
    const stagedBlock = extractSection(html, 'staged')
    const unstagedBlock = extractSection(html, 'unstaged')
    expect(stagedBlock).toContain('src/dual.ts')
    expect(unstagedBlock).toContain('src/dual.ts')
    // Section summary counts visible.
    expect(html).toContain('1 staged')
    expect(html).toContain('1 unstaged')
  })

  it('renders untracked files in their own bucket with the FilePlus icon', () => {
    const html = render({
      branch: 'main',
      files: [
        { path: 'scratch.ts', status: 'untracked', bucket: 'untracked', additions: 4, deletions: 0 },
      ],
    })
    expect(html).toContain('arch-changes-section--untracked')
    expect(html).toContain('scratch.ts')
    // data-status on the icon span drives colour + glyph selection.
    expect(html).toContain('data-status="untracked"')
    // Summary stat label for untracked files.
    expect(html).toContain('1 untracked')
  })
})

/**
 * Slice the rendered HTML to just the section for a given bucket. Splits on
 * the section opening (e.g. `arch-changes-section--staged`) and the matching
 * closing div boundary (assumes the section is wrapped in `<section ...>...</section>`
 * — LayoutShell's emit). Returns the inner HTML of that section only.
 */
function extractSection(html: string, bucket: 'staged' | 'unstaged' | 'untracked'): string {
  const openTag = `arch-changes-section--${bucket}`
  const openIdx = html.indexOf(openTag)
  if (openIdx === -1) return ''
  // Walk from the section-open tag forward, scanning depth until the matching
  // </section> closes. SSR'd HTML is well-formed enough that we can use a
  // simple stack-based scanner rather than a regex.
  const start = html.lastIndexOf('<section', openIdx)
  let depth = 0
  let i = start
  while (i < html.length) {
    const open = html.indexOf('<section', i)
    const close = html.indexOf('</section>', i)
    if (close === -1) return ''
    if (open !== -1 && open < close) {
      depth++
      i = open + 1
    } else {
      depth--
      if (depth === 0) return html.slice(start, close + '</section>'.length)
      i = close + 1
    }
  }
  return ''
}
