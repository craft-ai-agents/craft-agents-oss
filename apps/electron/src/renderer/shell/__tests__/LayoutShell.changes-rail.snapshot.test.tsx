/**
 * Changes rail — visual snapshot tests.
 *
 * Captures the full SSR'd HTML for each of the 7 states the rail must show:
 *   1. No git repo (null branch)
 *   2. Clean tree (main, no files)
 *   3. Dirty: modified file under Unstaged
 *   4. Dirty: added file under Staged
 *   5. Dirty: deleted file under Unstaged
 *   6. Dual-state AM: same path under both Staged and Unstaged
 *   7. Untracked file in its own bucket
 *
 * Run once to record the baselines:
 *   bun test apps/electron/src/renderer/shell/__tests__/LayoutShell.changes-rail.snapshot.test.tsx
 *
 * Any future renderer change that alters the markup (even subtly) will fail
 * the snapshot review, catching visual regressions that substring assertions
 * (toContain) miss.
 *
 * To update snapshots after an intentional change:
 *   bun test --update-snapshots apps/electron/src/renderer/shell/__tests__/LayoutShell.changes-rail.snapshot.test.tsx
 *
 * NOTE: This test previously failed due to an init-order bug in LayoutShell.tsx
 * where fetchGitStatus was referenced before its useCallback declaration.
 * That bug is now fixed. Run the test once to record baselines.
 */


// With import.meta.glob removed from ThemeContext.tsx, we can import
// LayoutShell directly at the top level with full type safety.
import { describe, it, expect, afterAll } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { getDefaultStore } from 'jotai'
import { activeSessionIdAtom } from '../../atoms/sessions'
import LayoutShell from '../LayoutShell'
import type { GitFileEntry, ShellSessionContext } from '../types'

const store = getDefaultStore()
store.set(activeSessionIdAtom, 'test-session-id')
const resetActiveSession = () => store.set(activeSessionIdAtom, null)

afterAll(() => {
  resetActiveSession?.()
})

const SESSION: ShellSessionContext = {
  sessionName: 'Changes Rail — snapshots',
  connectionLabel: 'Local Model',
  permissionModeLabel: 'Safe',
  thinkingLabel: 'Medium',
  sourceNames: [],
  workingDirectory: '/mock/repo',
}

interface GitStatusFixture {
  branch: string | null
  files: GitFileEntry[]
  label: string
}

function render(fixture: GitStatusFixture): string {
  return renderToStaticMarkup(
    <LayoutShell
      initialRailTab="changes"
      sessionContext={SESSION}
      initialGitStatus={{
        branch: fixture.branch,
        files: fixture.files,
      }}
    >
      <div>chat</div>
    </LayoutShell>,
  )
}

// ── Fixtures: the 7 canonical states ──────────────────────────────────────

const FIXTURES: GitStatusFixture[] = [
  {
    label: '1-no-git-repo',
    branch: null,
    files: [],
  },
  {
    label: '2-clean-tree',
    branch: 'main',
    files: [],
  },
  {
    label: '3-dirty-modified',
    branch: 'main',
    files: [
      { path: 'src/foo.ts', status: 'modified', bucket: 'unstaged', additions: 10, deletions: 5 },
    ],
  },
  {
    label: '4-dirty-added-staged',
    branch: 'main',
    files: [
      { path: 'src/new.ts', status: 'added', bucket: 'staged', additions: 12, deletions: 0 },
    ],
  },
  {
    label: '5-dirty-deleted',
    branch: 'main',
    files: [
      { path: 'src/removed.ts', status: 'deleted', bucket: 'unstaged', additions: 0, deletions: 30 },
    ],
  },
  {
    label: '6-dual-state-am',
    branch: 'main',
    files: [
      { path: 'src/dual.ts', status: 'added', bucket: 'staged', additions: 8, deletions: 0 },
      { path: 'src/dual.ts', status: 'modified', bucket: 'unstaged', additions: 3, deletions: 1 },
    ],
  },
  {
    label: '7-untracked',
    branch: 'main',
    files: [
      { path: 'scratch.ts', status: 'untracked', bucket: 'untracked', additions: 4, deletions: 0 },
    ],
  },
]

// ── Snapshot tests ────────────────────────────────────────────────────────

describe('Changes rail — snapshot baselines', () => {
  for (const fixture of FIXTURES) {
    it(`matches snapshot: ${fixture.label}`, () => {
      const html = render(fixture)
      expect(html).toMatchSnapshot(`changes-rail-${fixture.label}`)
    })
  }
})
