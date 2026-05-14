import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CredentialManager } from '@craft-agent/shared/credentials'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { MessagingGatewayRegistry } from '../registry'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reg-'))
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
    getMessagingDir: (workspaceId: string) => join(dir, 'workspaces', workspaceId, 'messaging'),
  })
  return { registry, workspaceId: 'ws-test' }
}

describe('MessagingGatewayRegistry core', () => {
  it('preserves arbitrary platform config entries without bundled adapters', async () => {
    const { registry, workspaceId } = makeRegistry()

    await registry.updateConfig(workspaceId, {
      enabled: true,
      platforms: {
        customchat: { enabled: true },
      },
    })

    const config = registry.getConfig(workspaceId)
    expect(config?.enabled).toBe(true)
    expect(config?.platforms.customchat?.enabled).toBe(true)
    expect(config?.runtime.customchat?.platform).toBe('customchat')
    expect(config?.runtime.customchat?.configured).toBe(true)
  })

  it('keeps owner and access helpers generic by platform name', () => {
    const { registry, workspaceId } = makeRegistry()
    registry.setPlatformOwners(workspaceId, 'customchat', [
      { userId: 'owner-1', addedAt: Date.now() },
    ])
    registry.setPlatformAccessMode(workspaceId, 'customchat', 'owner-only')

    expect(registry.getPlatformOwners(workspaceId, 'customchat')).toHaveLength(1)
    expect(registry.getPlatformAccessMode(workspaceId, 'customchat')).toBe('owner-only')
  })

  it('reports removed concrete adapter setup methods as unsupported', async () => {
    const { registry, workspaceId } = makeRegistry()
    await expect(registry.saveTelegramToken(workspaceId, 'token')).rejects.toThrow(/not bundled/)
    await expect(registry.startWhatsAppConnect(workspaceId)).rejects.toThrow(/not bundled/)
    await expect(
      registry.saveLarkCredentials(workspaceId, {
        appId: 'cli_x',
        appSecret: 'secret',
        domain: 'lark',
      }),
    ).rejects.toThrow(/not bundled/)
  })
})
