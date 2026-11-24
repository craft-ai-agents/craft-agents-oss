/**
 * The signed-in user's GitHub repositories, from the GitHub CLI (`gh repo list`). No token handling
 * here: `gh` uses its own login. Cached briefly so reopening the picker is instant.
 */

import { execFile } from 'node:child_process'
import type { GitHubRepo, RepoListing } from '@craft-agent/shared/protocol'

const LIST_LIMIT = 100
const CACHE_MS = 60_000

let cache: { at: number; value: { repos: GitHubRepo[]; unavailable?: RepoListing['githubUnavailable'] } } | null = null

interface GhRepo {
  nameWithOwner: string
  description?: string | null
  isPrivate: boolean
  updatedAt?: string
}

export function parseGhRepoList(stdout: string): GitHubRepo[] {
  const parsed = JSON.parse(stdout) as GhRepo[]
  return parsed.map(repo => ({
    kind: 'github',
    nameWithOwner: repo.nameWithOwner,
    description: repo.description || undefined,
    isPrivate: repo.isPrivate,
    updatedAt: repo.updatedAt ? Date.parse(repo.updatedAt) : undefined,
  }))
}

export function listGitHubRepos({ fresh = false }: { fresh?: boolean } = {}): Promise<{ repos: GitHubRepo[]; unavailable?: RepoListing['githubUnavailable'] }> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.value)
  return new Promise((done) => {
    execFile(
      'gh',
      ['repo', 'list', '--limit', String(LIST_LIMIT), '--json', 'nameWithOwner,description,isPrivate,updatedAt'],
      { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        let value: { repos: GitHubRepo[]; unavailable?: RepoListing['githubUnavailable'] }
        if (error) {
          value = { repos: [], unavailable: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-installed' : 'not-signed-in' }
        } else {
          try {
            value = { repos: parseGhRepoList(stdout) }
          } catch {
            value = { repos: [], unavailable: 'not-signed-in' }
          }
        }
        cache = { at: Date.now(), value }
        done(value)
      },
    )
  })
}

/** `owner/repo` with GitHub's allowed characters only (it ends up in a `gh` argument and a path). */
export function isValidNameWithOwner(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) && !value.split('/').some(part => part === '.' || part === '..')
}
