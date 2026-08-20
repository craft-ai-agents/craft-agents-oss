import { describe, expect, it } from 'bun:test';
import { attachCredentialRef } from './attach-credential-ref.ts';
import { CredentialRefRegistry, isCredentialRefId } from './credential-types.ts';
import type { ServiceConnection } from './types.ts';

describe('attachCredentialRef', () => {
  it('writes a cred uuid and does not accept a raw value', () => {
    const registry = new CredentialRefRegistry();
    const connection: ServiceConnection = {
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    };

    const attached = attachCredentialRef(connection, registry, {
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 1,
    });

    expect(attached.credentialRef).toMatch(/^cred_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(attached.id).toBe('svc-github');
    expect(isCredentialRefId(attached.credentialRef)).toBe(true);
    if (!isCredentialRefId(attached.credentialRef)) throw new Error('expected cred ref');
    expect(registry.get(attached.credentialRef)?.id).toBe(attached.credentialRef);
  });

  it('rejects raw fields and a fake registry before mutation', () => {
    const registry = new CredentialRefRegistry();
    const connection = {
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
      credentialValue: 'raw-secret',
    };
    const input = {
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      value: 'raw-secret',
    };
    expect(() => attachCredentialRef(connection as never, registry, input as never)).toThrow();
    expect(registry.list()).toEqual([]);
    expect(() => attachCredentialRef({
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    }, { register: () => ({ id: 'cred_123e4567-e89b-12d3-a456-426614174000' }) } as never, {
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
    })).toThrow();
    const forged = Object.create(CredentialRefRegistry.prototype);
    forged.register = () => ({ id: 'cred_123e4567-e89b-12d3-a456-426614174000' });
    expect(() => attachCredentialRef({
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    }, forged, {
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
    })).toThrow();
  });

  it('leaves the input connection unchanged when registry validation fails', () => {
    const registry = new CredentialRefRegistry();
    const connection: ServiceConnection = {
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    };
    expect(() => attachCredentialRef(connection, registry, {
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: '' },
    })).toThrow();
    expect(connection).toEqual({
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    });
    expect(registry.list()).toEqual([]);
  });

  it('rejects non-enumerable declared fields before registration', () => {
    const registry = new CredentialRefRegistry();
    const connection = {
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    };
    Object.defineProperty(connection, 'status', { enumerable: false });
    expect(() => attachCredentialRef(connection as never, registry, {
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
    })).toThrow();

    const input = {
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
    };
    Object.defineProperty(input, 'kind', { enumerable: false });
    expect(() => attachCredentialRef({
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    }, registry, input as never)).toThrow();

    const locator = { type: 'local', key: 'github/default' };
    Object.defineProperty(locator, 'key', { enumerable: false });
    expect(() => attachCredentialRef({
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    }, registry, {
      kind: 'bearer_token',
      providerId: 'local',
      locator: locator as never,
    })).toThrow();
    expect(registry.list()).toEqual([]);
  });

  it('rejects prototype-derived locators before registry mutation', () => {
    const registry = new CredentialRefRegistry();
    const locator = Object.create({ type: 'local', key: 'github/default' });
    expect(() => attachCredentialRef({
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    }, registry, {
      kind: 'bearer_token',
      providerId: 'local',
      locator,
    } as never)).toThrow();
    expect(registry.list()).toEqual([]);
  });
});
