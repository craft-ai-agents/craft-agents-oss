import { describe, expect, it } from 'bun:test';
import { CredentialManager } from '../manager.ts';
import type { CredentialBackend } from '../backends/types.ts';
import type { CredentialId, StoredCredential } from '../types.ts';
import { encodeCredentialEnvelope } from '../envelope.ts';
import { enableDebug } from '../../utils/debug.ts';

class MemoryBackend implements CredentialBackend {
  readonly name = 'memory';
  readonly priority = 100;
  readonly store = new Map<string, StoredCredential | string>();
  setCalls = 0;
  throwOnGet = false;
  errorMessage?: string;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async get(id: CredentialId): Promise<StoredCredential | null> {
    if (this.throwOnGet) throw new Error(this.errorMessage ?? 'backend-unavailable');
    const key = `${id.type}::${id.name ?? id.connectionSlug ?? 'x'}`;
    const value = this.store.get(key);
    if (value === undefined) return null;
    return value as StoredCredential;
  }

  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    this.setCalls += 1;
    this.store.set(`${id.type}::${id.name ?? id.connectionSlug ?? 'x'}`, credential);
  }

  async delete(): Promise<boolean> {
    return false;
  }

  async list(): Promise<CredentialId[]> {
    return [];
  }
}

const sourceBearer: CredentialId = { type: 'source_bearer', workspaceId: 'ws', sourceId: 'src', name: 'github' };
const sourceOauth: CredentialId = { type: 'source_oauth', workspaceId: 'ws', sourceId: 'src', name: 'github' };

describe('CredentialManager dual-read', () => {
  it('decodes an envelope stored in value and does not rewrite', async () => {
    const backend = new MemoryBackend();
    const encoded = encodeCredentialEnvelope({ kind: 'bearer_token', payload: { value: 'tok' } });
    backend.store.set('source_bearer::github', { value: encoded });
    const manager = new CredentialManager({ backends: [backend] });

    const got = await manager.get(sourceBearer);
    const inspected = await manager.inspect(sourceBearer);

    expect(got).toEqual({ value: 'tok' });
    expect(inspected?.encoding).toBe('envelope-v1');
    expect(inspected?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(backend.setCalls).toBe(0);
  });

  it('decodes a raw envelope backend value without writing', async () => {
    const backend = new MemoryBackend();
    backend.store.set(
      'source_bearer::github',
      encodeCredentialEnvelope({ kind: 'bearer_token', payload: { value: 'tok' } }),
    );
    const manager = new CredentialManager({ backends: [backend] });

    expect(await manager.get(sourceBearer)).toEqual({ value: 'tok' });
    expect((await manager.inspect(sourceBearer))?.encoding).toBe('envelope-v1');
    expect(backend.setCalls).toBe(0);
  });

  it('fails closed for a malformed raw envelope without writing', async () => {
    const backend = new MemoryBackend();
    backend.store.set('source_bearer::github', '{"format" : "rox-credential-envelope"');
    const manager = new CredentialManager({ backends: [backend] });

    expect(await manager.get(sourceBearer)).toBeNull();
    expect(await manager.inspect(sourceBearer)).toBeNull();
    expect(backend.setCalls).toBe(0);
  });

  it('wraps a legacy object without calling set', async () => {
    const backend = new MemoryBackend();
    backend.store.set('source_bearer::github', { value: 'legacy-token' });
    const manager = new CredentialManager({ backends: [backend] });

    const got = await manager.get(sourceBearer);
    const inspected = await manager.inspect(sourceBearer);

    expect(got).toEqual({ value: 'legacy-token' });
    expect(inspected?.encoding).toBe('legacy-object');
    expect(backend.setCalls).toBe(0);
  });

  it('returns null for a tampered envelope without leaking the secret', async () => {
    const backend = new MemoryBackend();
    const encoded = encodeCredentialEnvelope({ kind: 'bearer_token', payload: { value: 'super-secret' } });
    backend.store.set('source_bearer::github', { value: encoded.replace('super-secret', 'changed-secret') });
    const manager = new CredentialManager({ backends: [backend] });

    expect(await manager.get(sourceBearer)).toBeNull();
    expect(backend.setCalls).toBe(0);
  });

  it('fails closed for a whitespace-formatted tampered envelope', async () => {
    const backend = new MemoryBackend();
    backend.store.set('source_bearer::github', {
      value: '{"format" : "rox-credential-envelope","version":1,"codec":"stored-credential/v1","kind":"bearer_token","payload":{"value":"secret"},"fingerprint":"0000000000000000000000000000000000000000000000000000000000000000"}',
    });
    const manager = new CredentialManager({ backends: [backend] });

    expect(await manager.get(sourceBearer)).toBeNull();
    expect(await manager.inspect(sourceBearer)).toBeNull();
    expect(backend.setCalls).toBe(0);
  });

  it('fails closed for an escaped-key malformed envelope', async () => {
    const backend = new MemoryBackend();
    backend.store.set('source_bearer::github', {
      value: '  {"\\u0066ormat":"rox-credential-envelope","version":1',
    });
    const manager = new CredentialManager({ backends: [backend] });

    expect(await manager.get(sourceBearer)).toBeNull();
    expect(await manager.inspect(sourceBearer)).toBeNull();
    expect(backend.setCalls).toBe(0);
  });

  it('does not coerce a bare token string', async () => {
    const backend = new MemoryBackend();
    backend.store.set('source_bearer::github', 'legacy-token' as unknown as StoredCredential);
    const manager = new CredentialManager({ backends: [backend] });
    expect(await manager.get(sourceBearer)).toBeNull();
    expect(backend.setCalls).toBe(0);
  });

  it('returns null for corrupt envelope JSON and does not write', async () => {
    const backend = new MemoryBackend();
    backend.store.set('source_bearer::github', { value: '{"format":"rox-credential-envelope"' });
    const manager = new CredentialManager({ backends: [backend] });
    expect(await manager.get(sourceBearer)).toBeNull();
    expect(backend.setCalls).toBe(0);
  });

  it('keeps oauth refresh tokens when wrapping legacy oauth records', async () => {
    const backend = new MemoryBackend();
    backend.store.set('source_oauth::github', { value: 'access', refreshToken: 'refresh' });
    const manager = new CredentialManager({ backends: [backend] });
    expect(await manager.get(sourceOauth)).toEqual({ value: 'access', refreshToken: 'refresh' });
  });

  it('classifies one thousand legacy records without writing', async () => {
    const backend = new MemoryBackend();
    const ids: CredentialId[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const id: CredentialId = { type: 'source_bearer', workspaceId: 'ws', sourceId: 'src', name: `n${i}` };
      ids.push(id);
      backend.store.set(`source_bearer::n${i}`, { value: `tok-${i}` });
    }
    const manager = new CredentialManager({ backends: [backend] });
    await manager.get(ids[0]!);
    const started = performance.now();
    for (const id of ids) {
      expect(await manager.get(id)).toEqual({ value: `tok-${id.name?.slice(1)}` });
    }
    expect(performance.now() - started).toBeLessThan(100);
    expect(backend.setCalls).toBe(0);
  });

  it('does not log backend exception content', async () => {
    const backend = new MemoryBackend();
    backend.throwOnGet = true;
    backend.errorMessage = 'backend-secret-marker';
    const manager = new CredentialManager({ backends: [backend] });
    const messages: string[] = [];
    const stderr = process.stderr as unknown as { write: (chunk: string) => boolean };
    const originalWrite = stderr.write;

    enableDebug();
    try {
      stderr.write = (chunk) => {
        messages.push(chunk);
        return true;
      };
      expect(await manager.get(sourceBearer)).toBeNull();
    } finally {
      stderr.write = originalWrite;
    }
    expect(messages.join('')).not.toContain('backend-secret-marker');
    expect(backend.setCalls).toBe(0);
  });
});
