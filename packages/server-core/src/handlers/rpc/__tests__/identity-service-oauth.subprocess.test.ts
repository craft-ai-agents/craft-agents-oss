/**
 * Integration: identity.connect/disconnect with real service_oauth credentials.
 *
 * CRAFT_CONFIG_DIR is frozen at module load in paths.ts / secure-storage, so
 * this runs in a spawned subprocess with an isolated config dir (same pattern
 * as cloud-runs.test.ts).
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..', '..')

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

function runScript(configDir: string, script: string): RunResult {
  const result = Bun.spawnSync([process.execPath, '--eval', script], {
    env: {
      ...process.env,
      CRAFT_CONFIG_DIR: configDir,
      CRAFT_TEST_ROOT: REPO_ROOT,
    },
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: REPO_ROOT,
  })
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

const SETUP = `
const { RPC_CHANNELS } = await import('@craft-agent/shared/protocol');
const { registerIdentityHandlers } = await import(process.env.CRAFT_TEST_ROOT + '/packages/server-core/src/handlers/rpc/identity.ts');
const { registerAuthHandlers } = await import(process.env.CRAFT_TEST_ROOT + '/packages/server-core/src/handlers/rpc/auth.ts');
const { getCredentialManager } = await import('@craft-agent/shared/credentials');
const { getIdentityStore, resetIdentityStoreCache } = await import('@craft-agent/core/platform/identity/store');
const { readFileSync, existsSync } = await import('node:fs');
const { join } = await import('node:path');

const handlers = new Map();
const fakeServer = {
  handle: (ch, fn) => handlers.set(ch, fn),
  push: () => {},
};
const fakeDeps = {
  platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
};
registerIdentityHandlers(fakeServer, fakeDeps);
registerAuthHandlers(fakeServer, fakeDeps);
const invoke = async (channel, ...args) => {
  const handler = handlers.get(channel);
  if (!handler) throw new Error('no handler for ' + channel);
  return handler({}, ...args);
};
`

describe('identity service_oauth connect/disconnect (subprocess sandbox)', () => {
  test('connect stores service_oauth credential; disconnect removes it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-identity-oauth-'))
    try {
      const r = runScript(
        dir,
        SETUP +
          `
        const token = 'test-siyuan-cloud-token-xyz';
        const ws = 'ws-oauth-1';
        const connectionId = 'svc-siyuan-cloud';

        // Reject empty token before any store write
        let rejected = false;
        try {
          await invoke(RPC_CHANNELS.identity.CONNECT, {
            provider: 'siyuan-cloud',
            workspaceId: ws,
            connectionId,
          });
        } catch (e) {
          rejected = String(e?.message || e).includes('credentialValue is required');
        }
        if (!rejected) throw new Error('expected empty credential reject');

        const connected = await invoke(RPC_CHANNELS.identity.CONNECT, {
          provider: 'siyuan-cloud',
          workspaceId: ws,
          accountLabel: 'cloud@example.com',
          credentialValue: token,
          connectionId,
        });
        const conn = connected.connections.find((c) => c.id === connectionId);
        if (!conn) throw new Error('connection missing after connect');
        if (conn.status !== 'connected') throw new Error('status=' + conn.status);
        if (conn.credentialRef !== connectionId) throw new Error('credentialRef=' + conn.credentialRef);

        const manager = getCredentialManager();
        const cred = await manager.get({
          type: 'service_oauth',
          workspaceId: ws,
          name: connectionId,
        });
        if (!cred?.value) throw new Error('service_oauth credential not stored');
        if (cred.value !== token) throw new Error('token mismatch: ' + cred.value);

        // identity.json must not embed the secret
        const identityPath = join(process.env.CRAFT_CONFIG_DIR, 'identity.json');
        if (!existsSync(identityPath)) throw new Error('identity.json missing');
        const raw = readFileSync(identityPath, 'utf8');
        if (raw.includes(token)) throw new Error('token leaked into identity.json');

        const afterDisc = await invoke(RPC_CHANNELS.identity.DISCONNECT, { connectionId });
        const disc = afterDisc.connections.find((c) => c.id === connectionId);
        if (!disc) throw new Error('disconnected row missing');
        if (disc.status !== 'disconnected') throw new Error('disc status=' + disc.status);
        if (disc.credentialRef) throw new Error('credentialRef still set after disconnect');

        const gone = await manager.get({
          type: 'service_oauth',
          workspaceId: ws,
          name: connectionId,
        });
        if (gone?.value) throw new Error('service_oauth credential still present after disconnect');

        console.log('ok-connect-disconnect');
      `,
      )
      expect(r.stderr).toBe('')
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('ok-connect-disconnect')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('auth.LOGOUT clears identity connections via IdentityStore.clear', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-identity-logout-'))
    try {
      const r = runScript(
        dir,
        SETUP +
          `
        const token = 'logout-token-abc';
        const ws = 'ws-logout';
        const connectionId = 'svc-siyuan-cloud';

        await invoke(RPC_CHANNELS.identity.CONNECT, {
          provider: 'siyuan-cloud',
          workspaceId: ws,
          credentialValue: token,
          connectionId,
        });

        resetIdentityStoreCache();
        let pre = getIdentityStore(process.env.CRAFT_CONFIG_DIR).getState();
        if (pre.connections.length === 0) throw new Error('pre-logout connections empty');
        if (pre.entitlements.length === 0) throw new Error('pre-logout entitlements empty');

        await invoke(RPC_CHANNELS.auth.LOGOUT);

        resetIdentityStoreCache();
        const post = getIdentityStore(process.env.CRAFT_CONFIG_DIR).getState();
        if (post.connections.length !== 0) {
          throw new Error('connections not cleared: ' + JSON.stringify(post.connections));
        }
        if (post.entitlements.length !== 0) {
          throw new Error('entitlements not cleared: ' + JSON.stringify(post.entitlements));
        }
        if (post.profile.id !== 'local') throw new Error('profile id not local');

        const manager = getCredentialManager();
        const gone = await manager.get({
          type: 'service_oauth',
          workspaceId: ws,
          name: connectionId,
        });
        if (gone?.value) throw new Error('credential survived logout');

        console.log('ok-logout-clears-identity');
      `,
      )
      expect(r.stderr).toBe('')
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('ok-logout-clears-identity')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
