import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { GitCommit, GitStatusEntry } from '../../shared/types'

/**
 * Cached git panel data for a workspace root.
 */
export type GitPanelCache = {
  statusEntries: GitStatusEntry[]
  commits: GitCommit[]
  error: string | null
}

const ZERO_GIT_PANEL_CACHE: GitPanelCache = {
  statusEntries: [],
  commits: [],
  error: null,
}

function createZeroGitPanelCache(): GitPanelCache {
  return {
    statusEntries: [],
    commits: [],
    error: null,
  }
}

/**
 * Cache atom family for git panel data, keyed by CWD root.
 *
 * The empty root is intentionally write-ignored and always reads as empty data.
 */
export const gitPanelCacheAtomFamily = atomFamily(
  (cwdRoot: string) => {
    if (cwdRoot === '') {
      return atom<GitPanelCache, [GitPanelCache], void>(
        () => ZERO_GIT_PANEL_CACHE,
        () => {}
      )
    }

    return atom<GitPanelCache>(createZeroGitPanelCache())
  },
  (a, b) => a === b
)
