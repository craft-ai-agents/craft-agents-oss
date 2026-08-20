import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IdentityStore,
  createDefaultProfile,
  resetIdentityStoreCache,
  getIdentityStore,
} from './store.ts';

describe('IdentityStore', () => {
  let dir: string;

  beforeEach(() => {
    resetIdentityStoreCache();
    dir = mkdtempSync(join(tmpdir(), 'craft-identity-'));
  });

  afterEach(() => {
    resetIdentityStoreCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates default local profile on first load', () => {
    const store = new IdentityStore({ configDir: dir });
    const state = store.getState();
    expect(state.profile.id).toBe('local');
    expect(state.profile.mode).toBe('local');
    expect(state.profile.displayName.length).toBeGreaterThan(0);
    expect(state.connections).toEqual([]);
    expect(state.entitlements).toEqual([]);
    expect(existsSync(join(dir, 'identity.json'))).toBe(true);
  });

  it('createDefaultProfile matches store default shape', () => {
    const profile = createDefaultProfile();
    expect(profile).toEqual({
      id: 'local',
      displayName: profile.displayName,
      mode: 'local',
    });
  });

  it('persists profile updates across reload', () => {
    const store = new IdentityStore({ configDir: dir });
    store.updateProfile({ displayName: 'AGI', mode: 'local', avatar: 'data:image/png;base64,xx' });
    const reloaded = new IdentityStore({ configDir: dir });
    expect(reloaded.getProfile()).toEqual({
      id: 'local',
      displayName: 'AGI',
      mode: 'local',
      avatar: 'data:image/png;base64,xx',
    });
  });

  it('connect upserts a connection without writing secrets', () => {
    const store = new IdentityStore({ configDir: dir });
    const conn = store.connect({
      provider: 'siyuan-cloud',
      workspaceId: 'ws-1',
      accountLabel: 'user@example.com',
      credentialValue: 'secret-token-should-not-land-in-json',
      connectionId: 'svc-siyuan-cloud',
    });
    expect(conn.id).toBe('svc-siyuan-cloud');
    expect(conn.status).toBe('connected');
    expect(conn.credentialRef).toBe('svc-siyuan-cloud');
    expect(conn.accountLabel).toBe('user@example.com');

    const raw = readFileSync(join(dir, 'identity.json'), 'utf8');
    expect(raw).not.toContain('secret-token-should-not-land-in-json');
    expect(raw).toContain('svc-siyuan-cloud');
    expect(raw).toContain('user@example.com');

    // Default trial entitlement for siyuan-cloud
    const ents = store.listEntitlements();
    expect(ents.some((e) => e.provider === 'siyuan-cloud' && e.product === 'cloud-sync')).toBe(true);
  });

  it('disconnect only one connection and clears its credentialRef', () => {
    const store = new IdentityStore({ configDir: dir });
    store.connect({
      provider: 'siyuan-cloud',
      workspaceId: 'ws-1',
      credentialValue: 'tok-a',
      connectionId: 'svc-a',
      accountLabel: 'a@x.com',
    });
    store.connect({
      provider: 'github',
      workspaceId: 'ws-1',
      credentialValue: 'tok-b',
      connectionId: 'svc-b',
      accountLabel: 'b',
    });

    const prior = store.disconnect('svc-a');
    expect(prior?.id).toBe('svc-a');
    expect(prior?.credentialRef).toBe('svc-a');

    const a = store.getConnection('svc-a');
    const b = store.getConnection('svc-b');
    expect(a?.status).toBe('disconnected');
    expect(a?.credentialRef).toBeUndefined();
    expect(b?.status).toBe('connected');
    expect(b?.credentialRef).toBe('svc-b');
  });

  it('refuses disconnect of read-only reflections', () => {
    const store = new IdentityStore({ configDir: dir });
    store.connect({
      provider: 'github',
      workspaceId: 'ws-1',
      connectionId: 'svc-gh',
      credentialValue: 't',
    });
    // Manually inject a read-only row via saveOwnedConnections + replace
    store.replaceDerivedConnections(store.listConnections(), [
      {
        id: 'llm-openai-default',
        workspaceId: 'ws-1',
        provider: 'openai',
        status: 'connected',
        readOnly: true,
        accountLabel: 'OpenAI (AI Settings)',
      },
    ]);
    expect(store.disconnect('llm-openai-default')).toBeUndefined();
    expect(store.getConnection('llm-openai-default')?.status).toBe('connected');
  });

  it('getIdentityStore caches per configDir', () => {
    const a = getIdentityStore(dir);
    const b = getIdentityStore(dir);
    expect(a).toBe(b);
    a.updateProfile({ displayName: 'Cached' });
    expect(b.getProfile().displayName).toBe('Cached');
  });

  it('filters connections by workspaceId', () => {
    const store = new IdentityStore({ configDir: dir });
    store.connect({ provider: 'github', workspaceId: 'ws-1', connectionId: 'c1' });
    store.connect({ provider: 'slack', workspaceId: 'ws-2', connectionId: 'c2' });
    expect(store.listConnections('ws-1').map((c) => c.id)).toEqual(['c1']);
    expect(store.listConnections('ws-2').map((c) => c.id)).toEqual(['c2']);
  });

  it('clear wipes connections and entitlements and resets profile', () => {
    const store = new IdentityStore({ configDir: dir });
    store.updateProfile({ displayName: 'KeepMeMaybe' });
    store.connect({
      provider: 'siyuan-cloud',
      workspaceId: 'ws-1',
      connectionId: 'svc-siyuan-cloud',
      credentialValue: 'tok',
    });
    expect(store.listConnections()).toHaveLength(1);
    expect(store.listEntitlements().length).toBeGreaterThan(0);

    const cleared = store.clear();
    expect(cleared.connections).toEqual([]);
    expect(cleared.entitlements).toEqual([]);
    expect(cleared.profile.id).toBe('local');
    expect(cleared.profile.mode).toBe('local');
    expect(cleared.profile.displayName).not.toBe('KeepMeMaybe');

    const reloaded = new IdentityStore({ configDir: dir });
    expect(reloaded.listConnections()).toEqual([]);
    expect(reloaded.listEntitlements()).toEqual([]);
  });
});
