import { describe, it, expect } from 'bun:test'
import {
  resolveRemoteConnection,
  type ConnectionResolverDeps,
  type SshConnectionStatus,
} from '../ssh-tunnel/connection-resolver.ts'
import { isSshBacked } from '../../shared/ssh.ts'
import type { RemoteServerConfig } from '@craft-agent/core/types'
import type { SshHostConfig } from '@craft-agent/shared/config'

const HOST: SshHostConfig = {
  id: 'my-host',
  label: 'My Host',
  host: 'example.com',
  port: 22,
  user: 'deploy',
  remotePort: 9200,
}

function baseDeps(overrides: Partial<ConnectionResolverDeps> = {}): ConnectionResolverDeps {
  return {
    getSshHost: (id) => (id === HOST.id ? HOST : undefined),
    connectTunnel: async () => ({ url: 'ws://127.0.0.1:50001', localPort: 50001 }),
    bootstrapServer: async () => ({ token: 'boot-token' }),
    loadManagedToken: async (id) => (id === HOST.id ? 'stored-token' : undefined),
    probe: async () => true,
    ...overrides,
  }
}

describe('isSshBacked', () => {
  it('is false for plain-ws configs', () => {
    expect(isSshBacked({ url: 'ws://x', token: 't', remoteWorkspaceId: 'w' })).toBe(false)
    expect(isSshBacked(null)).toBe(false)
    expect(isSshBacked({ url: 'ws://x', token: 't', remoteWorkspaceId: 'w', sshHostId: '' })).toBe(false)
  })
  it('is true when sshHostId is set', () => {
    expect(isSshBacked({ url: 'ws://x', token: 't', remoteWorkspaceId: 'w', sshHostId: 'h' })).toBe(true)
  })
})

describe('resolveRemoteConnection — plain ws', () => {
  it('passes url/token through unchanged and does not touch ssh machinery', async () => {
    let tunnelCalled = false
    const remote: RemoteServerConfig = { url: 'ws://server:8080', token: 'plain', remoteWorkspaceId: 'rw1' }
    const resolved = await resolveRemoteConnection(
      remote,
      baseDeps({ connectTunnel: async () => { tunnelCalled = true; return {} } }),
    )
    expect(resolved).toEqual({ url: 'ws://server:8080', token: 'plain', remoteWorkspaceId: 'rw1' })
    expect(tunnelCalled).toBe(false)
  })
})

describe('resolveRemoteConnection — ssh backed', () => {
  const remote: RemoteServerConfig = {
    // Deliberately stale url from a previous session's dead ephemeral port.
    url: 'ws://127.0.0.1:64037',
    token: 'stale',
    remoteWorkspaceId: 'rw9',
    sshHostId: 'my-host',
  }

  it('refreshes the stale url to the fresh forwarded port and uses the stored token', async () => {
    const resolved = await resolveRemoteConnection(remote, baseDeps())
    expect(resolved.url).toBe('ws://127.0.0.1:50001')
    expect(resolved.url).not.toBe(remote.url) // stale port refreshed
    expect(resolved.token).toBe('stored-token')
    expect(resolved.remoteWorkspaceId).toBe('rw9')
  })

  it('bootstraps when no server answers the fresh port, then returns bootstrap token', async () => {
    const phases: string[] = []
    const resolved = await resolveRemoteConnection(
      remote,
      baseDeps({ probe: async () => false }),
      (s: SshConnectionStatus) => phases.push(s.phase),
    )
    expect(resolved.token).toBe('boot-token')
    expect(phases).toContain('tunnel-connecting')
    expect(phases).toContain('bootstrapping')
    expect(phases[phases.length - 1]).toBe('ready')
  })

  it('bootstraps when the port answers but no managed token is stored', async () => {
    let bootstrapped = false
    const resolved = await resolveRemoteConnection(
      remote,
      baseDeps({
        loadManagedToken: async () => undefined,
        bootstrapServer: async () => { bootstrapped = true; return { token: 'boot-token' } },
      }),
    )
    expect(bootstrapped).toBe(true)
    expect(resolved.token).toBe('boot-token')
  })

  it('recovers a dead remote server: tunnel kept without probe → bootstrap → re-dial', async () => {
    // Server process died: the tunnel must be requested WITHOUT a live-server
    // probe (ssh is fine, port silent), then bootstrap, then re-dial fresh.
    const calls: Array<{ requireProbe?: boolean }> = []
    let bootstrapped = false
    const resolved = await resolveRemoteConnection(
      remote,
      baseDeps({
        connectTunnel: async (_h, opts) => {
          calls.push(opts ?? {})
          return { url: 'ws://127.0.0.1:50001', localPort: 50001 }
        },
        probe: async () => false, // nothing answers the forwarded port
        bootstrapServer: async () => { bootstrapped = true; return { token: 'boot-token' } },
      }),
    )
    expect(calls[0]).toEqual({ requireProbe: false }) // step 1 must not require a live server
    expect(bootstrapped).toBe(true)
    expect(calls.length).toBe(2) // re-ensured the tunnel after bootstrap
    expect(resolved.url).toBe('ws://127.0.0.1:50001')
    expect(resolved.token).toBe('boot-token')
  })

  it('emits a terminal error phase when the bootstrap itself fails', async () => {
    const phases: string[] = []
    await expect(
      resolveRemoteConnection(
        remote,
        baseDeps({
          probe: async () => false,
          bootstrapServer: async () => { throw new Error('artifact build failed') },
        }),
        (s) => phases.push(s.phase),
      ),
    ).rejects.toThrow(/artifact build failed/)
    expect(phases[phases.length - 1]).toBe('error')
  })

  it('throws a clear error when the host is no longer configured', async () => {
    await expect(
      resolveRemoteConnection(remote, baseDeps({ getSshHost: () => undefined })),
    ).rejects.toThrow(/no longer configured/)
  })

  it('surfaces a tunnel failure as an SSH error status, not a raw ws error', async () => {
    const phases: string[] = []
    await expect(
      resolveRemoteConnection(
        remote,
        baseDeps({ connectTunnel: async () => { throw new Error('ssh: connect refused') } }),
        (s) => phases.push(s.phase),
      ),
    ).rejects.toThrow(/SSH tunnel to My Host failed/)
    expect(phases).toContain('error')
  })
})
