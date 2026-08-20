import { afterEach, describe, expect, it } from 'bun:test'
import type { CredentialId, StoredCredential } from '@craft-agent/shared/credentials'
import { credentialIdToAccount } from '@craft-agent/shared/credentials'
import {
  CapabilityBroker,
  getCapabilityBroker,
  parseSecretsUseAccount,
  resetCapabilityBroker,
  SECRETS_USE_PREFIX,
} from '../capability-broker'

afterEach(() => {
  resetCapabilityBroker()
})

function mockGetCredential(store: Record<string, string>) {
  return async (id: CredentialId): Promise<StoredCredential | null> => {
    const key = credentialIdToAccount(id)
    const value = store[key]
    if (!value) return null
    return { value }
  }
}

describe('parseSecretsUseAccount', () => {
  it('accepts preferred credentialIdToAccount form', () => {
    expect(parseSecretsUseAccount('secrets.use:source_bearer::ws::src')).toBe(
      'source_bearer::ws::src',
    )
    expect(parseSecretsUseAccount('secrets.use:source_apikey::ws::api1')).toBe(
      'source_apikey::ws::api1',
    )
  })

  it('maps mcp/api shorthand heuristics', () => {
    expect(parseSecretsUseAccount('secrets.use:mcp::ws::slug')).toBe(
      'source_bearer::ws::slug',
    )
    expect(parseSecretsUseAccount('secrets.use:api::ws::slug')).toBe(
      'source_apikey::ws::slug',
    )
  })

  it('rejects empty / garbage', () => {
    expect(parseSecretsUseAccount('network.request')).toBeNull()
    expect(parseSecretsUseAccount('secrets.use:')).toBeNull()
    expect(parseSecretsUseAccount('secrets.use:not-a-real-type::x')).toBeNull()
    expect(parseSecretsUseAccount('secrets.use:bogus')).toBeNull()
  })
})

describe('CapabilityBroker.mint', () => {
  it('requires grant', () => {
    const broker = new CapabilityBroker()
    expect(() =>
      broker.mint({
        extensionId: 'ext-a',
        permission: 'network.request',
        grantedPermissions: [],
      }),
    ).toThrow(/not granted/i)

    expect(() =>
      broker.mint({
        extensionId: 'ext-a',
        permission: 'secrets.use:source_bearer::ws::src',
        grantedPermissions: ['network.request'],
      }),
    ).toThrow(/not granted/i)
  })

  it('mints when granted; response has token/expires/permission only (no secret)', () => {
    const broker = new CapabilityBroker()
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'secrets.use:source_bearer::ws::src',
      grantedPermissions: ['secrets.use:source_bearer::ws::src'],
    })
    expect(cap.token.length).toBeGreaterThan(20)
    expect(cap.permission).toBe('secrets.use:source_bearer::ws::src')
    expect(cap.credentialAccount).toBe('source_bearer::ws::src')
    expect(cap.expiresAt).toBeGreaterThan(Date.now())
    expect(cap.extensionId).toBe('ext-a')
    // Mint surface never carries a secret field
    expect('secret' in cap).toBe(false)
    expect('value' in cap).toBe(false)
    expect(Object.keys(cap).sort()).toEqual(
      ['credentialAccount', 'expiresAt', 'extensionId', 'permission', 'token'].sort(),
    )
    expect(cap.credentialAccount).not.toBe('super-secret-token')
  })

  it('rejects bad secrets.use form even when granted', () => {
    const broker = new CapabilityBroker()
    expect(() =>
      broker.mint({
        extensionId: 'ext-a',
        permission: 'secrets.use:notvalid',
        grantedPermissions: ['secrets.use:notvalid'],
      }),
    ).toThrow(/invalid secrets\.use/i)
  })

  it('accepts mcp shorthand when granted as that string', () => {
    const broker = new CapabilityBroker()
    const cap = broker.mint({
      extensionId: 'src-ext',
      permission: 'secrets.use:mcp::ws::slug',
      grantedPermissions: ['secrets.use:mcp::ws::slug'],
    })
    expect(cap.credentialAccount).toBe('source_bearer::ws::slug')
  })
})

describe('CapabilityBroker expiry / revoke', () => {
  it('expire → peek null', () => {
    let now = 1_000_000
    const broker = new CapabilityBroker({ now: () => now })
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
      ttlMs: 100,
    })
    expect(broker.peek(cap.token)).not.toBeNull()
    now = 1_000_100
    expect(broker.peek(cap.token)).toBeNull()
  })

  it('revoke token', () => {
    const broker = new CapabilityBroker()
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    broker.revoke(cap.token)
    expect(broker.peek(cap.token)).toBeNull()
  })

  it('revokeExtension clears all for that extension', () => {
    const broker = new CapabilityBroker()
    const a = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    const b = broker.mint({
      extensionId: 'ext-b',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    broker.revokeExtension('ext-a')
    expect(broker.peek(a.token)).toBeNull()
    expect(broker.peek(b.token)).not.toBeNull()
  })
})

describe('CapabilityBroker.resolveSecret', () => {
  it('uses CredentialManager mock and never exposes via mint', async () => {
    const broker = new CapabilityBroker()
    const account = 'source_bearer::ws::src'
    const permission = `${SECRETS_USE_PREFIX}${account}`
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission,
      grantedPermissions: [permission],
    })
    // mint result must not include secret
    expect(JSON.stringify(cap)).not.toContain('super-secret-token')

    const secret = await broker.resolveSecret(
      cap.token,
      mockGetCredential({ [account]: 'super-secret-token' }),
    )
    expect(secret).toBe('super-secret-token')
  })

  it('singleUse deletes after resolveSecret', async () => {
    const broker = new CapabilityBroker()
    const account = 'source_bearer::ws::src'
    const permission = `${SECRETS_USE_PREFIX}${account}`
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission,
      grantedPermissions: [permission],
      singleUse: true,
    })
    await broker.resolveSecret(
      cap.token,
      mockGetCredential({ [account]: 'v' }),
    )
    expect(broker.peek(cap.token)).toBeNull()
    await expect(
      broker.resolveSecret(cap.token, mockGetCredential({ [account]: 'v' })),
    ).rejects.toThrow(/invalid or expired/i)
  })
})

describe('CapabilityBroker.proxyFetch', () => {
  it('attaches Authorization Bearer from secrets.use', async () => {
    const broker = new CapabilityBroker()
    const account = 'source_bearer::ws::src'
    const permission = `${SECRETS_USE_PREFIX}${account}`
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission,
      grantedPermissions: [permission],
    })

    let seenAuth: string | undefined
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers
      if (headers && typeof headers === 'object' && 'Authorization' in headers) {
        const auth = (headers as Record<string, string>).Authorization
        if (typeof auth === 'string') seenAuth = auth
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const result = await broker.proxyFetch({
      token: cap.token,
      url: 'https://example.com/api',
      getCredential: mockGetCredential({ [account]: 'tok-abc' }),
      fetchImpl,
    })

    expect(seenAuth).toBe('Bearer tok-abc')
    expect(result.status).toBe(200)
    expect(result.body).toContain('ok')
    // Response must not echo the secret beyond what the remote returned
    expect(result.body).not.toContain('tok-abc')
  })

  it('network.request proxy without Authorization', async () => {
    const broker = new CapabilityBroker()
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })

    let seenAuth: string | undefined
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers
      if (headers && typeof headers === 'object' && 'Authorization' in headers) {
        seenAuth = (headers as Record<string, string>).Authorization
      }
      return new Response('pong', { status: 204 })
    }

    const result = await broker.proxyFetch({
      token: cap.token,
      url: 'https://example.com/',
      getCredential: mockGetCredential({}),
      fetchImpl,
    })
    expect(result.status).toBe(204)
    expect(seenAuth).toBeUndefined()
  })

  it('singleUse deletes after successful proxyFetch', async () => {
    const broker = new CapabilityBroker()
    const account = 'source_bearer::ws::src'
    const permission = `${SECRETS_USE_PREFIX}${account}`
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission,
      grantedPermissions: [permission],
      singleUse: true,
    })

    const fetchImpl = async () => new Response('ok', { status: 200 })

    await broker.proxyFetch({
      token: cap.token,
      url: 'https://example.com/',
      getCredential: mockGetCredential({ [account]: 's' }),
      fetchImpl,
    })
    expect(broker.peek(cap.token)).toBeNull()
  })

  it('rejects expired token', async () => {
    let now = 1_000_000
    const broker = new CapabilityBroker({ now: () => now })
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
      ttlMs: 50,
    })
    now = 1_000_050
    await expect(
      broker.proxyFetch({
        token: cap.token,
        url: 'https://example.com/',
        getCredential: mockGetCredential({}),
        fetchImpl: async () => new Response('x'),
      }),
    ).rejects.toThrow(/invalid or expired/i)
  })

  it('enforces allowedUrlPrefixes', async () => {
    const broker = new CapabilityBroker()
    const cap = broker.mint({
      extensionId: 'ext-a',
      permission: 'network.request',
      grantedPermissions: ['network.request'],
    })
    await expect(
      broker.proxyFetch({
        token: cap.token,
        url: 'https://evil.example/',
        getCredential: mockGetCredential({}),
        allowedUrlPrefixes: ['https://api.good.test/'],
        fetchImpl: async () => new Response('x'),
      }),
    ).rejects.toThrow(/allowlist/i)
  })
})

describe('getCapabilityBroker singleton', () => {
  it('is stable until reset', () => {
    const a = getCapabilityBroker()
    const b = getCapabilityBroker()
    expect(a).toBe(b)
    resetCapabilityBroker()
    const c = getCapabilityBroker()
    expect(c).not.toBe(a)
  })
})
