import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'bun:test'
import { CredentialRefRegistry } from '@craft-agent/core/platform'
import type { CredentialBackend } from '@craft-agent/shared/credentials'
import type { CredentialId, StoredCredential } from '@craft-agent/shared/credentials'
import {
  credentialIdToAccount,
  InProcessCredentialBroker,
  LocalFileSecretProvider,
} from '@craft-agent/shared/credentials'

import { createWorkGraphKernel } from './index'
import { commitGithubEnvImport, previewGithubEnvImport } from './github-import.ts'

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

describe('CF-7.2 GitHub env import', () => {
  it('previews only GitHub env names and never leaks the token', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-cf72-'))
    roots.push(root)
    const envPath = join(root, '.env')
    writeFileSync(envPath, 'GH_TOKEN=super-secret\nNOTE=ignore\n')
    const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry())
    const preview = await previewGithubEnvImport({ envPath, provider })
    expect(preview.map((row) => row.label)).toEqual(['GH_TOKEN'])
    expect(preview[0]?.maskedSummary).not.toContain('super-secret')
    expect(JSON.stringify(preview)).not.toContain('super-secret')
  })

  nativeIt('commits a copy Connection without putting the token on the record', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-cf72-commit-'))
    roots.push(root)
    const envPath = join(root, '.env')
    writeFileSync(envPath, 'GITHUB_TOKEN=super-secret\n')
    const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry())
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()
    const connection = await commitGithubEnvImport({
      envPath,
      candidateId: 'GITHUB_TOKEN',
      provider,
      kernel,
      workspaceId: 'workspace_a',
      requestedBy: 'owner',
    })
    expect(connection.integrationId).toBe('github')
    expect(connection.credentialRefId).toMatch(/^cred_/)
    expect(JSON.stringify(connection)).not.toContain('super-secret')
    await kernel.close()
  })

  nativeIt('grants the importer so the broker can lease without exposing the token', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-cf72-broker-'))
    roots.push(root)
    const envPath = join(root, '.env')
    writeFileSync(envPath, 'GH_TOKEN=super-secret\n')
    const registry = new CredentialRefRegistry()
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry)
    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id))
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()
    const connection = await commitGithubEnvImport({
      envPath,
      candidateId: 'GH_TOKEN',
      provider,
      kernel,
      broker,
      workspaceId: 'workspace_a',
      requestedBy: 'owner',
    })
    const lease = await broker.acquireLease({
      credentialRef: connection.credentialRefId,
      consumer: { kind: 'human', id: 'owner', workspaceId: 'workspace_a' },
      purpose: 'github.user',
      action: 'github.api',
      resources: ['github:user'],
      audience: 'local-broker',
      ttl: 5_000,
    })
    expect(lease.status).toBe('active')
    expect(lease).not.toHaveProperty('payload')
    expect(lease).not.toHaveProperty('value')
    expect(JSON.stringify(lease)).not.toContain('super-secret')
    await kernel.close()
  })
})
