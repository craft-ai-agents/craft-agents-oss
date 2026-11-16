import { describe, expect, it } from 'bun:test'
import {
  validateSetupTestInput,
  isLoopbackBaseUrl,
  setupTestRequiresApiKey,
  resolveCustomEndpointSetup,
  createBuiltInConnection,
  API_KEY_MASK,
  maskApiKey,
  isMaskedApiKey,
  resolveSetupTestApiKey,
  storeSetupOAuthToken,
  deleteConnectionCredentials,
  releaseLegacyClaudeSlot,
} from './connection-setup-logic'

describe('validateSetupTestInput', () => {
  it('rejects pi custom endpoint tests without piAuthProvider', () => {
    const result = validateSetupTestInput({
      provider: 'pi',
      baseUrl: 'https://example.com/v1',
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('requires selecting a provider preset')
    }
  })

  it('allows pi custom endpoint tests with piAuthProvider', () => {
    expect(validateSetupTestInput({
      provider: 'pi',
      baseUrl: 'https://example.com/v1',
      piAuthProvider: 'openai',
    })).toEqual({ valid: true })
  })
})

describe('setup test API key requirements', () => {
  it('detects loopback base URLs', () => {
    expect(isLoopbackBaseUrl('http://localhost:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('http://[::1]:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('https://api.openai.com/v1')).toBe(false)
  })

  it('requires API key for non-loopback setup tests', () => {
    expect(setupTestRequiresApiKey('https://api.anthropic.com')).toBe(true)
    expect(setupTestRequiresApiKey('https://example.com/v1')).toBe(true)
  })

  it('allows keyless setup tests for loopback endpoints', () => {
    expect(setupTestRequiresApiKey('http://localhost:11434/v1')).toBe(false)
    expect(setupTestRequiresApiKey('http://127.0.0.1:11434/v1')).toBe(false)
  })
})

describe('resolveCustomEndpointSetup', () => {
  it('treats loopback URL with no credential as keyless local model', () => {
    const result = resolveCustomEndpointSetup({
      baseUrl: 'http://localhost:11434/v1',
      credential: undefined,
      customEndpointApi: 'openai-completions',
    })

    expect(result).toEqual({ authType: 'none', name: 'Local Model' })
    expect(result.piAuthProvider).toBeUndefined()
  })

  it('treats loopback URL *with* a credential as a keyed custom endpoint (#636)', () => {
    // Real-world case: vLLM, LiteLLM, or any local OpenAI-compat server with --api-key.
    // Without piAuthProvider, getPiAuth() returns null at runtime → 401 on every chat request.
    const result = resolveCustomEndpointSetup({
      baseUrl: 'http://127.0.0.1:11111/v1',
      credential: 'sk-local-test',
      customEndpointApi: 'openai-completions',
    })

    expect(result).toEqual({ authType: 'api_key_with_endpoint', piAuthProvider: 'openai' })
    expect(result.name).toBeUndefined()
  })

  it('uses the anthropic provider hint for anthropic-messages protocol', () => {
    const result = resolveCustomEndpointSetup({
      baseUrl: 'http://127.0.0.1:8080',
      credential: 'sk-ant-local',
      customEndpointApi: 'anthropic-messages',
    })

    expect(result).toEqual({ authType: 'api_key_with_endpoint', piAuthProvider: 'anthropic' })
  })

  it('treats remote endpoints with a credential as keyed custom endpoints', () => {
    expect(resolveCustomEndpointSetup({
      baseUrl: 'https://api.example.com/v1',
      credential: 'sk-remote',
      customEndpointApi: 'openai-completions',
    })).toEqual({ authType: 'api_key_with_endpoint', piAuthProvider: 'openai' })
  })

  it('treats remote endpoints without a credential as keyed (still requires a key)', () => {
    // Non-loopback URLs are never assumed keyless, even if credential is missing —
    // setup validation handles "missing key" separately. We still set piAuthProvider
    // so the saved connection has a useful icon.
    expect(resolveCustomEndpointSetup({
      baseUrl: 'https://api.example.com/v1',
      credential: undefined,
      customEndpointApi: 'openai-completions',
    })).toEqual({ authType: 'api_key_with_endpoint', piAuthProvider: 'openai' })
  })

  it('treats undefined baseUrl as a non-loopback (keyed) endpoint', () => {
    expect(resolveCustomEndpointSetup({
      baseUrl: undefined,
      credential: 'sk-anything',
      customEndpointApi: 'openai-completions',
    })).toEqual({ authType: 'api_key_with_endpoint', piAuthProvider: 'openai' })
  })
})

// New connections must persist a per-provider midStreamBehavior default so the
// per-connection submenu in Settings → AI shows a checkmark on the right item
// out of the box (no read-time fallback needed for fresh connections).
describe('createBuiltInConnection seeds midStreamBehavior', () => {
  it("Anthropic API key → 'queue' (Claude's emulated steer is fragile)", () => {
    const conn = createBuiltInConnection('anthropic-api')
    expect(conn.providerType).toBe('anthropic')
    expect(conn.midStreamBehavior).toBe('queue')
  })

  it("Claude Max OAuth → 'queue' (still uses Claude SDK)", () => {
    const conn = createBuiltInConnection('claude-max')
    expect(conn.providerType).toBe('anthropic')
    expect(conn.midStreamBehavior).toBe('queue')
  })

  it("ChatGPT Plus → 'steer' (Pi backend, native polite steer)", () => {
    const conn = createBuiltInConnection('chatgpt-plus')
    expect(conn.providerType).toBe('pi')
    expect(conn.midStreamBehavior).toBe('steer')
  })

  it("Pi API key (Craft Agents Backend) → 'steer'", () => {
    const conn = createBuiltInConnection('pi-api-key')
    expect(conn.providerType).toBe('pi')
    expect(conn.midStreamBehavior).toBe('steer')
  })

  it("anthropic-api with custom endpoint becomes pi_compat → 'steer'", () => {
    const conn = createBuiltInConnection('anthropic-api', 'http://localhost:11434/v1')
    expect(conn.providerType).toBe('pi_compat')
    expect(conn.midStreamBehavior).toBe('steer')
  })
})

describe('API key masking for the edit form', () => {
  it('masks long keys keeping the provider prefix and the last four characters', () => {
    expect(maskApiKey('sk-ant-api03-abcdefghijklmnop')).toBe(`sk-ant-${API_KEY_MASK}mnop`)
  })

  it('masks short keys completely', () => {
    expect(maskApiKey('short-key')).toBe(API_KEY_MASK)
  })

  it('recognizes masked values and nothing else', () => {
    expect(isMaskedApiKey(maskApiKey('sk-ant-api03-abcdefghijklmnop'))).toBe(true)
    expect(isMaskedApiKey(API_KEY_MASK)).toBe(true)
    expect(isMaskedApiKey('sk-ant-api03-abcdefghijklmnop')).toBe(false)
    expect(isMaskedApiKey('')).toBe(false)
    expect(isMaskedApiKey(undefined)).toBe(false)
    expect(isMaskedApiKey(null)).toBe(false)
  })
})

// Regression for OSS #1048 (PR #1049 by Code-MonkeyZhang): editing a connection
// and clicking Test sent the masked placeholder as the API key.
describe('resolveSetupTestApiKey', () => {
  const STORED = 'sk-ant-stored-key-0000000000'
  let lookups: string[] = []
  const store = async (slug: string) => {
    lookups.push(slug)
    return slug === 'anthropic' ? STORED : null
  }

  it('uses a typed key as-is and never consults the store', async () => {
    lookups = []
    const result = await resolveSetupTestApiKey({ apiKey: '  sk-new-key  ', connectionSlug: 'anthropic', allowEmptyApiKey: false }, store)
    expect(result).toEqual({ ok: true, apiKey: 'sk-new-key', source: 'input' })
    expect(lookups).toEqual([])
  })

  it('resolves the masked placeholder to the stored key of the edited connection', async () => {
    lookups = []
    const result = await resolveSetupTestApiKey({ apiKey: maskApiKey(STORED), connectionSlug: 'anthropic', allowEmptyApiKey: false }, store)
    expect(result).toEqual({ ok: true, apiKey: STORED, source: 'stored' })
    expect(lookups).toEqual(['anthropic'])
  })

  it('asks for the key when the placeholder arrives without a connection slug', async () => {
    const result = await resolveSetupTestApiKey({ apiKey: API_KEY_MASK, allowEmptyApiKey: false }, store)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Re-enter the API key')
  })

  it('asks for the key when nothing is stored for the slug', async () => {
    const result = await resolveSetupTestApiKey({ apiKey: API_KEY_MASK, connectionSlug: 'missing', allowEmptyApiKey: true }, store)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('No API key is stored')
  })

  it('requires a key for remote endpoints and allows none for loopback', async () => {
    expect(await resolveSetupTestApiKey({ apiKey: '', allowEmptyApiKey: false }, store)).toEqual({ ok: false, error: 'API key is required' })
    expect(await resolveSetupTestApiKey({ apiKey: undefined, allowEmptyApiKey: true }, store)).toEqual({ ok: true, apiKey: '', source: 'input' })
  })
})

describe('storeSetupOAuthToken', () => {
  type Entry = { accessToken: string; refreshToken?: string; expiresAt?: number }
  function storeWith(entries: Record<string, Entry>) {
    return {
      entries,
      getLlmOAuth: async (slug: string) => entries[slug] ?? null,
      setLlmOAuth: async (slug: string, credentials: Entry) => {
        entries[slug] = credentials
      },
    }
  }

  it('keeps the refresh token and expiry the sign-in stored with the same access token', async () => {
    const store = storeWith({ 'claude-max': { accessToken: 'at', refreshToken: 'rt', expiresAt: 1 } })

    expect(await storeSetupOAuthToken(store, 'claude-max', 'at')).toBe(false)
    expect(store.entries['claude-max']).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: 1 })
  })

  it('stores a token the connection does not hold yet', async () => {
    const store = storeWith({ 'claude-max': { accessToken: 'old', refreshToken: 'rt' } })

    expect(await storeSetupOAuthToken(store, 'claude-max', 'new')).toBe(true)
    expect(await storeSetupOAuthToken(store, 'claude-max-2', 'other')).toBe(true)
    expect(store.entries).toEqual({ 'claude-max': { accessToken: 'new' }, 'claude-max-2': { accessToken: 'other' } })
  })
})

describe('deleteConnectionCredentials', () => {
  function store() {
    const deleted: string[] = []
    return {
      deleted,
      deleteLlmCredentials: async (slug: string) => { deleted.push(slug) },
      delete: async (id: { type: string }) => { deleted.push(id.type); return true },
    }
  }
  const claude = { slug: 'claude-max', providerType: 'anthropic', authType: 'oauth' }

  it('deletes the legacy Claude sign-in with the default Claude connection', async () => {
    const s = store()
    await deleteConnectionCredentials(s, claude, true)
    expect(s.deleted).toEqual(['claude-max', 'claude_oauth'])
  })

  it('keeps it when another connection is deleted', async () => {
    const notDefault = store()
    await deleteConnectionCredentials(notDefault, claude, false)
    expect(notDefault.deleted).toEqual(['claude-max'])

    const apiKey = store()
    await deleteConnectionCredentials(apiKey, { slug: 'anthropic-api', providerType: 'anthropic', authType: 'api_key' }, true)
    expect(apiKey.deleted).toEqual(['anthropic-api'])
  })
})

describe('releaseLegacyClaudeSlot', () => {
  type Tokens = { accessToken: string; refreshToken?: string; expiresAt?: number }
  function store(legacy: Tokens | null, own: Record<string, Tokens> = {}) {
    const s = {
      legacy,
      own,
      getClaudeOAuthCredentials: async () => s.legacy,
      getLlmOAuth: async (slug: string) => s.own[slug] ?? null,
      setLlmOAuth: async (slug: string, tokens: Tokens) => { s.own[slug] = tokens },
      delete: async () => { s.legacy = null; return true },
    }
    return s
  }
  const slot = { accessToken: 'slot-access', refreshToken: 'slot-refresh', expiresAt: 1 }
  const claude = { slug: 'claude-max', providerType: 'anthropic', authType: 'oauth' }

  it("moves the slot to the previous default's own entry when it ran on it", async () => {
    const s = store(slot)
    await releaseLegacyClaudeSlot(s, claude, true, 'claude-work')
    expect(s.legacy).toBeNull()
    expect(s.own['claude-max']).toEqual(slot)
    expect(s.own['claude-work']).toBeUndefined()
  })

  it('deletes it without copying when the previous default did not run on it', async () => {
    const hasOwn = store(slot, { 'claude-max': { accessToken: 'own' } })
    await releaseLegacyClaudeSlot(hasOwn, claude, true, 'claude-work')
    expect(hasOwn.legacy).toBeNull()
    expect(hasOwn.own['claude-max']).toEqual({ accessToken: 'own' })

    // Another connection had credentials of its own, so the slot may hold that account.
    const signedOut = store(slot)
    await releaseLegacyClaudeSlot(signedOut, claude, false, 'claude-work')
    expect(signedOut.legacy).toBeNull()
    expect(signedOut.own).toEqual({})
  })

  it('leaves it alone unless the default moves away from a Claude sign-in', async () => {
    for (const [previous, next] of [
      [null, 'claude-max'],
      [claude, 'claude-max'],
      [{ slug: 'openai', providerType: 'pi', authType: 'api_key' }, 'claude-max'],
      [{ slug: 'anthropic-api', providerType: 'anthropic', authType: 'api_key' }, 'claude-max'],
    ] as const) {
      const s = store(slot)
      await releaseLegacyClaudeSlot(s, previous, true, next)
      expect(s.legacy).toEqual(slot)
      expect(s.own).toEqual({})
    }
  })
})
