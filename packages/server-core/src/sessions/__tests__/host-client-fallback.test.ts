/**
 * Host-client fallback test.
 *
 * Verifies the SessionManager.getBrowserHostClient resolution logic — the
 * fallback path that re-pins to any other connected client advertising
 * `client:browser:invoke` when the pinned client is gone.
 *
 * We don't instantiate the full SessionManager (it has too many file-system
 * dependencies); instead we mirror the resolver behavior using the same
 * `findClientsWithCapability` / `hasClientCapability` contracts.
 */

import { describe, it, expect } from 'bun:test'
import { CLIENT_BROWSER_INVOKE } from '../../transport/capabilities'
import type { RpcServer } from '../../transport/types'

class FakeServer {
  private capabilities = new Map<string, Set<string>>()
  private workspaceByClient = new Map<string, string>()

  addClient(clientId: string, workspaceId: string, caps: string[] = []): void {
    this.capabilities.set(clientId, new Set(caps))
    this.workspaceByClient.set(clientId, workspaceId)
  }
  removeClient(clientId: string): void {
    this.capabilities.delete(clientId)
    this.workspaceByClient.delete(clientId)
  }
  asServer(): RpcServer {
    return {
      handle() {},
      push() {},
      async invokeClient() { return undefined },
      hasClientCapability: (clientId, capability) =>
        this.capabilities.get(clientId)?.has(capability) ?? false,
      findClientsWithCapability: (capability, opts) => {
        const results: string[] = []
        for (const [clientId, caps] of this.capabilities) {
          if (!caps.has(capability)) continue
          if (opts?.workspaceId && this.workspaceByClient.get(clientId) !== opts.workspaceId) continue
          results.push(clientId)
        }
        return results
      },
    }
  }
}

// Mirror SessionManager.getBrowserHostClient — keep in sync with the real
// implementation in SessionManager.ts.
function resolveHostClient(
  rpcServer: RpcServer,
  pinByCanvas: Map<string, string>,
  sessionId: string,
  workspaceId: string,
): string | null {
  const pinned = pinByCanvas.get(sessionId)
  if (pinned && rpcServer.hasClientCapability(pinned, CLIENT_BROWSER_INVOKE)) return pinned
  const fallback = rpcServer.findClientsWithCapability(
    CLIENT_BROWSER_INVOKE,
    { workspaceId },
  )[0]
  if (!fallback) return null
  pinByCanvas.set(sessionId, fallback)
  return fallback
}

describe('SessionManager — host-client fallback', () => {
  it('returns the pinned client when it still advertises the capability', () => {
    const fake = new FakeServer()
    fake.addClient('client-A', 'ws-1', [CLIENT_BROWSER_INVOKE])
    const pins = new Map([['sess-1', 'client-A']])
    expect(resolveHostClient(fake.asServer(), pins, 'sess-1', 'ws-1')).toBe('client-A')
  })

  it('re-pins to a different connected client in the same workspace when the pinned client is gone', () => {
    const fake = new FakeServer()
    fake.addClient('client-B', 'ws-1', [CLIENT_BROWSER_INVOKE])
    const pins = new Map([['sess-1', 'client-A-disconnected']])

    const resolved = resolveHostClient(fake.asServer(), pins, 'sess-1', 'ws-1')
    expect(resolved).toBe('client-B')
    expect(pins.get('sess-1')).toBe('client-B') // pin was updated
  })

  it('returns null when no client in the workspace advertises the capability', () => {
    const fake = new FakeServer()
    fake.addClient('client-X', 'ws-OTHER', [CLIENT_BROWSER_INVOKE])
    const pins = new Map<string, string>()
    expect(resolveHostClient(fake.asServer(), pins, 'sess-1', 'ws-1')).toBeNull()
  })

  it('does not pick clients that lack the capability', () => {
    const fake = new FakeServer()
    fake.addClient('client-Y', 'ws-1', []) // no caps
    const pins = new Map<string, string>()
    expect(resolveHostClient(fake.asServer(), pins, 'sess-1', 'ws-1')).toBeNull()
  })
})
