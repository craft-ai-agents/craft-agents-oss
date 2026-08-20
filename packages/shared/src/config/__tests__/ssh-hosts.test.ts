import { describe, expect, it, beforeAll, beforeEach, afterAll, spyOn } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { CredentialManager } from '../../credentials/manager.ts'
import { credentialIdToAccount, type CredentialId } from '../../credentials/types.ts'
import type { StoredCredential } from '../../credentials/types.ts'

// paths.ts reads CRAFT_CONFIG_DIR at first import, so set it before importing
// the store and use one config dir for the whole suite (cleared between tests).
const CONFIG_DIR = mkdtempSync(join(tmpdir(), 'craft-ssh-hosts-'))
process.env.CRAFT_CONFIG_DIR = CONFIG_DIR

// In-memory credential store so tests never touch ~/.craft-agent/credentials.enc.
const credentialStore = new Map<string, StoredCredential>()
const spies = [
  spyOn(CredentialManager.prototype, 'get').mockImplementation(async (id: CredentialId) => {
    return credentialStore.get(credentialIdToAccount(id)) ?? null
  }),
  spyOn(CredentialManager.prototype, 'set').mockImplementation(
    async (id: CredentialId, credential: StoredCredential) => {
      credentialStore.set(credentialIdToAccount(id), credential)
    },
  ),
  spyOn(CredentialManager.prototype, 'delete').mockImplementation(async (id: CredentialId) => {
    return credentialStore.delete(credentialIdToAccount(id))
  }),
  spyOn(CredentialManager.prototype, 'deleteSync').mockImplementation((id: CredentialId) => {
    return credentialStore.delete(credentialIdToAccount(id))
  }),
]

let store: typeof import('../ssh-hosts.ts')

beforeAll(async () => {
  store = await import('../ssh-hosts.ts')
})

afterAll(() => {
  for (const spy of spies) spy.mockRestore()
})

beforeEach(() => {
  rmSync(store.getSshHostsPath(), { force: true })
  credentialStore.clear()
})

describe('ssh-hosts store', () => {
  it('returns [] when no file exists', () => {
    expect(store.loadSshHosts()).toEqual([])
  })

  it('adds a host with slugified id and defaults', () => {
    const host = store.addSshHost({ label: 'My Box', host: '10.0.0.1', user: 'root' })
    expect(host.id).toBe('my-box')
    expect(host.port).toBe(22)
    expect(host.remotePort).toBe(9100)
    expect(store.loadSshHosts()).toHaveLength(1)
  })

  it('ensures unique ids on collision', () => {
    const a = store.addSshHost({ label: 'Box', host: 'h', user: 'u' })
    const b = store.addSshHost({ label: 'Box', host: 'h2', user: 'u' })
    expect(a.id).toBe('box')
    expect(b.id).toBe('box-2')
  })

  it('updates an existing host', () => {
    const host = store.addSshHost({ label: 'Box', host: 'h', user: 'u' })
    const updated = store.updateSshHost(host.id, { user: 'deploy', remotePort: 9200 })
    expect(updated?.user).toBe('deploy')
    expect(updated?.remotePort).toBe(9200)
    expect(store.getSshHost(host.id)?.user).toBe('deploy')
  })

  it('returns undefined updating a missing host', () => {
    expect(store.updateSshHost('nope', { user: 'x' })).toBeUndefined()
  })

  it('deletes a host', () => {
    const host = store.addSshHost({ label: 'Box', host: 'h', user: 'u' })
    expect(store.deleteSshHost(host.id)).toBe(true)
    expect(store.loadSshHosts()).toEqual([])
    expect(store.deleteSshHost(host.id)).toBe(false)
  })

  it('persists to disk', () => {
    store.addSshHost({ label: 'Persisted', host: 'h', user: 'u' })
    expect(store.loadSshHosts()[0]!.label).toBe('Persisted')
  })
})

describe('managed server tokens', () => {
  it('stores and loads a token via the credential store (never the file)', async () => {
    const host = store.addSshHost({ label: 'Box', host: 'h', user: 'u' })
    await store.storeManagedToken(host.id, 'secret-token')
    expect(await store.loadManagedToken(host.id)).toBe('secret-token')
    expect(readFileSync(store.getSshHostsPath(), 'utf-8')).not.toContain('secret-token')
  })

  it('returns undefined when no token exists', async () => {
    expect(await store.loadManagedToken('nope')).toBeUndefined()
  })

  it('deletes a token', async () => {
    await store.storeManagedToken('box', 't')
    expect(await store.deleteManagedToken('box')).toBe(true)
    expect(await store.loadManagedToken('box')).toBeUndefined()
  })

  it('deleting a host deletes its token', async () => {
    const host = store.addSshHost({ label: 'Box', host: 'h', user: 'u' })
    await store.storeManagedToken(host.id, 't')
    expect(store.deleteSshHost(host.id)).toBe(true)
    expect(await store.loadManagedToken(host.id)).toBeUndefined()
  })

  it('migrates legacy plaintext managedToken out of the file on first read', async () => {
    // Legacy file written by an older build: token inline in ssh-hosts.json.
    writeFileSync(
      store.getSshHostsPath(),
      JSON.stringify({
        hosts: [
          { id: 'legacy', label: 'Legacy', host: 'h', port: 22, user: 'u', remotePort: 9100, managedToken: 'old-secret' },
          { id: 'other', label: 'Other', host: 'h2', port: 22, user: 'u', remotePort: 9100, managedToken: 'other-secret' },
        ],
      }),
    )

    expect(await store.loadManagedToken('legacy')).toBe('old-secret')

    // File is rewritten without any tokens; both tokens live in the credential store.
    const file = readFileSync(store.getSshHostsPath(), 'utf-8')
    expect(file).not.toContain('old-secret')
    expect(file).not.toContain('other-secret')
    expect(file).not.toContain('managedToken')
    expect(await store.loadManagedToken('other')).toBe('other-secret')
    expect(store.loadSshHosts()).toHaveLength(2)
  })

  it('loadSshHosts never exposes a legacy managedToken field', () => {
    writeFileSync(
      store.getSshHostsPath(),
      JSON.stringify({
        hosts: [{ id: 'legacy', label: 'L', host: 'h', port: 22, user: 'u', remotePort: 9100, managedToken: 's' }],
      }),
    )
    expect((store.loadSshHosts()[0] as unknown as Record<string, unknown>).managedToken).toBeUndefined()
  })

  it('rescues a legacy token into the credential store when the file is rewritten', async () => {
    writeFileSync(
      store.getSshHostsPath(),
      JSON.stringify({
        hosts: [{ id: 'legacy', label: 'L', host: 'h', port: 22, user: 'u', remotePort: 9100, managedToken: 'rescued' }],
      }),
    )
    // Any mutation strips the plaintext field but must not lose the secret.
    store.addSshHost({ label: 'New', host: 'h2', user: 'u' })
    // The rescue write is fire-and-forget; let the microtask queue flush.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readFileSync(store.getSshHostsPath(), 'utf-8')).not.toContain('rescued')
    expect(await store.loadManagedToken('legacy')).toBe('rescued')
  })
})
