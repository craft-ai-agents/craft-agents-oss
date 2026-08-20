import { describe, expect, it, beforeEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'
import type { RemoteServerConfig, Workspace } from '@craft-agent/core/types'

/** SSH-backed workspaces record sshHostId durably (not the ephemeral port);
 * plain-ws workspaces round-trip unchanged (backward compat). */

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

const SPKI_SHA256 = Buffer.alloc(32, 7).toString('base64')

async function freshStorage() {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-ssh-persist-'))
  mkdirSync(configDir, { recursive: true })
  // Minimal root config so loadStoredConfig() has something to read/write.
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null }, null, 2),
    'utf-8',
  )
  process.env.CRAFT_CONFIG_DIR = configDir
  // Bust the module cache so CONFIG_DIR picks up the new env value.
  const mod = (await import(`${STORAGE_MODULE_PATH}?t=${Date.now()}-${Math.random()}`)) as typeof import('../storage.ts')
  mod.ensureConfigDir()
  mod.ensureConfigDefaults()
  return mod
}

describe('RemoteServerConfig SSH persistence', () => {
  beforeEach(() => {
    delete process.env.CRAFT_CONFIG_DIR
  })

  it('persists sshHostId on an SSH-backed workspace and survives reload', async () => {
    const storage = await freshStorage()
    const remoteServer: RemoteServerConfig = {
      url: 'ws://127.0.0.1:50123', // ephemeral — must NOT be the source of truth
      token: 'managed',
      remoteWorkspaceId: 'remote-ws-1',
      sshHostId: 'prod-box',
    }
    const ws = storage.addWorkspace({ name: 'Prod', rootPath: join(tmpdir(), 'prod'), remoteServer } as any)

    // Reload from disk (fresh module instance, same config dir).
    const reloaded = await import(`${STORAGE_MODULE_PATH}?t=${Date.now()}-${Math.random()}`)
    const found = (reloaded.getWorkspaces() as any[]).find((w) => w.id === ws.id)
    expect(found).toBeTruthy()
    expect(found.remoteServer.sshHostId).toBe('prod-box')
    expect(found.remoteServer.remoteWorkspaceId).toBe('remote-ws-1')
  })

  it('plain-ws workspace round-trips with no sshHostId (backward compat)', async () => {
    const storage = await freshStorage()
    const remoteServer: RemoteServerConfig = {
      url: 'wss://my-server:8443',
      token: 't',
      remoteWorkspaceId: 'rw',
    }
    const ws = storage.addWorkspace({ name: 'Plain', rootPath: join(tmpdir(), 'plain'), remoteServer } as any)
    const found = (storage.getWorkspaces() as any[]).find((w) => w.id === ws.id)
    expect(found.remoteServer.sshHostId).toBeUndefined()
    expect(found.remoteServer.url).toBe('wss://my-server:8443')
    expect(found.remoteServer.tlsTrust).toEqual({ mode: 'public-ca' })
  })

  it('updateWorkspaceRemoteServer preserves sshHostId when re-binding', async () => {
    const storage = await freshStorage()
    const ws = storage.addWorkspace({ name: 'X', rootPath: join(tmpdir(), 'x') } as any)
    storage.updateWorkspaceRemoteServer(ws.id, {
      url: 'ws://127.0.0.1:9',
      token: 'k',
      remoteWorkspaceId: 'r',
      sshHostId: 'host-42',
    })
    const found = (storage.getWorkspaces() as any[]).find((w) => w.id === ws.id)
    expect(found.remoteServer.sshHostId).toBe('host-42')
  })

  it('persists a canonical matching SPKI pin across save and reload', async () => {
    const storage = await freshStorage()
    const remoteServer: RemoteServerConfig = {
      url: 'wss://my-server:8443',
      token: 't',
      remoteWorkspaceId: 'rw',
      tlsTrust: {
        mode: 'spki-pin',
        origin: 'wss://my-server:8443',
        spkiSha256: SPKI_SHA256,
        enrolledAt: 1_725_000_000_000,
      },
    }
    const workspace = {
      name: 'Pinned',
      rootPath: join(tmpdir(), 'pinned'),
      remoteServer,
    } satisfies Omit<Workspace, 'id' | 'createdAt' | 'slug'>
    const ws = storage.addWorkspace(workspace)

    const reloaded = await import(`${STORAGE_MODULE_PATH}?t=${Date.now()}-${Math.random()}`)
    const found = reloaded
      .getWorkspaces()
      .find((workspace: Workspace) => workspace.id === ws.id)
    expect(found?.remoteServer?.tlsTrust).toEqual(remoteServer.tlsTrust)
  })

  it('preserves a stored pin when reconnect details omit tlsTrust', async () => {
    const storage = await freshStorage()
    const workspace = {
      name: 'Pinned',
      rootPath: join(tmpdir(), 'pinned-rebind'),
      remoteServer: {
        url: 'wss://my-server:8443',
        token: 'old-token',
        remoteWorkspaceId: 'old-remote-workspace',
        tlsTrust: {
          mode: 'spki-pin',
          origin: 'wss://my-server:8443',
          spkiSha256: SPKI_SHA256,
          enrolledAt: 1_725_000_000_000,
        },
      },
    } satisfies Omit<Workspace, 'id' | 'createdAt' | 'slug'>
    const ws = storage.addWorkspace(workspace)

    storage.updateWorkspaceRemoteServer(ws.id, {
      url: 'wss://my-server:8443',
      token: 'new-token',
      remoteWorkspaceId: 'new-remote-workspace',
    })

    const found = storage.getWorkspaces().find((workspace) => workspace.id === ws.id)
    expect(found?.remoteServer?.tlsTrust).toEqual({
      mode: 'spki-pin',
      origin: 'wss://my-server:8443',
      spkiSha256: SPKI_SHA256,
      enrolledAt: 1_725_000_000_000,
    })
  })

  it('rejects an invalid pin before it can be persisted', async () => {
    const storage = await freshStorage()
    const workspace = {
      name: 'Rejected pin',
      rootPath: join(tmpdir(), 'rejected-pin'),
      remoteServer: {
        url: 'wss://my-server:8443',
        token: 't',
        remoteWorkspaceId: 'rw',
        tlsTrust: {
          mode: 'spki-pin',
          origin: 'wss://other-server:8443',
          spkiSha256: SPKI_SHA256,
          enrolledAt: 1_725_000_000_000,
        },
      },
    } satisfies Omit<Workspace, 'id' | 'createdAt' | 'slug'>

    expect(() => storage.addWorkspace(workspace)).toThrow('origin must match')
    expect(
      storage.getWorkspaces().some((candidate) => candidate.name === 'Rejected pin'),
    ).toBeFalse()
  })
})
