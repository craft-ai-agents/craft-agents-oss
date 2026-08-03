/**
 * Shared renderer-side types for the LayoutShell context rail.
 *
 * Exported here (rather than co-located in LayoutShell.tsx) so that test
 * files can import `GitFileEntry` and `GitStatusData` directly — giving
 * them full type safety for fixtures without depending on a `LayoutShell: any`
 * dynamic-import workaround.
 */

import type { SourceConnectionStatus } from '../../shared/types'

/**
 * Renderer-side shape for a single git-status row. Field semantics mirror
 * the server `GitStatusFileEntry` (from `dto.ts`) except `name` is the
 * basename only (renderer-local optimisation that avoids re-splitting the
 * path on every render). A single path may appear once per non-empty
 * porcelain XY side, so `bucket` is part of the row identity.
 */
export interface GitFileEntry {
  path: string
  /** Basename only — derived from `path` by LayoutShell at render time.
   *  Optional in fixtures; LayoutShell populates it on the IPC path. */
  name?: string
  status: string
  additions?: number
  deletions?: number
  /** Which side of porcelain-XY this entry came from. Drives bucket-grouped
   *  rendering in the rail and the dual lookup in the tree badge. */
  bucket: 'staged' | 'unstaged' | 'untracked'
}

/** Data shape for the Changes rail git-status state. */
export interface GitStatusData {
  branch: string | null
  files: GitFileEntry[]
}

/**
 * Everything the context rail needs to describe the active session.
 *
 * Lives here rather than in `LayoutShell.tsx` so the rail's tests can type
 * their fixtures against it. The tests cannot import from `LayoutShell.tsx`
 * directly — it pulls in Vite-only `?url` and `.css` imports that bun's test
 * loader can't resolve — and a hand-copied local `interface` in each test file
 * silently drifted from the real shape (`modelLabel` went missing).
 */
export type ShellSessionContext = {
  sessionName?: string
  /** Display name of the LLM connection backing this session. */
  connectionLabel?: string
  /** Human-readable permission mode ('Safe', 'Ask', 'Allow all'). */
  permissionModeLabel: string
  /** Display name of the resolved model, if the session pins one. */
  modelLabel?: string
  /** Human-readable thinking level. */
  thinkingLabel: string
  /**
   * Sources enabled for this session, with the connection status used to
   * drive the status glow on the context rail chips. `status` is undefined
   * when the slug no longer resolves to a loaded source.
   */
  sourceNames: Array<{ name: string; status?: SourceConnectionStatus }>
  workingDirectory?: string
  isProcessing?: boolean
}
