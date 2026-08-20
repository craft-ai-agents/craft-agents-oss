import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialRefRegistry } from '@craft-agent/core/platform';
import type { CredentialBackend } from '../../backends/types.ts';
import type { CredentialId, StoredCredential } from '../../types.ts';
import { credentialIdToAccount } from '../../types.ts';
import { LocalFileSecretProvider } from '../local-file-provider.ts';
import { BrokerDenial, InProcessCredentialBroker, type AccessGrant } from '../broker.ts';
import { JsonAccessGrantStore } from '../grant-store.ts';

class MemoryBackend implements CredentialBackend {
  readonly name = 'memory';
  readonly priority = 1;
  readonly store = new Map<string, StoredCredential>();
  async isAvailable(): Promise<boolean> { return true; }
  async get(id: CredentialId): Promise<StoredCredential | null> {
    return this.store.get(credentialIdToAccount(id)) ?? null;
  }
  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    this.store.set(credentialIdToAccount(id), credential);
  }
  async delete(id: CredentialId): Promise<boolean> {
    return this.store.delete(credentialIdToAccount(id));
  }
  async list(): Promise<CredentialId[]> { return []; }
}

async function seed() {
  const registry = new CredentialRefRegistry();
  const provider = new LocalFileSecretProvider(new MemoryBackend(), registry);
  const written = await provider.write({
    kind: 'bearer_token',
    locator: { type: 'local', key: 'github/default' },
    payload: { value: 'super-secret' },
  });
  const consumer = { kind: 'agent' as const, id: 'agent-a', workspaceId: 'ws' };
  return { registry, provider, ref: written.ref, consumer };
}

function leaseInput(refId: AccessGrant['credentialRefId'], consumer: { kind: 'agent'; id: string; workspaceId: string }) {
  return {
    credentialRef: refId,
    consumer,
    purpose: 'list issues',
    action: 'github.request',
    resources: ['repo:demo'],
    audience: 'local-broker',
    ttl: 1000,
  };
}

describe('CF-4.2 grant store, repair revalidation, delivery', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('persists grants as metadata-only JSON and reloads them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf4-grants-'));
    dirs.push(dir);
    const path = join(dir, 'grants.json');
    const { provider, registry, ref, consumer } = await seed();
    const store = new JsonAccessGrantStore(path);
    const writer = new InProcessCredentialBroker(provider, (id) => registry.get(id), Date.now, { grants: store });
    writer.grant({
      workspaceId: 'ws',
      consumerId: 'agent-a',
      credentialRefId: ref.id,
      actions: ['github.request'],
      resources: ['repo:demo'],
    });
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain('super-secret');
    expect(raw).not.toMatch(/"payload"|"value"|"secret"/);

    const reader = new InProcessCredentialBroker(
      provider,
      (id) => registry.get(id),
      Date.now,
      { grants: new JsonAccessGrantStore(path) },
    );
    const lease = await reader.acquireLease(leaseInput(ref.id, consumer));
    expect(lease.status).toBe('active');
    expect(JSON.stringify(lease)).not.toContain('super-secret');
  });

  it('refuses a grant file that contains a secret field', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf4-grants-bad-'));
    dirs.push(dir);
    const path = join(dir, 'grants.json');
    writeFileSync(path, JSON.stringify({
      version: 1,
      grants: [{
        id: 'grant_1',
        workspaceId: 'ws',
        consumerId: 'agent-a',
        credentialRefId: 'cred_00000000-0000-4000-8000-000000000000',
        actions: ['github.request'],
        resources: ['repo:demo'],
        status: 'active',
        value: 'super-secret',
      }],
    }));
    const store = new JsonAccessGrantStore(path);
    await expect(store.list()).rejects.toThrow(/secret|payload|value/i);
  });

  it('revalidateConsumer requires repair when the grant remains but inspect is missing', async () => {
    const { provider, registry, ref, consumer } = await seed();
    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id));
    broker.grant({
      workspaceId: 'ws',
      consumerId: 'agent-a',
      credentialRefId: ref.id,
      actions: ['github.request'],
      resources: ['repo:demo'],
    });
    await provider.revoke({ credentialRef: ref });
    expect((await broker.revalidateConsumer(consumer)).status).toBe('repair_required');
  });

  it('revokes a grant so the next lease is denied', async () => {
    const { provider, registry, ref, consumer } = await seed();
    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id));
    const granted = broker.grant({
      workspaceId: 'ws',
      consumerId: 'agent-a',
      credentialRefId: ref.id,
      actions: ['github.request'],
      resources: ['repo:demo'],
    });
    broker.revokeGrant(granted.id);
    await expect(broker.acquireLease(leaseInput(ref.id, consumer))).rejects.toMatchObject({
      code: 'grant_missing',
    });
  });

  it('denies env-legacy unless the consumer declares it', async () => {
    const { provider, registry, ref, consumer } = await seed();
    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id));
    broker.grant({
      workspaceId: 'ws',
      consumerId: 'agent-a',
      credentialRefId: ref.id,
      actions: ['github.request'],
      resources: ['repo:demo'],
      supportedMechanisms: ['env-legacy', 'broker-perform'],
    });
    await expect(broker.acquireLease({
      ...leaseInput(ref.id, consumer),
      requestedMechanism: 'env-legacy',
    })).rejects.toMatchObject({ code: 'unsupported_delivery' });
    const lease = await broker.acquireLease({
      ...leaseInput(ref.id, consumer),
      requestedMechanism: 'env-legacy',
      allowEnvLegacy: true,
    });
    expect(lease.delivery.mechanism).toBe('env-legacy');
    expect(JSON.stringify(lease)).not.toContain('super-secret');
  });

  it('denies a mechanism the grant does not support', async () => {
    const { provider, registry, ref, consumer } = await seed();
    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id));
    broker.grant({
      workspaceId: 'ws',
      consumerId: 'agent-a',
      credentialRefId: ref.id,
      actions: ['github.request'],
      resources: ['repo:demo'],
      supportedMechanisms: ['broker-perform'],
    });
    await expect(broker.acquireLease({
      ...leaseInput(ref.id, consumer),
      requestedMechanism: 'ssh-agent',
    })).rejects.toBeInstanceOf(BrokerDenial);
    await expect(broker.acquireLease({
      ...leaseInput(ref.id, consumer),
      requestedMechanism: 'ssh-agent',
    })).rejects.toMatchObject({ code: 'unsupported_delivery' });
  });

  it('selects the least-exposing supported delivery mechanism', async () => {
    const { provider, registry, ref, consumer } = await seed();
    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id));
    broker.grant({
      workspaceId: 'ws',
      consumerId: 'agent-a',
      credentialRefId: ref.id,
      actions: ['github.request'],
      resources: ['repo:demo'],
      supportedMechanisms: ['broker-perform', 'trusted-http-header'],
    });
    const lease = await broker.acquireLease(leaseInput(ref.id, consumer));
    expect(lease.delivery.mechanism).toBe('trusted-http-header');
  });
});
