import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { desktopErpLogin, managedWebSocketUrl } from '../desktop-erp-login'

test('desktop device login uses PKCE, waits for consent and never opens an unverified origin', async () => {
  const device = 'a'.repeat(43)
  let challenge = '', polls = 0, opened = ''
  const result = await desktopErpLogin('https://craft.example', {
    request: async (url, init) => {
      const body = JSON.parse(init!.body as string)
      if (url.endsWith('/start')) {
        challenge = body.challenge
        expect(body.verifier).toBeUndefined()
        return Response.json({ device, login_url: `https://craft.example/api/auth/sso/start?device=${device}` })
      }
      expect(createHash('sha256').update(body.verifier).digest('base64url')).toBe(challenge)
      expect(body.device).toBe(device)
      return ++polls === 1 ? Response.json({ pending: true }, { status: 202 }) : Response.json({ accessToken: 'fixture-token' })
    },
    open: async url => { opened = url }, cancelled: () => false, wait: async () => {},
  })
  expect(result).toEqual({ accessToken: 'fixture-token' })
  expect(opened).toStartWith('https://craft.example/api/auth/sso/start?device=')
  expect(polls).toBe(2)
})

test('device login rejects redirection, cancellation and invalid token responses', async () => {
  const device = 'b'.repeat(43)
  for (const scenario of ['origin', 'cancel', 'token']) {
    let opened = false
    await expect(desktopErpLogin('https://craft.example', {
      request: async url => url.endsWith('/start')
        ? Response.json({ device, login_url: `${scenario === 'origin' ? 'https://evil.example' : 'https://craft.example'}/api/auth/sso/start?device=${device}` })
        : Response.json({}),
      open: async () => { opened = true }, cancelled: () => scenario === 'cancel', wait: async () => {},
    })).rejects.toThrow()
    expect(opened).toBe(scenario === 'token')
  }
})

test('managed WebSocket requires configured host/TLS and refuses credential-bearing URLs', () => {
  expect(managedWebSocketUrl('https://craft.example', 'wss://craft.example/ws')).toBe('wss://craft.example/ws')
  expect(managedWebSocketUrl('http://127.0.0.1:9100', 'ws://127.0.0.1:9200')).toBe('ws://127.0.0.1:9200/')
  for (const url of ['ws://craft.example', 'wss://evil.example/ws', 'wss://craft.example:9999', 'wss://u:p@craft.example', 'wss://craft.example?token=x']) {
    expect(() => managedWebSocketUrl('https://craft.example', url)).toThrow()
  }
})
