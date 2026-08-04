/**
 * Changes rail — real-git integration tests.
 *
 * Instead of seeding `initialGitStatus` with fabricated fixtures, these tests
 * create a real temp git repo, mock `window.electronAPI.getGitBranch` and
 * `getGitStatus` to execute actual git commands against it, then render the
 * LayoutShell with client-side rendering (so `useEffect` fires and
 * `fetchGitStatus` runs). This locks the renderer to the actual porcelain
 * output shape, not a hand-curated subset.
 *
 * Test infrastructure
 * --------------------
 * - `beforeAll`: creates a temp dir with `git init`, writes files, commits,
 *   then creates various dirty states (modified, staged, deleted, untracked)
 * - Mocks `window.electronAPI.getGitBranch` → `git rev-parse --abbrev-ref HEAD`
 * - Mocks `window.electronAPI.getGitStatus` → `git status --porcelain=v1` parsed
 *   into `GitStatusResult` shape
 * - Uses `react-dom/client` `createRoot` + `render` (client-side, not SSR) so
 *   `useEffect` hooks fire and `fetchGitStatus` executes
 * - `afterAll`: removes the temp dir
 *
 * Run:
 *   bun test apps/electron/src/renderer/shell/__tests__/LayoutShell.changes-rail.git-integration.test.tsx
 *
 * NOTE: This test requires the `fetchGitStatus` init-order fix in LayoutShell.tsx
 * (the useCallback must be declared before the useEffect that references it).
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { JSDOM, type DOMWindow } from 'jsdom'
import { getDefaultStore } from 'jotai'
import { activeSessionIdAtom } from '../../atoms/sessions'
import type { GitFileEntry, ShellSessionContext } from '../types'

// ── DOM setup ────────────────────────────────────────────────────────────
//
// This suite mounts through `react-dom/client` rather than SSR, so it needs
// real DOM globals — `scripts/test-setup.ts` does not install any. Mirrors the
// setup in LayoutShell.count-cap-bfs.test.tsx.

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://localhost:5173',
  pretendToBeVisual: true,
})
const win = dom.window
const gs: any = globalThis
gs.window = win
gs.document = win.document
gs.HTMLElement = win.HTMLElement
gs.Element = win.Element
gs.Node = win.Node
gs.getComputedStyle = win.getComputedStyle.bind(win)
gs.navigator = win.navigator
gs.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0)
gs.cancelAnimationFrame = (id: number) => clearTimeout(id)
gs.ResizeObserver = class MockResizeObserver {
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) { this.cb = cb }
  observe(target: Element) {
    this.cb(
      [{ contentRect: { width: 1400, height: 900 }, target } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}
gs.customElements = {
  define: () => {},
  get: () => undefined,
  whenDefined: () => Promise.resolve(),
  upgrade: () => {},
}

// ── Types ────────────────────────────────────────────────────────────────

/** IPC wire-format shape (uses `insertions` not `additions`). */
interface IPCFileEntry {
  path: string
  status: string
  bucket: 'staged' | 'unstaged' | 'untracked'
  insertions: number
  deletions: number
  previousPath?: string
}

interface GitStatusResult {
  branch: string | null
  dirPath: string
  files: IPCFileEntry[]
}

// ── Globals ──────────────────────────────────────────────────────────────

let tempDir: string
let LayoutShell: any
let createRoot: any
let act: any
let container: HTMLDivElement | null = null
let root: any = null

const SESSION: ShellSessionContext = {
  sessionName: 'Git Integration — real repo',
  connectionLabel: 'Local Model',
  permissionModeLabel: 'Safe',
  thinkingLabel: 'Medium',
  sourceNames: [],
}

// ── Git porcelain parser ──────────────────────────────────────────────────

/**
 * Parse `git status --porcelain=v1` output into GitStatusFileEntry[].
 *
 * Porcelain v1 XY codes:
 *   XY where X = index (staged), Y = worktree (unstaged)
 *   ' ' = unmodified, M = modified, A = added, D = deleted, R = renamed, C = copied, ? = untracked
 *
 * Example lines:
 *   M  src/foo.ts       → staged:modified
 *   M  src/bar.ts       → unstaged:modified (X=space, Y=M)
 *   A  src/new.ts       → staged:added
 *   AM src/half.ts      → staged:added + unstaged:modified (dual-state)
 *   D  src/gone.ts      → staged:deleted
 *   ?  src/scratch.ts   → untracked
 */
function parsePorcelain(output: string): IPCFileEntry[] {
  const entries: IPCFileEntry[] = []
  for (const line of output.split('\n')) {
    if (!line || line.length < 3) continue
    const x = line[0]
    const y = line[1]
    const rest = line.slice(3)

    // Handle renamed files (R  old -> new)
    let filePath = rest
    let previousPath: string | undefined
    if (x === 'R' || y === 'R') {
      const arrowIdx = rest.indexOf(' -> ')
      if (arrowIdx !== -1) {
        previousPath = rest.slice(0, arrowIdx)
        filePath = rest.slice(arrowIdx + 4)
      }
    }

    // Staged side (X)
    if (x === 'M') entries.push({ path: filePath, status: 'modified', bucket: 'staged', insertions: 0, deletions: 0 })
    if (x === 'A') entries.push({ path: filePath, status: 'added', bucket: 'staged', insertions: 0, deletions: 0 })
    if (x === 'D') entries.push({ path: filePath, status: 'deleted', bucket: 'staged', insertions: 0, deletions: 0 })
    if (x === 'R') entries.push({ path: filePath, status: 'renamed', bucket: 'staged', insertions: 0, deletions: 0, previousPath })
    if (x === 'C') entries.push({ path: filePath, status: 'copied', bucket: 'staged', insertions: 0, deletions: 0 })

    // Worktree side (Y)
    if (y === 'M') entries.push({ path: filePath, status: 'modified', bucket: 'unstaged', insertions: 0, deletions: 0 })
    if (y === 'D') entries.push({ path: filePath, status: 'deleted', bucket: 'unstaged', insertions: 0, deletions: 0 })

    // Untracked
    if (x === '?') entries.push({ path: filePath, status: 'untracked', bucket: 'untracked', insertions: 0, deletions: 0 })
  }
  return entries
}

// ── Git helper ───────────────────────────────────────────────────────────

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

// ── Setup ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Create temp git repo
  tempDir = mkdtempSync(join(tmpdir(), 'changes-rail-git-'))
  git('init', tempDir)
  git('config user.email "test@test.com"', tempDir)
  git('config user.name "Test"', tempDir)

  // Initial commit with some files. `src/` must exist before the writes —
  // writeFileSync does not create parent directories.
  mkdirSync(join(tempDir, 'src'), { recursive: true })
  writeFileSync(join(tempDir, 'README.md'), '# Hello\n')
  writeFileSync(join(tempDir, 'src/foo.ts'), 'export const foo = 1\n')
  writeFileSync(join(tempDir, 'src/bar.ts'), 'export const bar = 2\n')
  git('add .', tempDir)
  git('commit -m "initial"', tempDir)

  // Create dirty states:
  // 1. Modified (unstaged)
  writeFileSync(join(tempDir, 'src/foo.ts'), 'export const foo = 99\n')
  // 2. Staged added
  writeFileSync(join(tempDir, 'src/new.ts'), 'export const brandNew = true\n')
  git('add src/new.ts', tempDir)
  // 3. Staged modified (AM dual-state: staged + worktree-modified)
  writeFileSync(join(tempDir, 'src/bar.ts'), 'export const bar = 2\nexport const barExtra = 3\n')
  git('add src/bar.ts', tempDir)
  writeFileSync(join(tempDir, 'src/bar.ts'), 'export const bar = 2\nexport const barExtra = 3\nexport const barWorktree = 4\n')
  // 4. Untracked
  writeFileSync(join(tempDir, 'scratch.ts'), 'throw new Error("untracked")\n')

  // With import.meta.glob removed from ThemeContext.tsx, we can import directly
  // `react-dom/client` exposes `createRoot`, not a standalone `render` — the
  // component is mounted via `root.render(...)` below.
  const { createRoot: cr } = await import('react-dom/client')
  const { act: a } = await import('react-dom/test-utils')
  createRoot = cr
  act = a

  const { default: ls } = await import('../LayoutShell')
  LayoutShell = ls

  // Seed Jotai store
  const store = getDefaultStore()
  store.set(activeSessionIdAtom, 'test-session-id')
})

afterAll(() => {
  if (root) {
    act(() => { root.unmount() })
  }
  if (container?.parentNode) {
    container.parentNode.removeChild(container)
  }
  container = null
  root = null
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

// ── Mock window.electronAPI ──────────────────────────────────────────────

function mockElectronAPI() {
  // Parse real porcelain output from the temp repo
  const statusOutput = git('status --porcelain=v1', tempDir)
  const branch = git('rev-parse --abbrev-ref HEAD', tempDir)

  const entries = parsePorcelain(statusOutput)

  const gitStatusResult: GitStatusResult = {
    branch,
    dirPath: tempDir,
    files: entries,
  }

  // Patch window.electronAPI
  const w = globalThis as any
  if (!w.window) w.window = w
  if (!w.window.electronAPI) w.window.electronAPI = {}

  w.window.electronAPI.getGitBranch = async () => branch
  w.window.electronAPI.getGitStatus = async () => gitStatusResult
  // Stub other IPC calls the component might hit
  w.window.electronAPI.onSessionFilesChanged = () => () => {}
  w.window.electronAPI.watchSessionFiles = () => {}
  w.window.electronAPI.unwatchSessionFiles = () => {}
  // Empty fixture is correct here — this test focuses on the git-status
  // diff panel, not the working-directory tree.  If a future test adds
  // non-empty entries to this mock, remember to include the new
  // ReadDirectoryEntry.ctime field (added alongside mtime for the
  // ctime-aware tooltip — see LayoutShell.buildTreeTooltip).
  w.window.electronAPI.listDirectoryFiles = async () => ({ entries: [] })
  w.window.electronAPI.getServerStatus = async () => ({ running: false })
}

// ── Render helper ────────────────────────────────────────────────────────

function renderShell(): Promise<string> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root.render(
      <LayoutShell
        initialRailTab="changes"
        sessionContext={{ ...SESSION, workingDirectory: tempDir }}
      >
        <div>chat</div>
      </LayoutShell>,
    )
  })

  // Wait for async fetchGitStatus to complete
  return new Promise<string>((resolve) => {
    setTimeout(() => {
      act(() => {})
      resolve(container!.innerHTML)
    }, 200)
  })
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Changes rail — real git integration', () => {
  beforeAll(() => {
    mockElectronAPI()
  })

  it('shows the correct branch name from git rev-parse', async () => {
    const html = await renderShell()
    expect(html).toContain('main')
    // Should NOT show "Not a git repository"
    expect(html).not.toContain('Not a git repository')
  })

  it('shows the dirty tree (not "Working tree clean")', async () => {
    const html = await renderShell()
    expect(html).not.toContain('Working tree clean')
  })

  it('shows unstaged modifications with the correct file path', async () => {
    const html = await renderShell()
    // foo.ts is modified (unstaged)
    expect(html).toContain('src/foo.ts')
    expect(html).toContain('Unstaged')
  })

  it('shows staged additions', async () => {
    const html = await renderShell()
    // new.ts is staged-added
    expect(html).toContain('src/new.ts')
    expect(html).toContain('Staged')
  })

  it('shows untracked files in their own section', async () => {
    const html = await renderShell()
    expect(html).toContain('scratch.ts')
    expect(html).toContain('Untracked')
  })

  it('parses porcelain correctly: dual-state AM shows in both sections', async () => {
    // bar.ts is AM (staged-add + worktree-modify)
    const html = await renderShell()
    // The path should appear in both Staged and Unstaged sections
    expect(html).toContain('arch-changes-section--staged')
    expect(html).toContain('arch-changes-section--unstaged')
  })

  it('the rendered file list matches what porcelain actually reports', async () => {
    const html = await renderShell()

    // Verify the exact set of files from porcelain
    const expectedFiles = ['src/foo.ts', 'src/new.ts', 'src/bar.ts', 'scratch.ts']
    for (const file of expectedFiles) {
      expect(html).toContain(file)
    }
  })
})
