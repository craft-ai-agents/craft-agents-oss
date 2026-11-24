import { describe, expect, it } from 'bun:test'
import { GitHubAuthError, GitHubRefusedError, GitHubRequestError, githubGraphql, type FetchLike } from './github-client'

function respond(status: number, body: unknown, headers: Record<string, string> = {}): FetchLike {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  })
}

const call = (fetch: FetchLike) => githubGraphql<{ ok: boolean }>('github.com', 't', 'query { ok }', {}, { fetch })

describe('githubGraphql', () => {
  it('returns data and sends a bearer token to api.github.com', async () => {
    let seen = null as { url: string; auth?: string } | null
    const fetch: FetchLike = async (url, init) => {
      seen = { url, auth: init.headers.Authorization }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: { ok: true } }) }
    }
    expect(await call(fetch)).toEqual({ ok: true })
    expect(seen).toEqual({ url: 'https://api.github.com/graphql', auth: 'bearer t' })
  })

  it('classifies credential problems so the chain can try the next one', async () => {
    await expect(call(respond(401, {}))).rejects.toBeInstanceOf(GitHubAuthError)
    await expect(call(respond(403, { message: 'Resource protected by organization SAML enforcement' }))).rejects.toBeInstanceOf(GitHubAuthError)
    await expect(call(respond(200, { data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] }))).rejects.toBeInstanceOf(GitHubAuthError)
  })

  it('classifies rate limits and server errors as retry-later', async () => {
    const limited = await call(respond(403, {}, { 'retry-after': '90' })).catch(e => e)
    expect(limited).toBeInstanceOf(GitHubRequestError)
    expect(limited.retryAfterMs).toBe(90_000)
    await expect(call(respond(403, {}, { 'x-ratelimit-remaining': '0' }))).rejects.toBeInstanceOf(GitHubRequestError)
    await expect(call(respond(200, { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }))).rejects.toBeInstanceOf(GitHubRequestError)
    await expect(call(respond(502, {}))).rejects.toBeInstanceOf(GitHubRequestError)
  })

  it('rejects a refused mutation with GitHub\'s reason instead of returning its null payload', async () => {
    // Recorded from enablePullRequestAutoMerge on a repository with auto-merge off
    const refused = await call(respond(200, {
      data: { enablePullRequestAutoMerge: null },
      errors: [{ type: 'UNPROCESSABLE', path: ['enablePullRequestAutoMerge'], message: 'Auto merge is not allowed for this repository' }],
    })).catch(e => e)
    expect(refused).toBeInstanceOf(GitHubRefusedError)
    expect(refused.message).toBe('Auto merge is not allowed for this repository')
    // A query's partial error keeps the data that did come back
    expect(await call(respond(200, { data: { ok: true, other: null }, errors: [{ type: 'SERVICE_UNAVAILABLE', message: 'partial' }] })))
      .toEqual({ ok: true, other: null } as unknown as { ok: boolean })
  })

  it('turns a network failure or timeout into a retry-later error', async () => {
    const offline: FetchLike = async () => { throw new Error('ECONNREFUSED') }
    await expect(call(offline)).rejects.toBeInstanceOf(GitHubRequestError)
    const hang: FetchLike = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    const timedOut = await githubGraphql('github.com', 't', 'q', {}, { fetch: hang, timeoutMs: 20 }).then(() => null, (e: Error) => e)
    expect(timedOut).toBeInstanceOf(GitHubRequestError)
    expect(timedOut?.message).toContain('timed out')
  })
})
