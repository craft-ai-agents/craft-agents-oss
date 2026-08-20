import type { CredentialRef, CredentialRefId } from '@craft-agent/core/platform';
import { selectDeliveryMechanism, type DeliveryMechanism } from './delivery.ts';
import { MemoryAccessGrantStore, type AccessGrantStore } from './grant-store.ts';
import type { ProviderMaterialization, SecretProvider } from './types.ts';

export type ConsumerIdentity = {
  kind: 'agent' | 'workflow' | 'tool' | 'mcp' | 'plugin' | 'remote-client' | 'human';
  id: string;
  workspaceId: string;
};

export interface AccessGrant {
  readonly id: string;
  readonly workspaceId: string;
  readonly consumerId: string;
  readonly credentialRefId: CredentialRefId;
  readonly actions: readonly string[];
  readonly resources: readonly string[];
  readonly status: 'active' | 'revoked';
  readonly supportedMechanisms?: readonly DeliveryMechanism[];
  readonly allowEnvLegacy?: boolean;
}

export interface AcquireLeaseInput {
  readonly credentialRef: CredentialRefId;
  readonly consumer: ConsumerIdentity;
  readonly purpose: string;
  readonly action: string;
  readonly resources: readonly string[];
  readonly audience?: string;
  readonly ttl: number;
  readonly requestedMechanism?: DeliveryMechanism;
  readonly allowEnvLegacy?: boolean;
}

export interface CredentialLease {
  readonly id: string;
  readonly credentialRefId: CredentialRefId;
  readonly consumer: ConsumerIdentity;
  readonly purpose: string;
  readonly action: string;
  readonly resources: readonly string[];
  readonly audience?: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly delivery: { readonly mechanism: DeliveryMechanism };
  readonly status: 'active' | 'used' | 'revoked' | 'expired' | 'denied';
}

export interface CredentialBrokerOptions {
  readonly grants?: AccessGrantStore;
}

export interface BrokerAuditEvent {
  readonly credentialRefId?: CredentialRefId;
  readonly consumer: string;
  readonly action: string;
  readonly decision: 'allow' | 'deny';
  readonly code?: string;
  readonly fingerprint?: string;
}

export class BrokerDenial extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const MAX_TTL_MS = 60_000;

export class InProcessCredentialBroker {
  private readonly grants: AccessGrantStore;
  private readonly leases = new Map<string, CredentialLease>();
  private readonly audit: BrokerAuditEvent[] = [];
  private sequence = 0;

  constructor(
    private readonly provider: SecretProvider,
    private readonly resolveRef: (id: CredentialRefId) => CredentialRef | undefined,
    private readonly now: () => number = Date.now,
    options: CredentialBrokerOptions = {},
  ) {
    this.grants = options.grants ?? new MemoryAccessGrantStore();
  }

  grant(input: Omit<AccessGrant, 'id' | 'status'>): AccessGrant {
    const grant: AccessGrant = { ...input, id: `grant_${++this.sequence}`, status: 'active' };
    void this.grants.put(grant);
    return grant;
  }

  revokeGrant(grantId: string): void {
    void this.grants.revoke(grantId);
  }

  listAudit(): readonly BrokerAuditEvent[] {
    return [...this.audit];
  }

  async listGrants(): Promise<readonly AccessGrant[]> {
    return this.grants.list();
  }

  async acquireLease(input: AcquireLeaseInput): Promise<CredentialLease> {
    const deny = (code: string): never => {
      this.audit.push({
        credentialRefId: input.credentialRef,
        consumer: input.consumer.id,
        action: input.action,
        decision: 'deny',
        code,
      });
      throw new BrokerDenial(code);
    };

    if (!Number.isFinite(input.ttl) || input.ttl <= 0 || input.ttl > MAX_TTL_MS) deny('ttl_denied');
    if (input.audience && input.audience !== 'local-broker') deny('audience_denied');
    const ref = this.resolveRef(input.credentialRef);
    if (!ref) deny('unknown_ref');
    const resolved = ref!;

    const known = [...await this.grants.list()];
    const grant = known.find((item) => (
      item.status === 'active'
      && item.credentialRefId === input.credentialRef
      && item.consumerId === input.consumer.id
      && item.workspaceId === input.consumer.workspaceId
      && item.actions.includes(input.action)
      && input.resources.every((resource) => item.resources.includes(resource))
    ));
    if (!grant) {
      const anyGrant = known.some((item) => item.credentialRefId === input.credentialRef && item.status === 'active');
      deny(anyGrant ? (known.some((item) => item.consumerId === input.consumer.id) ? 'resource_denied' : 'consumer_denied') : 'grant_missing');
    }
    const allowedGrant = grant!;

    const delivery = selectDeliveryMechanism({
      requestedMechanism: input.requestedMechanism,
      allowEnvLegacy: input.allowEnvLegacy,
      supportedMechanisms: allowedGrant.supportedMechanisms,
      grantAllowsEnvLegacy: allowedGrant.allowEnvLegacy,
    });
    if (!delivery.ok) deny(delivery.code);
    const mechanism = delivery.ok ? delivery.mechanism : 'broker-perform';

    let fingerprint: string | undefined;
    try {
      const meta = await this.provider.inspect(resolved);
      if (meta.status !== 'active') deny('provider_unavailable');
      fingerprint = meta.fingerprint;
      await this.provider.resolveForLease({ credentialRef: resolved });
    } catch (error) {
      if (error instanceof BrokerDenial) throw error;
      deny('provider_unavailable');
    }

    const issuedAt = this.now();
    const lease: CredentialLease = {
      id: `lease_${++this.sequence}`,
      credentialRefId: input.credentialRef,
      consumer: input.consumer,
      purpose: input.purpose,
      action: input.action,
      resources: input.resources,
      ...(input.audience ? { audience: input.audience } : {}),
      issuedAt,
      expiresAt: issuedAt + input.ttl,
      delivery: { mechanism },
      status: 'active',
    };
    this.leases.set(lease.id, lease);
    this.audit.push({
      credentialRefId: input.credentialRef,
      consumer: input.consumer.id,
      action: input.action,
      decision: 'allow',
      fingerprint,
    });
    return lease;
  }

  async revokeLease(leaseId: string, _reason: string): Promise<void> {
    const current = this.leases.get(leaseId);
    if (!current) throw new BrokerDenial('unknown_lease');
    this.leases.set(leaseId, { ...current, status: 'revoked' });
  }

  async revokeLeasesForRef(credentialRefId: CredentialRefId, _reason: string): Promise<readonly string[]> {
    const revoked: string[] = [];
    for (const [id, lease] of this.leases) {
      if (lease.credentialRefId !== credentialRefId || lease.status !== 'active') continue;
      this.leases.set(id, { ...lease, status: 'revoked' });
      revoked.push(id);
    }
    return revoked;
  }

  async revalidateConsumer(consumer: ConsumerIdentity): Promise<{ status: 'ok' | 'denied' | 'repair_required' }> {
    const granted = (await this.grants.listForConsumer(consumer)).filter((grant) => grant.status === 'active');
    for (const grant of granted) {
      const ref = this.resolveRef(grant.credentialRefId);
      if (!ref) return { status: 'repair_required' };
      const meta = await this.provider.inspect(ref);
      if (meta.status !== 'active') return { status: 'repair_required' };
    }
    const active = [...this.leases.values()].some((lease) => (
      lease.consumer.id === consumer.id
      && lease.consumer.workspaceId === consumer.workspaceId
      && lease.status === 'active'
      && lease.expiresAt > this.now()
    ));
    return { status: active ? 'ok' : 'denied' };
  }

  async perform<T>(leaseId: string, operation: (materialization: ProviderMaterialization) => Promise<T> | T): Promise<T> {
    const lease = this.leases.get(leaseId);
    if (!lease) throw new BrokerDenial('unknown_lease');
    if (lease.status === 'revoked') throw new BrokerDenial('lease_revoked');
    if (lease.status === 'used') throw new BrokerDenial('lease_used');
    if (lease.status !== 'active' || lease.expiresAt <= this.now()) {
      this.leases.set(leaseId, { ...lease, status: 'expired' });
      throw new BrokerDenial('lease_expired');
    }
    const ref = this.resolveRef(lease.credentialRefId);
    if (!ref) throw new BrokerDenial('unknown_ref');
    const materialization = await this.provider.resolveForLease({ credentialRef: ref });
    this.leases.set(leaseId, { ...lease, status: 'used' });
    try {
      return await operation(materialization);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'operation_failed';
      throw new BrokerDenial(message.includes('super-secret') || message.includes('value') ? 'operation_failed' : message);
    }
  }
}
