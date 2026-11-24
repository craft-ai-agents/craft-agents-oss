/**
 * Parse a pr_bind / pr_unbind argument into repository coordinates + a PR number. Pure, so the whole
 * accepted-forms table is unit-tested. Accepts:
 *   - a web URL:            https://github.com/owner/repo/pull/123   (any host; trailing path ok)
 *   - an owner/repo ref:    owner/repo#123  |  owner/repo/pull/123  |  owner/repo/123
 *   - a bare number:        123  |  #123     (needs `fallback` — the session's own repo)
 */

import type { RepoCoordinates } from './remote-url'

export interface PrReference extends RepoCoordinates {
  number: number
}

const URL_FORM = /^https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/pull\/(\d+)(?:[/?#].*)?$/i
const SLUG_FORM = /^([^/\s]+)\/([^/\s#]+?)(?:\.git)?(?:#|\/pull\/|\/)(\d+)$/
const BARE_FORM = /^#?(\d+)$/

export function parsePrReference(input: string, fallback?: RepoCoordinates | null): PrReference | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const url = URL_FORM.exec(trimmed)
  if (url) {
    const [, host, owner, repo, number] = url
    return { host: host!.toLowerCase(), owner: owner!, repo: repo!, number: Number(number) }
  }

  const slug = SLUG_FORM.exec(trimmed)
  if (slug) {
    const [, owner, repo, number] = slug
    // An owner/repo ref names its own repo; only the host is inherited (GitHub Enterprise sessions).
    return { host: fallback?.host ?? 'github.com', owner: owner!, repo: repo!, number: Number(number) }
  }

  const bare = BARE_FORM.exec(trimmed)
  if (bare && fallback) {
    return { host: fallback.host, owner: fallback.owner, repo: fallback.repo, number: Number(bare[1]) }
  }

  return null
}
