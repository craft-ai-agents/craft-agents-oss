/**
 * Registry config-write preservation — regression for PR #348 review item
 * "Block #2: supergroup pairing wipes the owners/accessMode it just seeded".
 *
 * Every Telegram config write must spread existing fields rather than
 * replace the platform object. The bugs in the original PR landed
 * `bindWorkspaceSupergroup`, `unbindWorkspaceSupergroup`, and
 * `saveTelegramToken` writing `{ enabled, supergroup }` /
 * `{ enabled: true }`, which silently dropped owners + accessMode.
 *
 * These tests pin the new helper-driven behaviour: owners + accessMode
 * survive every flow that writes platform config.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CredentialManager } from '@craft-agent/shared/credentials'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { MessagingGatewayRegistry } from '../registry'
import type { PlatformAdapter } from '../types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reg-cfg-'))
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

function makeFakeTelegramAdapter(): PlatformAdapter {
  return {
    platform: 'telegram',
    capabilities: {} as PlatformAdapter['capabilities'],
    initialize: async () => {},
    destroy: async () => {},
    isConnected: () => true,
    onMessage: () => {},
    onButtonPress: () => {},
    sendText: async () => ({ messageId: '1' }),
    editMessage: async () => {},
    sendButtons: async () => ({ messageId: '1' }),
    sendTyping: async () => {},
    sendFile: async () => ({ messageId: '1' }),
    getChatInfo: async () => ({
      type: 'supergroup' as const,
      isForum: true,
      title: 'Test SG',
    }),
    setAcceptedSupergroupChatId: () => {},
  } as unknown as PlatformAdapter
}

describe('MessagingGatewayRegistry — config preservation across writes', () => {
  it('owners survive bindWorkspaceSupergroup', async () => {
    const { registry, workspaceId } = makeRegistry()
    // Set up an owner via the public method.
    registry.setPlatformOwners(workspaceId, 'telegram', [
      { userId: 'first-owner', addedAt: Date.now() },
    ])

    // Inject an adapter and bind a supergroup.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = (registry as any).workspaces.get(workspaceId)
    state.gateway.registerAdapter(makeFakeTelegramAdapter())
    await registry.bindWorkspaceSupergroup(workspaceId, 'telegram', '-100123', 'My SG')

    const owners = registry.getPlatformOwners(workspaceId, 'telegram')
    expect(owners).toHaveLength(1)
    expect(owners[0]!.userId).toBe('first-owner')

    const supergroup = registry.getWorkspaceSupergroup(workspaceId)
    expect(supergroup?.chatId).toBe('-100123')
  })

  it('owners survive unbindWorkspaceSupergroup', async () => {
    const { registry, workspaceId } = makeRegistry()
    registry.setPlatformOwners(workspaceId, 'telegram', [
      { userId: 'first-owner', addedAt: Date.now() },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = (registry as any).workspaces.get(workspaceId)
    state.gateway.registerAdapter(makeFakeTelegramAdapter())
    await registry.bindWorkspaceSupergroup(workspaceId, 'telegram', '-100123', 'My SG')

    await registry.unbindWorkspaceSupergroup(workspaceId)

    const owners = registry.getPlatformOwners(workspaceId, 'telegram')
    expect(owners).toHaveLength(1)
    expect(owners[0]!.userId).toBe('first-owner')
    expect(registry.getWorkspaceSupergroup(workspaceId)).toBeNull()
  })

  it('owners + accessMode survive setPlatformAccessMode', () => {
    const { registry, workspaceId } = makeRegistry()
    registry.setPlatformOwners(workspaceId, 'telegram', [
      { userId: 'owner-1', addedAt: Date.now() },
    ])
    registry.setPlatformAccessMode(workspaceId, 'telegram', 'owner-only')
    const owners = registry.getPlatformOwners(workspaceId, 'telegram')
    expect(owners).toHaveLength(1)
    expect(registry.getPlatformAccessMode(workspaceId, 'telegram')).toBe('owner-only')
  })

  it('seedFirstOwner is no-op when owners already exist', async () => {
    const { registry, workspaceId } = makeRegistry()
    registry.setPlatformOwners(workspaceId, 'telegram', [
      { userId: 'first', addedAt: Date.now() },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seeded = await (registry as any).seedFirstOwner(workspaceId, 'telegram', {
      userId: 'second',
      addedAt: Date.now(),
    })
    expect(seeded).toHaveLength(1)
    expect(seeded[0].userId).toBe('first')
    const owners = registry.getPlatformOwners(workspaceId, 'telegram')
    expect(owners).toHaveLength(1)
    expect(owners[0]!.userId).toBe('first')
  })
})

describe('MessagingGatewayRegistry — lock-down migrates open bindings', () => {
  it('setPlatformAccessMode("owner-only") flips legacy open bindings to inherit', () => {
    const { registry, workspaceId } = makeRegistry()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = (registry as any).workspaces.get(workspaceId) ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (registry as any).bootstrapWorkspace(workspaceId)
    const store = state.gateway.getBindingStore()
    // Persist a binding in legacy 'open' mode (mimics migration).
    const b = store.bind('ws-test', 'sess-A', 'telegram', 'chat-1', undefined, {
      accessMode: 'open',
    })
    expect(b.config.accessMode).toBe('open')

    registry.setPlatformAccessMode(workspaceId, 'telegram', 'owner-only')

    const reloaded = store.getAll().find((x: { id: string }) => x.id === b.id)
    expect(reloaded.config.accessMode).toBe('inherit')
    // Binding ID and createdAt must have survived the migration (no rotation).
    expect(reloaded.id).toBe(b.id)
    expect(reloaded.createdAt).toBe(b.createdAt)
  })

  it('non-telegram bindings are not touched by the lock-down', () => {
    const { registry, workspaceId } = makeRegistry()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = (registry as any).workspaces.get(workspaceId) ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (registry as any).bootstrapWorkspace(workspaceId)
    const store = state.gateway.getBindingStore()
    const wa = store.bind('ws-test', 'sess-A', 'whatsapp', 'chan-A', undefined, {
      accessMode: 'open',
    })

    registry.setPlatformAccessMode(workspaceId, 'telegram', 'owner-only')

    const reloaded = store.getAll().find((x: { id: string }) => x.id === wa.id)
    expect(reloaded.config.accessMode).toBe('open')
  })
})
