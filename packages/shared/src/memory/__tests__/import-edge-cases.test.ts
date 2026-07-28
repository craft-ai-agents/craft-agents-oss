import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openMemoryDatabase, bootstrapStorage } from '../database';
import { MemoryRepository } from '../repository';
import { ObsidianVaultSync, memoryToMarkdown } from '../obsidian-sync';
import type { AnyMemory } from '../types';

function nowIso(): string {
  return new Date().toISOString();
}

function makeEpisodic(id: string, sessionId: string, outcome: string | null = 'completed'): AnyMemory {
  return {
    id,
    class: 'episodic',
    scope: 'project',
    scopeId: 'project-arch',
    title: `Episodic ${id}`,
    content: `Episode transcript for ${id}.`,
    confidence: 0.8,
    sensitivity: 'internal',
    source: { sessionId: undefined, messageId: undefined, importOrigin: 'obsidian' },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    supersededById: undefined,
    supersedesIds: [],
    tags: ['standup'],
    archived: false,
    sessionId,
    outcome,
    decisions: [],
    artifacts: [],
    tokenCost: 1234,
    durationSeconds: 600,
  } as AnyMemory;
}

function makeProfile(id: string, title: string): AnyMemory {
  return {
    id,
    class: 'profile',
    scope: 'global',
    scopeId: undefined,
    title,
    content: `User preference for ${id}.`,
    confidence: 0.95,
    sensitivity: 'internal',
    source: { sessionId: undefined, messageId: undefined, importOrigin: 'obsidian' },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    supersededById: undefined,
    supersedesIds: [],
    tags: [],
    archived: false,
    key: id,
    previousValues: [],
  } as AnyMemory;
}

describe('Memory import edge cases', () => {
  let tmp: string;
  let db: ReturnType<typeof openMemoryDatabase>;
  let repo: MemoryRepository;
  let vault: ObsidianVaultSync;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'obsidian-edge-'));
    db = openMemoryDatabase(undefined, { inMemory: true });
    bootstrapStorage(db);
    repo = MemoryRepository.createMemoryRepository(db);
    vault = ObsidianVaultSync.createSync(tmp);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('episodic with empty outcome (in-progress) round-trips through the vault', () => {
    // An in-progress session has outcome=null. memoryToMarkdown emits an
    // empty value for null/undefined fields; parseVaultRecord must treat
    // an empty value as legitimate, not as a missing key.
    vault.syncMemory(makeEpisodic('mem:e1', 'sess-live', null));
    const { records, errors } = vault.readVault();
    expect(errors).toHaveLength(0);
    expect(records).toHaveLength(1);

    const stats = repo.importMemories(records, 'obsidian-vault-sync');
    expect(stats.errors).toHaveLength(0);
    expect(stats.imported).toBe(1);

    const e = repo.getMemory('mem:e1') as any;
    expect(e?.sessionId).toBe('sess-live');
    // Empty string — not undefined, not a parse error.
    expect(e?.outcome).toBe('');
  });

  it('hand-edited YAML inline tag list `[a, b]` parses to a clean array', () => {
    // Simulate a vault file that a user wrote by hand using YAML inline
    // list syntax. parseTagsField must strip the surrounding brackets
    // before comma-splitting; otherwise the brackets leak into every
    // downstream consumer (FTS tags column, panel chips, etc.).
    writeFileSync(
      join(tmp, 'semantic', 'manual-tags.md'),
      `---\nid: mem:manual\nclass: semantic\nscope: global\ntags: [docker, container]\ncategory: reference\ncanonicalQuestion: How do I run docker?\n---\n\n# Manual tags test\n\ncontent body`,
      'utf-8',
    );

    const { records } = vault.readVault();
    const parsed = repo.parseVaultRecord(records[0]);
    if ('error' in parsed) throw new Error('expected success but got: ' + parsed.error.message);
    expect(parsed.memory.tags).toEqual(['docker', 'container']);
  });

  it('long-title memories with different ids do NOT collide on disk', () => {
    // After dropping the substring(0, 80) cap, two memories with very
    // long titles but different ids must produce distinct file paths,
    // so writing one doesn't overwrite the other.
    const longTitle = 'A'.repeat(120); // 120-char title
    vault.syncMemory(makeProfile('mem:long-1', longTitle));
    vault.syncMemory(makeProfile('mem:long-2', longTitle));

    const files = vault.readVault();
    expect(files.records).toHaveLength(2);
    // Two different files on disk because the ids differ.
    const paths = files.records.map((r) => r.filePath);
    expect(new Set(paths).size).toBe(2);

    const stats = repo.importMemories(files.records, 'obsidian-vault-sync');
    expect(stats.imported).toBe(2);
    expect(stats.skipped).toBe(0);

    // Both rows present, not overwritten by each other.
    expect(repo.getMemory('mem:long-1')).toBeDefined();
    expect(repo.getMemory('mem:long-2')).toBeDefined();
  });

  it('a title with embedded newlines is sanitized to a single markdown H1 line', () => {
    // memoryToMarkdown replaces newlines so parseVaultRecord's title
    // regex (`^#\s*(.+)$/m`) doesn't truncate the second line.
    const md = memoryToMarkdown({
      id: 'mem:nl', class: 'profile', scope: 'global', scopeId: undefined,
      title: 'Line one\nLine two\nLine three',
      content: 'body', confidence: 0.9, sensitivity: 'internal',
      source: {}, createdAt: nowIso(), updatedAt: nowIso(),
      supersededById: undefined, supersedesIds: [], tags: [],
      archived: false, key: 'nl', previousValues: [],
    } as AnyMemory);

    // Exactly one `# ` line, not multiple.
    const h1Matches = md.match(/^# .+$/gm) ?? [];
    expect(h1Matches).toHaveLength(1);
    expect(h1Matches[0]).toBe('# Line one Line two Line three');
  });
});
