import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'bun:test'
import { CredentialRefRegistry } from '@craft-agent/core/platform'
import type { CredentialBackend } from '@craft-agent/shared/credentials'
import type { CredentialId, StoredCredential } from '@craft-agent/shared/credentials'
import { credentialIdToAccount } from '@craft-agent/shared/credentials'
import { LocalFileSecretProvider } from '@craft-agent/shared/credentials'

import { createWorkGraphKernel } from './index'
import { testGithubConnection, type GithubFetch } from './connection-test.ts'

const roots: string[] = []
const nativeIt = process.platform === 'darwin' && process.arch === 'arm64' ? it : it.skip

class MemoryBackend implements CredentialBackend {
  readonly name = 'memory'
  readonly priority = 1
  readonly store = new Map<string, StoredCredential>()
  async isAvailable(): Promise<boolean> { return true }
  async get(id: CredentialId): Promise<StoredCredential | null> {
    return this.store.get(credentialIdToAccount(id)) ?? null
  }
  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    this.store.set(credentialIdToAccount(id), credential)
  }
  async delete(id: CredentialId): Promise<boolean> {
    return this.store.delete(credentialIdToAccount(id))
  }
  async list(): Promise<CredentialId[]> { return [] }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('CF-6.5 test GitHub connection', () => {
  nativeIt('returns login only through injected fetch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-cf65-test-'))
    roots.push(root)
    const registry = new CredentialRefRegistry()
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry)
    const written = await provider.write({
      kind: 'bearer_token',
      locator: { type: 'local', key: 'github/default' },
      payload: { value: 'super-secret' },
    })
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()
    const connection = await kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'github',
      credentialRefId: written.ref.id,
      storageMode: 'copy',
    })

    const seenAuth: string[] = []
    const fetchImpl: GithubFetch = async (_url, init) => {
      seenAuth.push(init?.headers?.Authorization ?? '')
      return new Response(JSON.stringify({ login: 'octocat' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const result = await testGithubConnection({
      kernel,
      provider,
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      fetchImpl,
    })
    expect(result).toEqual({ login: 'octocat' })
    expect(seenAuth[0]?.startsWith('Bearer ')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('super-secret')
    await kernel.close()
  })

  nativeIt('rejects a non-GitHub integration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-cf65-nongh-'))
    roots.push(root)
    const registry = new CredentialRefRegistry()
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry)
    const written = await provider.write({
      kind: 'bearer_token',
      locator: { type: 'local', key: 'other/default' },
      payload: { value: 'super-secret' },
    })
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()
    const connection = await kernel.createConnection({
      workspaceId: 'workspace_a',
      integrationId: 'docker',
      credentialRefId: written.ref.id,
      storageMode: 'copy',
    })
    await expect(testGithubConnection({
      kernel,
      provider,
      workspaceId: 'workspace_a',
      connectionId: connection.id,
      fetchImpl: async () => new Response('{}'),
    })).rejects.toThrow(/unsupported_test/)
    await kernel.close()
  })
})
