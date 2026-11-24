/**
 * Which GitHub credential the PR watcher uses: the workspace's GitHub sources first (API or MCP,
 * github.com only), then the GitHub CLI's login (`gh auth token`). A credential that can't see a
 * repository (401/403/NOT_FOUND: e.g. an org that blocks the source's OAuth app) is skipped for that
 * repository for a while and the next one is tried; the one that worked is tried first next time.
 * Tokens never leave this process and are never logged.
 */

import { execFile } from 'node:child_process'
import { GitHubAuthError } from './github-client'
import { isGitHubDotCom } from './remote-url'

export interface TokenCandidate {
  /** Stable id for caching ("gh", "source:<slug>") */
  id: string
  /** Shown in the card footer ("via gh", "via GitHub") */
  label: string
  getToken(): Promise<string | null>
}

/** How long a rejected credential is skipped for a repository before it is tried again. */
const REJECTED_FOR_MS = 10 * 60_000

export class TokenChain {
  private readonly preferred = new Map<string, string>()
  private readonly rejected = new Map<string, number>()

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Runs `attempt` with each usable credential until one isn't rejected. Returns null when none is
   * available or every one was rejected; other errors (network, rate limit) propagate untouched.
   */
  async run<T>(repoKey: string, candidates: readonly TokenCandidate[], attempt: (token: string) => Promise<T>): Promise<{ result: T; via: string } | null> {
    const preferredId = this.preferred.get(repoKey)
    const ordered = [...candidates].sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId))
    for (const candidate of ordered) {
      const rejectedAt = this.rejected.get(`${repoKey}|${candidate.id}`)
      if (rejectedAt !== undefined && this.now() - rejectedAt < REJECTED_FOR_MS) continue
      const token = await candidate.getToken().catch(() => null)
      if (!token) continue
      try {
        const result = await attempt(token)
        this.preferred.set(repoKey, candidate.id)
        this.rejected.delete(`${repoKey}|${candidate.id}`)
        return { result, via: candidate.label }
      } catch (error) {
        if (!(error instanceof GitHubAuthError)) throw error
        this.rejected.set(`${repoKey}|${candidate.id}`, this.now())
        if (this.preferred.get(repoKey) === candidate.id) this.preferred.delete(repoKey)
      }
    }
    return null
  }
}

const GH_TOKEN_TTL_MS = 5 * 60_000
const ghTokenCache = new Map<string, { token: string | null; at: number }>()

/** `gh auth token --hostname <host>`, cached briefly so polls don't spawn a process each time. */
export function ghCandidate(host: string): TokenCandidate {
  return {
    id: 'gh',
    label: 'gh',
    getToken: () => {
      const cached = ghTokenCache.get(host)
      if (cached && Date.now() - cached.at < GH_TOKEN_TTL_MS) return Promise.resolve(cached.token)
      return new Promise((done) => {
        execFile('gh', ['auth', 'token', '--hostname', host], { timeout: 5_000, windowsHide: true }, (error, stdout) => {
          const token = error ? null : stdout.trim() || null
          ghTokenCache.set(host, { token, at: Date.now() })
          done(token)
        })
      })
    },
  }
}

export interface GitHubSourceLike {
  slug: string
  name: string
  getToken(): Promise<string | null>
}

/** Source candidates apply to github.com only (a source's token belongs to its own host). */
export function tokenCandidates(host: string, sources: readonly GitHubSourceLike[]): TokenCandidate[] {
  const fromSources = isGitHubDotCom(host)
    ? sources.map(source => ({ id: `source:${source.slug}`, label: source.name, getToken: source.getToken }))
    : []
  return [...fromSources, ghCandidate(host)]
}
