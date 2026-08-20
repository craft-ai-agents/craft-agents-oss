import { afterEach, describe, expect, it } from 'bun:test';
import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { SecureStorageBackend } from '../secure-storage.ts';

const MAGIC = Buffer.from('CRAFT01\0');
const MIN_SIZE = 64 + 12 + 16;

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('SecureStorageBackend recovery', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function isolatedBackend(): { backend: SecureStorageBackend; filePath: string; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'cf2-cred-'));
    dirs.push(dir);
    return { backend: new SecureStorageBackend(dir), filePath: join(dir, 'credentials.enc'), dir };
  }

  it('quarantines a bad-magic file and does not recreate it on get', async () => {
    const { backend, filePath, dir } = isolatedBackend();
    const original = Buffer.concat([Buffer.from('NOTCRAFT'), randomBytes(MIN_SIZE)]);
    writeFileSync(filePath, original, { mode: 0o600 });
    const before = digest(original);

    expect(await backend.get({ type: 'source_bearer', name: 'x', workspaceId: 'w', sourceId: 's' })).toBeNull();
    expect(existsSync(filePath)).toBe(false);
    const quarantined = readdirSync(join(dir, 'credential-quarantine'));
    expect(quarantined).toHaveLength(1);
    expect(digest(readFileSync(join(dir, 'credential-quarantine', quarantined[0]!)))).toBe(before);
  });

  it('quarantines an undersized file instead of deleting it', async () => {
    const { backend, filePath, dir } = isolatedBackend();
    const original = Buffer.from('tiny');
    writeFileSync(filePath, original);
    expect(await backend.get({ type: 'anthropic_api_key' })).toBeNull();
    expect(existsSync(filePath)).toBe(false);
    const quarantined = readdirSync(join(dir, 'credential-quarantine'));
    expect(quarantined).toHaveLength(1);
    expect(digest(readFileSync(join(dir, 'credential-quarantine', quarantined[0]!)))).toBe(digest(original));
  });

  it('does not rewrite a healthy store on get', async () => {
    const { backend, filePath } = isolatedBackend();
    const id = { type: 'source_bearer' as const, name: 'gh', workspaceId: 'w', sourceId: 's' };
    await backend.set(id, { value: 'tok' });
    const before = readFileSync(filePath);
    expect(await backend.get(id)).toEqual({ value: 'tok' });
    expect(await backend.get(id)).toEqual({ value: 'tok' });
    expect(Buffer.compare(before, readFileSync(filePath))).toBe(0);
  });

  it('allows first-run set when no store exists', async () => {
    const { backend } = isolatedBackend();
    const id = { type: 'source_apikey' as const, name: 'k', workspaceId: 'w', sourceId: 's' };
    await backend.set(id, { value: 'fresh' });
    expect(await backend.get(id)).toEqual({ value: 'fresh' });
  });

  it('reads a v1-hostname store', async () => {
    const { backend, filePath } = isolatedBackend();
    const salt = randomBytes(32);
    const iv = randomBytes(12);
    const legacyId = createHash('sha256')
      .update(hostname())
      .update(userInfo().username)
      .update(homedir())
      .update('craft-agent-v1')
      .digest();
    const key = pbkdf2Sync(legacyId, salt, 100000, 32, 'sha256');
    const plaintext = Buffer.from(JSON.stringify({
      version: 1,
      credentials: { 'source_bearer::w::s': { value: 'legacy-v1' } },
      metadata: { createdAt: 1, updatedAt: 1 },
    }));
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const header = Buffer.alloc(64);
    MAGIC.copy(header, 0);
    salt.copy(header, 12);
    writeFileSync(filePath, Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext]));

    const listed = await backend.list();
    expect(listed.some((id) => id.type === 'source_bearer')).toBe(true);
    expect(await backend.get({
      type: 'source_bearer',
      name: 's',
      workspaceId: 'w',
      sourceId: 's',
    })).toEqual({ value: 'legacy-v1' });
  });
});
