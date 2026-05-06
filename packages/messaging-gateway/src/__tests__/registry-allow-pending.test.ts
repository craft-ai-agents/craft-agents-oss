/**
 * Registry.allowPendingSender — branches on the pending entry's `reason`.
 * Regression for PR #348 review item "Block #5: pending requests conflate
 * workspace-owner rejects and binding allow-list rejects".
 *
 * Rules under test:
 *  - 'not-owner' reject → adds to platform owners
 *  - 'not-on-binding-allowlist' reject → appends to binding's
 *    allowedSenderIds, does NOT touch workspace owners
 *  - Stale binding (deleted between reject and Allow) → throws and
 *    auto-dismisses the pending entry
 *  - Promotion to owner via 'not-owner' clears all pending rows for
 *    that sender (binding rows are superseded by inherit)
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CredentialManager } from '@craft-agent/shared/credentials'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { MessagingGatewayRegistry } from '../registry'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reg-allow-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function stubSessionManager(): ISessionManager {
  return { setAutomationBinder: () => {} } as unknown as ISessionManager
}

function stubCredentialManager(): CredentialManager {
  return {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
  } as unknown as CredentialManager
}

function makeRegistry() {
  const registry = new MessagingGatewayRegistry({
    sessionManager: stubSessionManager(),
    credentialManager: stubCredentialManager(),
    getMessagingDir: (workspaceId: string) =>
      join(dir, 'workspaces', workspaceId, 'messaging'),
    whatsapp: { workerEntry: '/dev/null' },
  })
  return { registry, workspaceId: 'ws-test' }
}

// Tests reach into the registry's private workspace map. The shape is
// stable enough that a loose `any` for the gateway is acceptable here —
// trying to spell out the full type pulls in BindingStore / PendingStore
// transitively via ReturnType<...>, which TS rejects as circular.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getInternalState(registry: MessagingGatewayRegistry, workspaceId: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = registry as any
  return r.workspaces.get(workspaceId) ?? r.bootstrapWorkspace(workspaceId)
}

describe('MessagingGatewayRegistry.allowPendingSender — reason branching', () => {
  it("'not-owner' reject is promoted to platform owner", () => {
    const { registry, workspaceId } = makeRegistry()
    const state = getInternalState(registry, workspaceId)!
    state.gateway.getPendingStore().recordRejection({
      platform: 'telegram',
      senderId: 'stranger',
      senderName: 'Bob',
      reason: 'not-owner',
    })

    const result = registry.allowPendingSender(workspaceId, 'telegram', 'stranger')

    expect(result.owners.some((o: { userId: string }) => o.userId === 'stranger')).toBe(true)
    // Pending row is dismissed.
    const pending = state.gateway.getPendingStore().list('telegram')
    expect(pending.find((p: { userId: string }) => p.userId === 'stranger')).toBeUndefined()
  })

  it("'not-on-binding-allowlist' reject appends to binding allow-list, NOT workspace owners", () => {
    const { registry, workspaceId } = makeRegistry()
    const state = getInternalState(registry, workspaceId)!
    const store = state.gateway.getBindingStore()
    const binding = store.bind('ws-test', 'sess-A', 'telegram', 'chat-A', undefined, {
      accessMode: 'allow-list',
      allowedSenderIds: ['alice'],
    })
    state.gateway.getPendingStore().recordRejection({
      platform: 'telegram',
      senderId: 'bob',
      senderName: 'Bob',
      reason: 'not-on-binding-allowlist',
      bindingId: binding.id,
      sessionId: binding.sessionId,
    })

    const result = registry.allowPendingSender(workspaceId, 'telegram', 'bob', {
      reason: 'not-on-binding-allowlist',
      bindingId: binding.id,
    })

    // Workspace owners list is untouched.
    expect(result.owners.find((o: { userId: string }) => o.userId === 'bob')).toBeUndefined()
    expect(registry.getPlatformOwners(workspaceId, 'telegram')).toHaveLength(0)
    // Binding's allow-list now includes bob.
    const reloaded = store.getAll().find((x: { id: string }) => x.id === binding.id)!
    expect(reloaded.config.accessMode).toBe('allow-list')
    expect(reloaded.config.allowedSenderIds).toContain('bob')
    expect(reloaded.config.allowedSenderIds).toContain('alice')
    expect(result.bindingId).toBe(binding.id)
  })

  it("'not-on-binding-allowlist' with stale binding dismisses pending and throws", () => {
    const { registry, workspaceId } = makeRegistry()
    const state = getInternalState(registry, workspaceId)!
    state.gateway.getPendingStore().recordRejection({
      platform: 'telegram',
      senderId: 'bob',
      reason: 'not-on-binding-allowlist',
      bindingId: 'binding-that-no-longer-exists',
    })

    expect(() =>
      registry.allowPendingSender(workspaceId, 'telegram', 'bob', {
        reason: 'not-on-binding-allowlist',
        bindingId: 'binding-that-no-longer-exists',
      }),
    ).toThrow(/Binding no longer exists/)

    // Pending entry was auto-dismissed.
    const pending = state.gateway.getPendingStore().list('telegram')
    expect(pending).toHaveLength(0)
  })

  it("'not-owner' promotion clears all pending rows for the sender", () => {
    const { registry, workspaceId } = makeRegistry()
    const state = getInternalState(registry, workspaceId)!
    const store = state.gateway.getBindingStore()
    const binding = store.bind('ws-test', 'sess-A', 'telegram', 'chat-A', undefined, {
      accessMode: 'allow-list',
      allowedSenderIds: ['alice'],
    })
    // Bob has TWO pending rows: one workspace-level, one binding-level.
    state.gateway.getPendingStore().recordRejection({
      platform: 'telegram',
      senderId: 'bob',
      reason: 'not-owner',
    })
    state.gateway.getPendingStore().recordRejection({
      platform: 'telegram',
      senderId: 'bob',
      reason: 'not-on-binding-allowlist',
      bindingId: binding.id,
    })
    expect(state.gateway.getPendingStore().list('telegram')).toHaveLength(2)

    registry.allowPendingSender(workspaceId, 'telegram', 'bob', { reason: 'not-owner' })

    // Both rows dismissed — once Bob is a workspace owner, the binding
    // reject is moot (he inherits access for inherit-mode bindings, and
    // the allow-list-mode binding still doesn't include him, but that's
    // a separate decision the operator can make explicitly).
    expect(state.gateway.getPendingStore().list('telegram')).toHaveLength(0)
  })

  it('refuses promotion for unknown sender (not in pending)', () => {
    const { registry, workspaceId } = makeRegistry()
    expect(() =>
      registry.allowPendingSender(workspaceId, 'telegram', 'never-attempted'),
    ).toThrow(/not found/)
  })
})
