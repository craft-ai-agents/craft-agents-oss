/**
 * Tests for deferred ChatGPT token injection in CodexAgent.
 *
 * The CodexAgent caches ChatGPT tokens in `_pendingChatGptTokens` when the
 * app-server client isn't connected yet. Tokens are then injected during
 * `ensureClient()` when the client becomes available.
 *
 * These tests validate the caching/injection logic pattern without
 * instantiating a real CodexAgent (which requires subprocess spawning).
 */
import { describe, it, expect } from 'bun:test'

// ---------------------------------------------------------------------------
// Simulate the deferred token injection pattern from codex-agent.ts
// ---------------------------------------------------------------------------

interface MockClient {
  isConnected(): boolean
  accountLoginWithChatGptTokens(tokens: { idToken: string; accessToken: string }): Promise<void>
}

/**
 * Minimal simulation of the token injection logic from CodexAgent.
 * Mirrors: codex-agent.ts tryInjectStoredChatGptTokens() + ensureClient()
 */
class TokenInjectionSimulator {
  _pendingChatGptTokens: { idToken: string; accessToken: string } | null = null
  client: MockClient | null = null
  injectedTokens: { idToken: string; accessToken: string } | null = null

  /** Mirrors tryInjectStoredChatGptTokens — caches or injects directly */
  async tryInject(tokens: { idToken: string; accessToken: string }): Promise<void> {
    if (this.client?.isConnected()) {
      await this.client.accountLoginWithChatGptTokens(tokens)
      this.injectedTokens = tokens
    } else {
      this._pendingChatGptTokens = tokens
    }
  }

  /** Mirrors ensureClient — drains pending tokens after client connects */
  async ensureClient(client: MockClient): Promise<void> {
    this.client = client
    if (this._pendingChatGptTokens) {
      await client.accountLoginWithChatGptTokens(this._pendingChatGptTokens)
      this.injectedTokens = this._pendingChatGptTokens
      this._pendingChatGptTokens = null
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deferred ChatGPT token injection', () => {
  it('caches tokens in _pendingChatGptTokens when client not connected', async () => {
    const sim = new TokenInjectionSimulator()
    const tokens = { idToken: 'id-123', accessToken: 'access-456' }

    await sim.tryInject(tokens)

    expect(sim._pendingChatGptTokens).toEqual(tokens)
    expect(sim.injectedTokens).toBeNull()
  })

  it('injects tokens via accountLoginWithChatGptTokens during ensureClient', async () => {
    const sim = new TokenInjectionSimulator()
    const tokens = { idToken: 'id-123', accessToken: 'access-456' }

    // Cache tokens (no client yet)
    await sim.tryInject(tokens)
    expect(sim._pendingChatGptTokens).toEqual(tokens)

    // Simulate ensureClient with a connected client
    const injectedCalls: Array<{ idToken: string; accessToken: string }> = []
    const mockClient: MockClient = {
      isConnected: () => true,
      accountLoginWithChatGptTokens: async (t) => { injectedCalls.push(t) },
    }

    await sim.ensureClient(mockClient)

    expect(injectedCalls).toHaveLength(1)
    expect(injectedCalls[0]).toEqual(tokens)
    expect(sim.injectedTokens).toEqual(tokens)
  })

  it('clears _pendingChatGptTokens to null after injection', async () => {
    const sim = new TokenInjectionSimulator()
    const tokens = { idToken: 'id-123', accessToken: 'access-456' }

    await sim.tryInject(tokens)
    expect(sim._pendingChatGptTokens).not.toBeNull()

    const mockClient: MockClient = {
      isConnected: () => true,
      accountLoginWithChatGptTokens: async () => {},
    }

    await sim.ensureClient(mockClient)
    expect(sim._pendingChatGptTokens).toBeNull()
  })

  it('second cache call overwrites first (double-cache)', async () => {
    const sim = new TokenInjectionSimulator()

    await sim.tryInject({ idToken: 'first-id', accessToken: 'first-access' })
    await sim.tryInject({ idToken: 'second-id', accessToken: 'second-access' })

    expect(sim._pendingChatGptTokens).toEqual({
      idToken: 'second-id',
      accessToken: 'second-access',
    })
  })

  it('injects directly when client is already connected', async () => {
    const injectedCalls: Array<{ idToken: string; accessToken: string }> = []
    const sim = new TokenInjectionSimulator()
    sim.client = {
      isConnected: () => true,
      accountLoginWithChatGptTokens: async (t) => { injectedCalls.push(t) },
    }

    const tokens = { idToken: 'id-123', accessToken: 'access-456' }
    await sim.tryInject(tokens)

    // Should inject directly, not cache
    expect(sim._pendingChatGptTokens).toBeNull()
    expect(injectedCalls).toHaveLength(1)
    expect(injectedCalls[0]).toEqual(tokens)
  })

  it('does not inject during ensureClient when no pending tokens', async () => {
    const sim = new TokenInjectionSimulator()
    const injectedCalls: Array<{ idToken: string; accessToken: string }> = []
    const mockClient: MockClient = {
      isConnected: () => true,
      accountLoginWithChatGptTokens: async (t) => { injectedCalls.push(t) },
    }

    await sim.ensureClient(mockClient)

    expect(injectedCalls).toHaveLength(0)
    expect(sim.injectedTokens).toBeNull()
  })
})
