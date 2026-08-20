import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'bun:test'
import { CredentialRefRegistry } from '@craft-agent/core/platform'
import type { CredentialBackend } from '@craft-agent/shared/credentials'
import type { CredentialId, StoredCredential } from '@craft-agent/shared/credentials'
import { credentialIdToAccount } from '@craft-agent/shared/credentials'
import {
  EnvFileImporter,
  InProcessCredentialBroker,
  LocalFileSecretProvider,
} from '@craft-agent/shared/credentials'

import { createWorkGraphKernel } from './index'
import { isGithubEnvCandidate, runGithubVertical, type GithubFetch } from './github-vertical.ts'
import { revokeConnectionAndRevalidate } from './revalidation.ts'

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

describe('CF-7.1 GitHub import-to-lease vertical', () => {
  it('recognizes GitHub env names only', () => {
    expect(isGithubEnvCandidate('GH_TOKEN')).toBe(true)
    expect(isGithubEnvCandidate('GITHUB_TOKEN')).toBe(true)
    expect(isGithubEnvCandidate('NOTE')).toBe(false)
  })

  nativeIt('imports a GH_TOKEN, brokers /user, then revoke kills the lease', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-cf7-'))
    roots.push(root)
    const envPath = join(root, '.env')
    writeFileSync(envPath, 'GH_TOKEN=super-secret\nNOTE=ignore-me\n')

    const registry = new CredentialRefRegistry()
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry)
    const importer = new EnvFileImporter(envPath, provider)
    const discovered = await importer.discover()
    expect(discovered.some((row) => isGithubEnvCandidate(row.label))).toBe(true)
    expect(JSON.stringify(discovered)).not.toContain('super-secret')
    const preview = await importer.preview({ candidateId: 'GH_TOKEN' })
    expect(preview.maskedSummary).not.toContain('super-secret')

    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id))
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()

    const seenAuth: string[] = []
    const fetchImpl: GithubFetch = async (_url, init) => {
      seenAuth.push(init?.headers?.Authorization ?? '')
      return new Response(JSON.stringify({ login: 'octocat' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    const result = await runGithubVertical({
      importer,
      candidateId: 'GH_TOKEN',
      kernel,
      broker,
      provider,
      workspaceId: 'workspace_a',
      consumerId: 'agent-github',
      fetchImpl,
    })

    expect(result.credentialRefId).toMatch(/^cred_/)
    expect(result.connection.integrationId).toBe('github')
    expect(result.login).toBe('octocat')
    expect(seenAuth[0]).toBe('Bearer super-secret')
    expect(JSON.stringify(result)).not.toContain('super-secret')
    expect(result).not.toHaveProperty('value')

    const stillActive = await broker.acquireLease({
      credentialRef: result.credentialRefId,
      consumer: { kind: 'agent', id: 'agent-github', workspaceId: 'workspace_a' },
      purpose: 'github.user',
      action: 'github.api',
      resources: ['github:user'],
      audience: 'local-broker',
      ttl: 5_000,
    })
    await revokeConnectionAndRevalidate({
      kernel,
      broker,
      provider,
      workspaceId: 'workspace_a',
      connectionId: result.connection.id,
      reason: 'operator',
    })
    await expect(broker.perform(stillActive.id, () => 'x')).rejects.toMatchObject({
      code: 'lease_revoked',
    })
    await kernel.close()
  })
})
