import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type {
  CredentialBackend,
  CredentialMigrationBackend,
  CredentialMigrationRecord,
  CredentialMigrationSnapshot,
} from '../backends/types.ts';
import { SecureStorageBackend } from '../backends/secure-storage.ts';
import { encodeCredentialEnvelope } from '../envelope.ts';
import { CredentialManager } from '../manager.ts';
import {
  applyCredentialMigration,
  previewCredentialMigration,
  rollbackCredentialMigration,
} from '../migration.ts';
import { credentialIdToAccount, type CredentialId, type StoredCredential } from '../types.ts';

class MemoryMigrationBackend implements CredentialMigrationBackend {
  readonly name = 'memory-migration';
  readonly priority = 100;
  readonly values = new Map<string, StoredCredential>();
  readonly ids = new Map<string, CredentialId>();
  snapshotCalls = 0;
  applyCalls = 0;
  rollbackCalls = 0;
  private sequence = 0;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async get(id: CredentialId): Promise<StoredCredential | null> {
    return this.values.get(credentialIdToAccount(id)) ?? null;
  }

  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    const key = credentialIdToAccount(id);
    this.ids.set(key, { ...id });
    this.values.set(key, credential);
  }

  async delete(id: CredentialId): Promise<boolean> {
    return this.values.delete(credentialIdToAccount(id));
  }

  async list(): Promise<CredentialId[]> {
    return [...this.ids.values()].map((id) => ({ ...id }));
  }

  async createMigrationSnapshot(): Promise<CredentialMigrationSnapshot> {
    this.snapshotCalls += 1;
    this.sequence += 1;
    return {
      migrationId: `credential-migration-00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`,
      createdAt: this.sequence,
      sourceChecksum: `checksum-${this.sequence}`,
    };
  }

  async applyMigration(
    _snapshot: CredentialMigrationSnapshot,
    replacements: readonly CredentialMigrationRecord[],
  ): Promise<void> {
    this.applyCalls += 1;
    for (const replacement of replacements) {
      await this.set(replacement.id, replacement.credential);
    }
  }

  async rollbackMigration(_snapshot: CredentialMigrationSnapshot): Promise<void> {
    this.rollbackCalls += 1;
  }
}

function manager(backend: CredentialBackend): CredentialManager {
  return new CredentialManager({ backends: [backend] });
}

const legacyId: CredentialId = { type: 'llm_api_key', connectionSlug: 'primary' };
const currentId: CredentialId = { type: 'llm_api_key', connectionSlug: 'current' };
const malformedId: CredentialId = { type: 'llm_api_key', connectionSlug: 'repair' };

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('controlled credential migration', () => {
  it('previews without writing and never returns credential values', async () => {
    const backend = new MemoryMigrationBackend();
    await backend.set(legacyId, { value: 'legacy-value' });
    await backend.set(currentId, {
      value: encodeCredentialEnvelope({ kind: 'api_key', payload: { value: 'current-value' } }),
    });
    await backend.set(malformedId, { value: '{"format":"rox-credential-envelope"}' });

    const preview = await previewCredentialMigration(manager(backend));

    expect(preview).toMatchObject({ ready: 1, alreadyEnvelope: 1, skipped: 1 });
    expect(preview.entries.map((entry) => entry.status).sort()).toEqual([
      'already-envelope',
      'ready',
      'skipped',
    ]);
    expect(backend.snapshotCalls).toBe(0);
    expect(backend.applyCalls).toBe(0);
    expect(JSON.stringify(preview)).not.toContain('legacy-value');
    expect(JSON.stringify(preview)).not.toContain('current-value');
  });

  it('converts only valid legacy objects after making one snapshot', async () => {
    const backend = new MemoryMigrationBackend();
    await backend.set(legacyId, { value: 'legacy-value' });
    await backend.set(malformedId, { value: '{"format":"rox-credential-envelope"}' });

    const result = await applyCredentialMigration(manager(backend));

    expect(result).toMatchObject({ ready: 1, skipped: 1, applied: 1 });
    expect(result.snapshot).not.toBeNull();
    expect(backend.snapshotCalls).toBe(1);
    expect(backend.applyCalls).toBe(1);
    const converted = await backend.get(legacyId);
    expect(converted).not.toBeNull();
    expect(converted?.value).toContain('rox-credential-envelope');
    expect(await backend.get(malformedId)).toEqual({ value: '{"format":"rox-credential-envelope"}' });
  });

  it('does not snapshot or write when no valid legacy credential exists', async () => {
    const backend = new MemoryMigrationBackend();
    await backend.set(currentId, {
      value: encodeCredentialEnvelope({ kind: 'api_key', payload: { value: 'current-value' } }),
    });
    await backend.set(malformedId, { value: '{"format":"rox-credential-envelope"}' });

    const result = await applyCredentialMigration(manager(backend));

    expect(result).toMatchObject({ ready: 0, alreadyEnvelope: 1, skipped: 1, applied: 0, snapshot: null });
    expect(backend.snapshotCalls).toBe(0);
    expect(backend.applyCalls).toBe(0);
  });

  it('runs preview apply and rollback against encrypted storage', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'craft-controlled-migration-'));
    temporaryDirectories.push(directory);
    const backend = new SecureStorageBackend(directory);
    const credentialManager = manager(backend);
    await backend.set(legacyId, { value: 'legacy-value' });

    expect((await previewCredentialMigration(credentialManager)).ready).toBe(1);
    const applied = await applyCredentialMigration(credentialManager);
    if (!applied.snapshot) throw new Error('expected migration snapshot');
    expect((await backend.get(legacyId))?.value).toContain('rox-credential-envelope');

    await rollbackCredentialMigration(applied.snapshot, credentialManager);
    expect(await backend.get(legacyId)).toEqual({ value: 'legacy-value' });
  });

  it('fails closed for multiple active backends and delegates rollback', async () => {
    const first = new MemoryMigrationBackend();
    const second = new MemoryMigrationBackend();
    const ambiguous = new CredentialManager({ backends: [first, second] });
    await expect(previewCredentialMigration(ambiguous)).rejects.toThrow('unavailable');

    const snapshot = await first.createMigrationSnapshot();
    await rollbackCredentialMigration(snapshot, manager(first));
    expect(first.rollbackCalls).toBe(1);
  });
});
