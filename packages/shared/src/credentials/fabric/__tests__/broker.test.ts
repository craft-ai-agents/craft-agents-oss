import { describe, expect, it } from 'bun:test';
import { CredentialRefRegistry } from '@craft-agent/core/platform';
import type { CredentialBackend } from '../../backends/types.ts';
import type { CredentialId, StoredCredential } from '../../types.ts';
import { credentialIdToAccount } from '../../types.ts';
import { LocalFileSecretProvider } from '../local-file-provider.ts';
import { BrokerDenial, InProcessCredentialBroker } from '../broker.ts';

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

describe('InProcessCredentialBroker', () => {
  async function setup() {
    const registry = new CredentialRefRegistry();
    const provider = new LocalFileSecretProvider(new MemoryBackend(), registry);
    const written = await provider.write({
      kind: 'bearer_token',
      locator: { type: 'local', key: 'github/default' },
      payload: { value: 'super-secret' },
    });
    const broker = new InProcessCredentialBroker(provider, (id) => registry.get(id));
    const consumer = { kind: 'agent' as const, id: 'agent-a', workspaceId: 'ws' };
    broker.grant({
      workspaceId: 'ws',
      consumerId: 'agent-a',
      credentialRefId: written.ref.id,
      actions: ['github.request'],
      resources: ['repo:demo'],
    });
    return { broker, ref: written.ref, consumer };
  }

  it('issues a payload-free lease and performs once', async () => {
    const { broker, ref, consumer } = await setup();
    const lease = await broker.acquireLease({
      credentialRef: ref.id,
      consumer,
      purpose: 'list issues',
      action: 'github.request',
      resources: ['repo:demo'],
      audience: 'local-broker',
      ttl: 1000,
    });
    expect(lease.status).toBe('active');
    expect(lease.delivery.mechanism).toBe('broker-perform');
    expect(JSON.stringify(lease)).not.toContain('super-secret');
    expect('payload' in lease).toBe(false);

    const seen = await broker.perform(lease.id, (material) => material.payload.value);
    expect(seen).toBe('super-secret');
    await expect(broker.perform(lease.id, () => 'x')).rejects.toBeInstanceOf(BrokerDenial);
  });

  it('denies the wrong consumer, ttl, audience, and extra resource', async () => {
    const { broker, ref, consumer } = await setup();
    await expect(broker.acquireLease({
      credentialRef: ref.id,
      consumer: { ...consumer, id: 'agent-b' },
      purpose: 'x',
      action: 'github.request',
      resources: ['repo:demo'],
      ttl: 1000,
    })).rejects.toMatchObject({ code: 'consumer_denied' });
    await expect(broker.acquireLease({
      credentialRef: ref.id,
      consumer,
      purpose: 'x',
      action: 'github.request',
      resources: ['repo:demo'],
      ttl: 0,
    })).rejects.toMatchObject({ code: 'ttl_denied' });
    await expect(broker.acquireLease({
      credentialRef: ref.id,
      consumer,
      purpose: 'x',
      action: 'github.request',
      resources: ['repo:demo'],
      audience: 'remote',
      ttl: 1000,
    })).rejects.toMatchObject({ code: 'audience_denied' });
    await expect(broker.acquireLease({
      credentialRef: ref.id,
      consumer,
      purpose: 'x',
      action: 'github.request',
      resources: ['repo:demo', 'repo:other'],
      ttl: 1000,
    })).rejects.toMatchObject({ code: 'resource_denied' });
    expect(JSON.stringify(broker.listAudit())).not.toContain('super-secret');
    expect(broker.listAudit().every((event) => event.decision === 'deny')).toBe(true);
  });

  it('revokes an active lease and revalidates the consumer', async () => {
    const { broker, ref, consumer } = await setup();
    const lease = await broker.acquireLease({
      credentialRef: ref.id,
      consumer,
      purpose: 'x',
      action: 'github.request',
      resources: ['repo:demo'],
      ttl: 1000,
    });
    expect((await broker.revalidateConsumer(consumer)).status).toBe('ok');
    await broker.revokeLease(lease.id, 'test');
    await expect(broker.perform(lease.id, () => 'x')).rejects.toMatchObject({ code: 'lease_revoked' });
    expect((await broker.revalidateConsumer(consumer)).status).toBe('denied');
    const allow = broker.listAudit().find((event) => event.decision === 'allow');
    expect(allow?.credentialRefId).toBe(ref.id);
    expect(JSON.stringify(broker.listAudit())).not.toContain('super-secret');
  });
});
