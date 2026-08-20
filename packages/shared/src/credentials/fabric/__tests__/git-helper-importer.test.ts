import { describe, expect, it } from 'bun:test';
import { CredentialRefRegistry } from '@craft-agent/core/platform';
import type { CredentialBackend } from '../../backends/types.ts';
import type { CredentialId, StoredCredential } from '../../types.ts';
import { credentialIdToAccount } from '../../types.ts';
import type { CredentialImporter } from '../types.ts';
import { LocalFileSecretProvider } from '../local-file-provider.ts';
import {
  GitCredentialHelperImporter,
  type GitCredentialHelperFill,
} from '../git-helper-importer.ts';

const SECRET = 'super-secret-git-password';
const TOKEN = 'gho_super-secret-token';

const GITCONFIG = `[user]
	name = Test User
	email = test@example.com
[credential]
	helper = osxkeychain
[credential "https://github.com"]
	helper = !gh auth git-credential
	username = git
[credential "https://gitlab.example.com"]
	helper = store
`;

const GIT_CONFIG_LIST = [
  'user.name=Test User',
  'credential.helper=osxkeychain',
  'credential.https://github.com.helper=!gh auth git-credential',
  'credential.https://github.com.username=git',
].join('\n');

class MemoryBackend implements CredentialBackend {
  readonly name = 'memory';
  readonly priority = 1;
  readonly store = new Map<string, StoredCredential>();

  async isAvailable(): Promise<boolean> {
    return true;
  }
  async get(id: CredentialId): Promise<StoredCredential | null> {
    return this.store.get(credentialIdToAccount(id)) ?? null;
  }
  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    this.store.set(credentialIdToAccount(id), credential);
  }
  async delete(id: CredentialId): Promise<boolean> {
    return this.store.delete(credentialIdToAccount(id));
  }
  async list(): Promise<CredentialId[]> {
    return [...this.store.keys()].map((key) => {
      const [type, workspaceId, sourceId] = key.split('::');
      return { type: type as CredentialId['type'], workspaceId, sourceId };
    });
  }
}

function createImporter(
  configText: string,
  fill?: GitCredentialHelperFill,
  runner?: GitCredentialHelperFill,
): { importer: GitCredentialHelperImporter; provider: LocalFileSecretProvider } {
  const provider = new LocalFileSecretProvider(new MemoryBackend(), new CredentialRefRegistry());
  const importer = new GitCredentialHelperImporter({ configText, provider, fill, runner });
  return { importer, provider };
}

function leakHaystack(value: unknown): string {
  return JSON.stringify(value);
}

describe('CF-9.1 GitCredentialHelperImporter', () => {
  it('implements CredentialImporter', () => {
    const { importer } = createImporter(GITCONFIG);
    const typed: CredentialImporter = importer;
    expect(typed.id).toBe('git-credential-helper');
    expect(typed.sourceKind).toBe('git-config');
  });

  it('discovers helper and host metadata from injected gitconfig without secrets', async () => {
    const { importer } = createImporter(GITCONFIG);
    const candidates = await importer.discover();
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.every((c) => c.kind === 'basic_auth')).toBe(true);
    expect(candidates.every((c) => c.sourceId === 'git-credential-helper')).toBe(true);
    const haystack = leakHaystack(candidates);
    expect(haystack).toContain('github.com');
    expect(haystack).toContain('osxkeychain');
    expect(haystack).toContain('gitlab.example.com');
    expect(haystack.toLowerCase()).not.toContain('password=');
    expect(haystack).not.toContain(SECRET);
    expect(haystack).not.toContain(TOKEN);
    for (const candidate of candidates) {
      expect(candidate).not.toHaveProperty('password');
      expect(candidate).not.toHaveProperty('token');
    }
  });

  it('discovers the same metadata from git config --list text', async () => {
    const { importer } = createImporter(GIT_CONFIG_LIST);
    const candidates = await importer.discover();
    const haystack = leakHaystack(candidates);
    expect(haystack).toContain('github.com');
    expect(haystack).toContain('osxkeychain');
    expect(haystack).not.toContain(SECRET);
  });

  it('strips password userinfo from credential URLs in discover JSON', async () => {
    const config = `[credential "https://octocat:${SECRET}@github.com"]
	helper = osxkeychain
`;
    const { importer } = createImporter(config);
    const candidates = await importer.discover();
    expect(candidates.length).toBe(1);
    expect(leakHaystack(candidates)).not.toContain(SECRET);
    expect(candidates[0]?.locator).toContain('github.com');
    expect(candidates[0]?.locator).not.toContain(SECRET);
  });

  it('does not put helper-printed username/password onto candidates', async () => {
    let fillCalls = 0;
    const fill: GitCredentialHelperFill = async () => {
      fillCalls += 1;
      return { username: 'octocat', password: SECRET };
    };
    const { importer } = createImporter(GITCONFIG, fill);
    const candidates = await importer.discover();
    expect(fillCalls).toBe(0);
    expect(leakHaystack(candidates)).not.toContain(SECRET);
    expect(leakHaystack(candidates)).not.toContain('octocat');
    const github = candidates.find((c) => c.locator?.includes('github.com'));
    if (!github) throw new Error('expected github helper candidate');
    await importer.preview({ candidateId: github.id });
    expect(fillCalls).toBeGreaterThan(0);
    expect(leakHaystack(candidates)).not.toContain(SECRET);
    expect(leakHaystack(await importer.discover())).not.toContain(SECRET);
  });

  it('masks preview and never returns the raw helper secret', async () => {
    const fill: GitCredentialHelperFill = () => ({ username: 'octocat', password: SECRET });
    const { importer } = createImporter(GITCONFIG, fill);
    const candidates = await importer.discover();
    const github = candidates.find((c) => c.locator?.includes('github.com'));
    if (!github) throw new Error('expected github helper candidate');
    const preview = await importer.preview({ candidateId: github.id });
    expect(preview.candidateId).toBe(github.id);
    expect(preview.inferredKind).toBe('basic_auth');
    expect(preview.targetProviderId).toBe('local-file');
    expect(preview.proposedMode).toBe('copy');
    expect(preview.maskedSummary).not.toContain(SECRET);
    expect(preview.maskedSummary.endsWith('word') || preview.maskedSummary === '****').toBe(true);
    expect(leakHaystack(preview)).not.toContain(SECRET);
  });

  it('commits copy through LocalFileSecretProvider using the injected helper', async () => {
    const fill: GitCredentialHelperFill = (query) => {
      expect(query.helper).toContain('gh auth git-credential');
      expect(query.host).toBe('github.com');
      return { username: 'octocat', password: SECRET };
    };
    const { importer, provider } = createImporter(GITCONFIG, fill);
    const candidates = await importer.discover();
    const github = candidates.find((c) => c.locator?.includes('github.com'));
    if (!github) throw new Error('expected github helper candidate');
    const committed = await importer.commit({
      candidateId: github.id,
      targetProviderId: 'local-file',
      mode: 'copy',
      workspaceId: 'w',
      requestedBy: 'test',
    });
    expect(committed.credentialRefId.startsWith('cred_')).toBe(true);
    const material = await provider.resolveForLease({
      credentialRef: {
        id: committed.credentialRefId,
        kind: 'basic_auth',
        providerId: 'local-file',
        locator: { type: 'local', key: github.conflictKey },
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(material.payload.value).toContain(SECRET);
    expect(leakHaystack(material)).not.toContain(SECRET);
    await importer.rollback({ credentialRefId: committed.credentialRefId });
    const inspected = await provider.inspect({
      id: committed.credentialRefId,
      kind: 'basic_auth',
      providerId: 'local-file',
      locator: { type: 'local', key: github.conflictKey },
      createdAt: 0,
      updatedAt: 0,
    });
    expect(inspected.status).toBe('missing');
  });

  it('uses an injected runner instead of spawning git', async () => {
    let runnerCalls = 0;
    const runner: GitCredentialHelperFill = async () => {
      runnerCalls += 1;
      return { username: 'octocat', password: TOKEN };
    };
    const { importer, provider } = createImporter(GITCONFIG, undefined, runner);
    const candidates = await importer.discover();
    expect(runnerCalls).toBe(0);
    const github = candidates.find((c) => c.locator?.includes('github.com'));
    if (!github) throw new Error('expected github helper candidate');
    const committed = await importer.commit({
      candidateId: github.id,
      targetProviderId: 'local-file',
      mode: 'copy',
      workspaceId: 'w',
      requestedBy: 'test',
    });
    expect(runnerCalls).toBe(1);
    const material = await provider.resolveForLease({
      credentialRef: {
        id: committed.credentialRefId,
        kind: 'basic_auth',
        providerId: 'local-file',
        locator: { type: 'local', key: github.conflictKey },
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(material.payload.value).toContain(TOKEN);
    expect(leakHaystack(await importer.discover())).not.toContain(TOKEN);
  });

  it('rejects unsupported modes and unknown candidates, and yields nothing for empty config', async () => {
    const { importer } = createImporter('');
    expect(await importer.discover()).toEqual([]);
    const populated = createImporter(GITCONFIG).importer;
    const [candidate] = await populated.discover();
    if (!candidate) throw new Error('expected candidate');
    expect(
      (
        await populated.validate({
          candidateId: candidate.id,
          targetProviderId: 'local-file',
          mode: 'mirror',
          workspaceId: 'w',
          requestedBy: 'test',
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await populated.validate({
          candidateId: 'missing',
          targetProviderId: 'local-file',
          mode: 'copy',
          workspaceId: 'w',
          requestedBy: 'test',
        })
      ).ok,
    ).toBe(false);
    await expect(populated.preview({ candidateId: 'missing' })).rejects.toThrow();
    await populated.rollback();
  });
});
