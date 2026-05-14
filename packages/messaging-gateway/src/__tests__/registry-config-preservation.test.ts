import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CredentialManager } from '@craft-agent/shared/credentials'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { MessagingGatewayRegistry } from '../registry'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reg-cfg-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeRegistry() {
  const registry = new MessagingGatewayRegistry({
    sessionManager: { setAutomationBinder: () => {} } as unknown as ISessionManager,
    credentialManager: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    } as unknown as CredentialManager,
    getMessagingDir: (workspaceId: string) =>
      join(dir, 'workspaces', workspaceId, 'messaging'),
  })
  return { registry, workspaceId: 'ws-test' }
}

describe('MessagingGatewayRegistry — generic access config', () => {
  it('owners survive access mode changes for arbitrary platforms', () => {
    const { registry, workspaceId } = makeRegistry()
    registry.setPlatformOwners(workspaceId, 'customchat', [
      { userId: 'first-owner', addedAt: Date.now() },
    ])
    registry.setPlatformAccessMode(workspaceId, 'customchat', 'owner-only')

    expect(registry.getPlatformOwners(workspaceId, 'customchat')[0]?.userId).toBe('first-owner')
    expect(registry.getPlatformAccessMode(workspaceId, 'customchat')).toBe('owner-only')
  })

  it('lock-down migrates open bindings only for the selected platform', () => {
    const { registry, workspaceId } = makeRegistry()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = (registry as any).bootstrapWorkspace(workspaceId)
    const store = state.gateway.getBindingStore()
    const target = store.bind('ws-test', 'sess-A', 'customchat', 'chat-1', undefined, {
      accessMode: 'open',
    })
    const other = store.bind('ws-test', 'sess-B', 'otherchat', 'chat-2', undefined, {
      accessMode: 'open',
    })

    registry.setPlatformAccessMode(workspaceId, 'customchat', 'owner-only')

    expect(store.getAll().find((b: { id: string }) => b.id === target.id)?.config.accessMode).toBe('inherit')
    expect(store.getAll().find((b: { id: string }) => b.id === other.id)?.config.accessMode).toBe('open')
  })
})
