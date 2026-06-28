import { afterAll, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

const sandboxHome = mkdtempSync(join(tmpdir(), 'secure-storage-home-'));

mock.module('os', () => ({
  ...os,
  homedir: () => sandboxHome,
}));

const { SecureStorageBackend } = await import(`./secure-storage.ts?secure-storage-test=${process.pid}-${Date.now()}`);

afterAll(() => {
  rmSync(sandboxHome, { recursive: true, force: true });
});

function writeUnreadableSafeStorageStore(): { credentialsFile: string; original: Buffer } {
  const credentialsDir = join(sandboxHome, '.craft-agent');
  const credentialsFile = join(credentialsDir, 'credentials.enc');
  const keyFile = join(credentialsDir, 'credentials.key');
  mkdirSync(credentialsDir, { recursive: true });

  const header = Buffer.alloc(64);
  Buffer.from('CRAFT01\0').copy(header, 0);
  randomBytes(32).copy(header, 12);
  const original = Buffer.concat([
    header,
    randomBytes(12),
    randomBytes(16),
    Buffer.from('not-decryptable'),
  ]);

  writeFileSync(credentialsFile, original, { mode: 0o600 });
  writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  return { credentialsFile, original };
}

describe('SecureStorageBackend', () => {
  test('refuses to overwrite an existing store that cannot be unlocked', async () => {
    const { credentialsFile, original } = writeUnreadableSafeStorageStore();
    const backend = new SecureStorageBackend();

    await expect(backend.get({ type: 'user_secret', name: 'EXISTING_SECRET' })).resolves.toBeNull();
    await expect(backend.set(
      { type: 'user_secret', name: 'NEW_SECRET' },
      { value: 'new-secret-value', source: 'user' }
    )).rejects.toThrow('cannot be unlocked');
    expect(readFileSync(credentialsFile)).toEqual(original);
  });
});
