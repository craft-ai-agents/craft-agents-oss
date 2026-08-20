import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { encodeCredentialEnvelope } from '../envelope.ts';
import { SecureStorageBackend } from '../backends/secure-storage.ts';
import type { CredentialId } from '../types.ts';

const temporaryDirectories: string[] = [];

function createBackend(): { backend: SecureStorageBackend; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), 'craft-credential-migration-'));
  temporaryDirectories.push(directory);
  return { backend: new SecureStorageBackend(directory), directory };
}

function id(name: string): CredentialId {
  return { type: 'llm_api_key', connectionSlug: name };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('SecureStorageBackend controlled migrations', () => {
  it('snapshots, atomically replaces, and restores exact encrypted bytes', async () => {
    const { backend, directory } = createBackend();
    const credentialId = id('primary');
    await backend.set(credentialId, { value: 'legacy-value' });
    const credentialsFile = join(directory, 'credentials.enc');
    const before = readFileSync(credentialsFile);
    const snapshot = await backend.createMigrationSnapshot();

    await backend.applyMigration(snapshot, [{
      id: credentialId,
      credential: { value: encodeCredentialEnvelope({ kind: 'api_key', payload: { value: 'legacy-value' } }) },
    }]);
    expect(readFileSync(credentialsFile).equals(before)).toBeFalse();

    await backend.rollbackMigration(snapshot);
    expect(readFileSync(credentialsFile).equals(before)).toBeTrue();
    expect(await backend.get(credentialId)).toEqual({ value: 'legacy-value' });
  });

  it('rejects a stale source without overwriting it', async () => {
    const { backend } = createBackend();
    const credentialId = id('primary');
    await backend.set(credentialId, { value: 'first-value' });
    const snapshot = await backend.createMigrationSnapshot();
    await backend.set(credentialId, { value: 'second-value' });

    await expect(backend.applyMigration(snapshot, [{ id: credentialId, credential: { value: 'replacement' } }])).rejects.toThrow('source changed');
    expect(await backend.get(credentialId)).toEqual({ value: 'second-value' });
  });

  it('refuses rollback after a subsequent credential write', async () => {
    const { backend } = createBackend();
    const credentialId = id('primary');
    await backend.set(credentialId, { value: 'legacy-value' });
    const snapshot = await backend.createMigrationSnapshot();
    await backend.applyMigration(snapshot, [{
      id: credentialId,
      credential: { value: encodeCredentialEnvelope({ kind: 'api_key', payload: { value: 'legacy-value' } }) },
    }]);
    await backend.set(credentialId, { value: 'newer-value' });

    await expect(backend.rollbackMigration(snapshot)).rejects.toThrow('source changed');
    expect(await backend.get(credentialId)).toEqual({ value: 'newer-value' });
  });

  it('preserves a corrupt encrypted file in quarantine', async () => {
    const { backend, directory } = createBackend();
    await backend.set(id('primary'), { value: 'value' });
    writeFileSync(join(directory, 'credentials.enc'), Buffer.from('not-a-credential-store'));
    backend.clearCache();

    expect(await backend.list()).toEqual([]);
    expect(readdirSync(join(directory, 'credential-quarantine'))).toHaveLength(1);
  });

  it('stores only migration metadata in a private snapshot manifest', async () => {
    const { backend, directory } = createBackend();
    await backend.set(id('primary'), { value: 'never-in-manifest' });
    const snapshot = await backend.createMigrationSnapshot();
    const snapshotDir = join(directory, 'credential-migrations', snapshot.migrationId);
    const manifest = readFileSync(join(snapshotDir, 'manifest.json'), 'utf8');

    expect(manifest).not.toContain('never-in-manifest');
    expect(manifest).toContain(snapshot.sourceChecksum);
    expect(statSync(join(directory, 'credential-migrations')).mode & 0o777).toBe(0o700);
    expect(statSync(snapshotDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(snapshotDir, 'manifest.json')).mode & 0o777).toBe(0o600);
  });
});
