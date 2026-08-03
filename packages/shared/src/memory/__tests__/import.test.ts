import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openMemoryDatabase, bootstrapStorage } from '../database';
import { MemoryRepository } from '../repository';
import { ObsidianVaultSync } from '../obsidian-sync';
import type { AnyMemory } from '../types';

function nowIso(): string {
  return new Date().toISOString();
}

function makeProfile(id: string, key: string, title = `Profile ${key}`): AnyMemory {
  return {
    id,
    class: 'profile',
    scope: 'global',
    scopeId: undefined,
    title,
    content: `User preference for ${key}.`,
    confidence: 0.95,
    sensitivity: 'internal',
    source: { sessionId: undefined, messageId: undefined, importOrigin: 'obsidian' },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    supersededById: undefined,
    supersedesIds: [],
    tags: ['owner', 'preference'],
    archived: false,
    key,
    previousValues: [],
  } as AnyMemory;
}

function makeSemantic(id: string, category: 'reference' | 'environment' = 'reference'): AnyMemory {
  return {
    id,
    class: 'semantic',
    scope: 'global',
    scopeId: 'project-arch',
    title: `Semantic ${id}`,
    content: `Docker is installed locally for reproducible builds.`,
    confidence: 0.9,
    sensitivity: 'internal',
    source: { sessionId: undefined, messageId: undefined, importOrigin: 'obsidian' },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    supersededById: undefined,
    supersedesIds: [],
    tags: ['docker', 'env'],
    archived: false,
    category,
    explicit: true,
    canonicalQuestion: 'How do I run a CLI tool in a sandbox?',
  } as AnyMemory;
}

function makeEpisodic(id: string, sessionId: string): AnyMemory {
  return {
    id,
    class: 'episodic',
    scope: 'project',
    scopeId: 'project-arch',
    title: `Episodic ${id}`,
    content: `We discussed the migration milestones and decided to defer.`,
    confidence: 0.8,
    sensitivity: 'internal',
    source: { sessionId: 'sess-source', messageId: 'msg-1', importOrigin: 'obsidian' },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    supersededById: undefined,
    supersedesIds: [],
    tags: ['standup'],
    archived: false,
    sessionId,
    outcome: 'completed',
    decisions: ['defer migration to next sprint'],
    artifacts: [],
    tokenCost: 1234,
    durationSeconds: 600,
  } as AnyMemory;
}

function makeProcedural(id: string): AnyMemory {
  return {
    id,
    class: 'procedural',
    scope: 'global',
    scopeId: undefined,
    title: `Procedural ${id}`,
    content: `Step 1: read the config. Step 2: dry-run. Step 3: ship.`,
    confidence: 0.85,
    sensitivity: 'internal',
    source: { sessionId: undefined, messageId: undefined, importOrigin: 'obsidian' },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    supersededById: undefined,
    supersedesIds: [],
    tags: ['deploy'],
    archived: false,
    triggers: ['deploy staging', 'release v2'],
    steps: [],
    successCount: 7,
    pitfalls: ['forgetting the dry-run step'],
    dependencies: ['kubectl', 'kustomize'],
  } as AnyMemory;
}

describe('Memory import from Obsidian vault', () => {
  let tmp: string;
  let db: ReturnType<typeof openMemoryDatabase>;
  let repo: MemoryRepository;
  let vault: ObsidianVaultSync;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'obsidian-vault-'));
    db = openMemoryDatabase(undefined, { inMemory: true });
    bootstrapStorage(db);
    repo = MemoryRepository.createMemoryRepository(db);
    vault = ObsidianVaultSync.createSync(tmp);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('round-trips all four memory classes through the vault', () => {
    vault.syncAll([
      makeProfile('mem:p1', 'theme'),
      makeSemantic('mem:s1'),
      makeEpisodic('mem:e1', 'sess-ep1'),
      makeProcedural('mem:pr1'),
    ]);

    const { records, errors } = vault.readVault();
    expect(errors).toHaveLength(0);
    expect(records).toHaveLength(4);

    const stats = repo.importMemories(records, 'obsidian-vault-sync');
    expect(stats.imported).toBe(4);
    expect(stats.skipped).toBe(0);
    expect(stats.errors).toHaveLength(0);

    expect(repo.getMemory('mem:p1')).toBeDefined();
    expect(repo.getMemory('mem:s1')).toBeDefined();
    expect(repo.getMemory('mem:e1')).toBeDefined();
    expect(repo.getMemory('mem:pr1')).toBeDefined();
  });

  it('is idempotent: a second import against the same vault returns all-skipped', () => {
    vault.syncAll([makeProfile('mem:p1', 'name')]);
    const { records } = vault.readVault();

    const first = repo.importMemories(records, 'obsidian-vault-sync');
    expect(first.imported).toBe(1);
    expect(first.skipped).toBe(0);

    const second = repo.importMemories(records, 'obsidian-vault-sync');
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('audits each imported row with action=import, actor=obsidian-vault-sync, origin=obsidian', () => {
    vault.syncAll([makeProfile('mem:p1', 'name')]);
    const { records } = vault.readVault();
    repo.importMemories(records, 'obsidian-vault-sync');

    const rows = db
      .prepare('SELECT * FROM memory_audit WHERE memory_id = ?')
      .all('mem:p1') as Array<{
        action: string;
        actor: string | null;
        source_import_origin: string | null;
      }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('import');
    expect(rows[0].actor).toBe('obsidian-vault-sync');
    expect(rows[0].source_import_origin).toBe('obsidian');
  });

  it('imported rows are searchable via the FTS5 index', () => {
    vault.syncAll([makeSemantic('mem:s1')]); // content mentions "Docker"
    const { records } = vault.readVault();
    repo.importMemories(records, 'obsidian-vault-sync');

    const hits = repo.searchMemories({ query: 'docker' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].memory.id).toBe('mem:s1');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('round-trips class-specific fields (key, canonicalQuestion, sessionId, triggers)', () => {
    vault.syncAll([
      makeProfile('mem:p1', 'theme'),
      makeSemantic('mem:s1'),
      makeEpisodic('mem:e1', 'sess-arch-001'),
      makeProcedural('mem:pr1'),
    ]);
    const { records } = vault.readVault();
    repo.importMemories(records, 'obsidian-vault-sync');

    const profile = repo.getMemory('mem:p1') as any;
    expect(profile?.key).toBe('theme');

    const semantic = repo.getMemory('mem:s1') as any;
    expect(semantic?.canonicalQuestion).toBe('How do I run a CLI tool in a sandbox?');
    expect(semantic?.category).toBe('reference');

    const episodic = repo.getMemory('mem:e1') as any;
    expect(episodic?.sessionId).toBe('sess-arch-001');
    expect(episodic?.outcome).toBe('completed');

    const procedural = repo.getMemory('mem:pr1') as any;
    expect(procedural?.triggers).toEqual(['deploy staging', 'release v2']);
    expect(procedural?.successCount).toBe(7);
    expect(procedural?.pitfalls).toEqual(['forgetting the dry-run step']);
    expect(procedural?.dependencies).toEqual(['kubectl', 'kustomize']);
  });

  it('reports vault-read errors (malformed frontmatter) without aborting', () => {
    vault.syncAll([makeProfile('mem:p1', 'name')]);
    // Inject a file with no leading `---` — splitFrontmatter throws.
    writeFileSync(
      join(tmp, 'semantic', 'no-delimiter.md'),
      'no leading dashes here at all',
      'utf-8',
    );

    const { records, errors: readErrors } = vault.readVault();
    expect(readErrors.length).toBe(1);
    expect(readErrors[0].filePath).toMatch(/no-delimiter\.md$/);

    const stats = repo.importMemories(records, 'obsidian-vault-sync');
    expect(stats.imported).toBe(1); // the valid profile memo
    expect(stats.skipped).toBe(0);
    expect(stats.errors).toHaveLength(0);
  });

  it('reports parse errors per-row (missing class / missing required fields)', () => {
    vault.syncAll([makeProfile('mem:p1', 'name')]);
    // Inject valid frontmatter but missing the `class` field — parseVaultRecord
    // returns `{ error }`. Plus another with a bogus class.
    writeFileSync(
      join(tmp, 'semantic', 'no-class.md'),
      '---\nfoo: bar\n---\n\n# X\norphan content',
      'utf-8',
    );
    writeFileSync(
      join(tmp, 'episodic', 'unknown-class.md'),
      `---\nid: mem:x1\nclass: bogus\n---\n\n# X\norphan`,
      'utf-8',
    );

    const { records } = vault.readVault();
    const stats = repo.importMemories(records, 'obsidian-vault-sync');
    expect(stats.imported).toBe(1); // mem:p1 only
    expect(stats.skipped).toBe(0);
    expect(stats.errors.length).toBe(2);
    expect(stats.errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`missing 'class'`),
        expect.stringContaining(`unknown class 'bogus'`),
      ]),
    );
  });
});
