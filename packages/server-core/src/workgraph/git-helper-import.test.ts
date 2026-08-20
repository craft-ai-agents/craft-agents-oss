import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'bun:test'
import { CredentialRefRegistry } from '@craft-agent/core/platform'
import type { CredentialBackend } from '@craft-agent/shared/credentials'
import type { CredentialId, StoredCredential } from '@craft-agent/shared/credentials'
import { credentialIdToAccount, LocalFileSecretProvider } from '@craft-agent/shared/credentials'

import { createWorkGraphKernel } from './index'
import { commitGitHelperImport, previewGitHelperImport } from './git-helper-import.ts'

const SECRET = 'super-secret-git-password'
const GITCONFIG = `[credential "https://github.com"]
	helper = !gh auth git-credential
	username = git
[credential "https://gitlab.example.com"]
	helper = store
`

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

describe('CF-9.2 Git credential helper import', () => {
  it('previews helpers from a gitconfig path and never leaks the password', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-cf92-'))
    roots.push(root)
    const configPath = join(root, '.gitconfig')
    writeFileSync(configPath, GITCONFIG)
    const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry())
    const preview = await previewGitHelperImport({
      configPath,
      provider,
      fill: async ({ host }) => ({
        username: 'git',
        password: host === 'github.com' ? SECRET : 'other-secret',
      }),
    })
    expect(preview.some((row) => row.label.includes('github.com'))).toBe(true)
    expect(JSON.stringify(preview)).not.toContain(SECRET)
    expect(JSON.stringify(preview)).not.toContain('other-secret')
    expect(preview.every((row) => row.maskedSummary.includes('*'))).toBe(true)
  })

  nativeIt('commits a GitHub connection from a github.com helper without putting the password on the record', async () => {
    const root = mkdtempSync(join(tmpdir(), 'craft-cf92-commit-'))
    roots.push(root)
    const configPath = join(root, '.gitconfig')
    writeFileSync(configPath, GITCONFIG)
    const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry())
    const kernel = createWorkGraphKernel({
      configDir: root,
      platform: { platform: 'darwin', arch: 'arm64' },
    })
    await kernel.getHealth()
    const preview = await previewGitHelperImport({
      configPath,
      provider,
      fill: async () => ({ username: 'git', password: SECRET }),
    })
    const github = preview.find((row) => row.label.includes('github.com'))
    expect(github).toBeDefined()
    const connection = await commitGitHelperImport({
      configPath,
      candidateId: github!.candidateId,
      provider,
      kernel,
      workspaceId: 'workspace_a',
      requestedBy: 'owner',
      fill: async () => ({ username: 'git', password: SECRET }),
    })
    expect(connection.integrationId).toBe('github')
    expect(connection.credentialRefId).toMatch(/^cred_/)
    expect(JSON.stringify(connection)).not.toContain(SECRET)
    await kernel.close()
  })
})
