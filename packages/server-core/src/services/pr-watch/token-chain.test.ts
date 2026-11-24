import { describe, expect, it } from 'bun:test'
import { GitHubAuthError, GitHubRequestError } from './github-client'
import { TokenChain, tokenCandidates, type TokenCandidate } from './token-chain'

const candidate = (id: string, token: string | null): TokenCandidate => ({ id, label: id, getToken: async () => token })

describe('TokenChain', () => {
  it('uses the first credential that works and reports it', async () => {
    const chain = new TokenChain()
    const result = await chain.run('github.com/acme/app', [candidate('source:github', 'src'), candidate('gh', 'cli')], async token => token)
    expect(result).toEqual({ result: 'src', via: 'source:github' })
  })

  it('falls back to gh when the source is rejected, then skips the source and prefers gh', async () => {
    let now = 0
    const chain = new TokenChain(() => now)
    const seen: string[] = []
    const attempt = async (token: string) => {
      seen.push(token)
      if (token === 'src') throw new GitHubAuthError('org blocks this OAuth app', 403)
      return 'ok'
    }
    const candidates = [candidate('source:github', 'src'), candidate('gh', 'cli')]
    expect(await chain.run('k', candidates, attempt)).toEqual({ result: 'ok', via: 'gh' })
    expect(await chain.run('k', candidates, attempt)).toEqual({ result: 'ok', via: 'gh' })
    expect(seen).toEqual(['src', 'cli', 'cli'])
    // After the cool-off the source is tried again (it may have been fixed), but gh stays first
    now = 11 * 60_000
    await chain.run('k', candidates, attempt)
    expect(seen.slice(3)).toEqual(['cli'])
  })

  it('skips credentials without a token and returns null when none is left', async () => {
    const chain = new TokenChain()
    expect(await chain.run('k', [candidate('source:github', null), candidate('gh', null)], async () => 'x')).toBeNull()
  })

  it('does not swallow network or rate-limit errors', async () => {
    const chain = new TokenChain()
    const failing = async () => { throw new GitHubRequestError('rate limit', 403, 60_000) }
    await expect(chain.run('k', [candidate('gh', 'cli')], failing)).rejects.toBeInstanceOf(GitHubRequestError)
  })
})

describe('tokenCandidates', () => {
  const source = { slug: 'github', name: 'GitHub', getToken: async () => 't' }
  it('puts sources before gh on github.com', () => {
    expect(tokenCandidates('github.com', [source]).map(c => c.id)).toEqual(['source:github', 'gh'])
  })
  it('uses only gh on enterprise hosts', () => {
    expect(tokenCandidates('ghe.acme.io', [source]).map(c => c.id)).toEqual(['gh'])
  })
})
