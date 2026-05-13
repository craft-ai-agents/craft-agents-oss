import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { GitCommit, GitStatusEntry } from '../../shared/types'

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

export const gitPanelCacheAtomFamily = atomFamily(
  (cwdRoot: string) => {
    if (cwdRoot === '') {
      return atom(
        () => ZERO_GIT_PANEL_CACHE,
        () => {}
      )
    }

    return atom<GitPanelCache>(createZeroGitPanelCache())
  },
  (a, b) => a === b
)
