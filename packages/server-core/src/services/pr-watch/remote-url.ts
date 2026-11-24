/**
 * Git remote URL → GitHub repository coordinates. Pure; the forms git itself accepts:
 * `git@host:owner/repo(.git)`, `ssh://[user@]host[:port]/owner/repo(.git)`,
 * `https://[user[:token]@]host/owner/repo(.git)`, `git://host/owner/repo(.git)`.
 */

export interface RepoCoordinates {
  /** Lower-cased host, e.g. `github.com` or a GitHub Enterprise host */
  host: string
  owner: string
  repo: string
}

const SCP_LIKE = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/
const URL_LIKE = /^(?:ssh|https?|git|git\+ssh):\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/

export function parseRemoteUrl(url: string): RepoCoordinates | null {
  const trimmed = url.trim()
  const match = URL_LIKE.exec(trimmed) ?? SCP_LIKE.exec(trimmed)
  if (!match) return null
  const [, host, owner, repo] = match
  if (!host || !owner || !repo) return null
  return { host: host.toLowerCase(), owner, repo }
}

/** GitHub.com itself; other hosts are only used when they have a `gh` login (GitHub Enterprise). */
export function isGitHubDotCom(host: string): boolean {
  return host === 'github.com' || host === 'www.github.com'
}

/** GraphQL endpoint for a host: github.com, or GitHub Enterprise Server's `/api/graphql`. */
export function graphqlEndpoint(host: string): string {
  return isGitHubDotCom(host) ? 'https://api.github.com/graphql' : `https://${host}/api/graphql`
}
