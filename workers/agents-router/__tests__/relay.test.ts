import { describe, it, expect } from 'bun:test'

/**
 * Tests for the generic /auth/callback relay route in the agents-router worker.
 *
 * The worker is a Cloudflare Worker (web-standard Request/Response), so we can
 * test the fetch handler directly by importing it and calling fetch().
 */

// Import the worker's default export (the fetch handler)
import worker from '../index'

// Minimal Env stub — the relay route doesn't touch R2
const env = { DOWNLOADS: {} as any }

function makeRequest(path: string): Request {
  return new Request(`https://agents.craft.do${path}`)
}

describe('/auth/callback relay', () => {
  it('redirects to localhost return_to with OAuth params', async () => {
    const res = await worker.fetch(
      makeRequest('/auth/callback?return_to=http://localhost:6477/callback&code=abc123&state=xyz'),
      env,
    )

    expect(res.status).toBe(302)
    const location = res.headers.get('location')!
    expect(location).toContain('http://localhost:6477/callback?')
    expect(location).toContain('code=abc123')
    expect(location).toContain('state=xyz')
    // return_to should NOT be forwarded
    expect(location).not.toContain('return_to=')
  })

  it('redirects to HTTPS return_to', async () => {
    const res = await worker.fetch(
      makeRequest('/auth/callback?return_to=https://my-server.com/api/oauth/callback&code=abc&state=def'),
      env,
    )

    expect(res.status).toBe(302)
    const location = res.headers.get('location')!
    expect(location).toStartWith('https://my-server.com/api/oauth/callback?')
    expect(location).toContain('code=abc')
    expect(location).toContain('state=def')
  })

  it('returns 400 when return_to is missing', async () => {
    const res = await worker.fetch(
      makeRequest('/auth/callback?code=abc&state=def'),
      env,
    )

    expect(res.status).toBe(400)
    expect(await res.text()).toContain('Missing return_to')
  })

  it('rejects non-localhost HTTP return_to', async () => {
    const res = await worker.fetch(
      makeRequest('/auth/callback?return_to=http://evil.com/steal&code=abc&state=def'),
      env,
    )

    expect(res.status).toBe(400)
    expect(await res.text()).toContain('must be localhost or HTTPS')
  })

  it('rejects invalid return_to URL', async () => {
    const res = await worker.fetch(
      makeRequest('/auth/callback?return_to=not-a-url&code=abc&state=def'),
      env,
    )

    expect(res.status).toBe(400)
    expect(await res.text()).toContain('Invalid return_to URL')
  })

  it('allows localhost on any port', async () => {
    const res = await worker.fetch(
      makeRequest('/auth/callback?return_to=http://localhost:9100/api/oauth/callback&code=abc&state=def'),
      env,
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('localhost:9100')
  })

  it('forwards error params from OAuth provider', async () => {
    const res = await worker.fetch(
      makeRequest('/auth/callback?return_to=http://localhost:6477/callback&error=access_denied&error_description=User+denied&state=xyz'),
      env,
    )

    expect(res.status).toBe(302)
    const location = res.headers.get('location')!
    expect(location).toContain('error=access_denied')
    expect(location).toContain('error_description=User+denied')
  })
})

describe('/auth/slack/callback legacy relay', () => {
  it('still works for backward compatibility', async () => {
    const res = await worker.fetch(
      makeRequest('/auth/slack/callback?port=6477&code=slack123&state=slackstate'),
      env,
    )

    expect(res.status).toBe(302)
    const location = res.headers.get('location')!
    expect(location).toStartWith('http://localhost:6477/callback?')
    expect(location).toContain('code=slack123')
    expect(location).toContain('state=slackstate')
  })
})
