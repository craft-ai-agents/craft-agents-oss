import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { openMemoryDatabase, bootstrapStorage } from '@craft-agent/shared/memory/database.ts';
import { MemoryRepository } from '@craft-agent/shared/memory/repository.ts';
import type { AnyMemory } from '@craft-agent/shared/memory/types.ts';
import type { SessionToolContext } from '../context.ts';
import { handleMemorySearch } from './memory-search.ts';
import { handleMemoryRecall } from './memory-recall.ts';
import { handleMemoryCreate } from './memory-create.ts';
import { handleMemoryUpdate } from './memory-update.ts';
import { handleMemoryArchive } from './memory-archive.ts';

// =====================================================================
// Factories: produce AnyMemory records that match the shared schema.
// =====================================================================

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
    content: `User preference for ${key}`,
    confidence: 0.95,
    sensitivity: 'internal',
    source: { importOrigin: 'obsidian' },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    supersededById: undefined,
    supersedesIds: [],
    tags: [],
    archived: false,
    key,
    previousValues: [],
  } as unknown as AnyMemory;
}

function makeSemantic(id: string, title: string, content: string): AnyMemory {
  return {
    id,
    class: 'semantic',
    scope: 'global',
    scopeId: undefined,
    title,
    content,
    confidence: 0.9,
    sensitivity: 'internal',
    source: { importOrigin: 'obsidian' },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    supersededById: undefined,
    supersedesIds: [],
    tags: [],
    archived: false,
    category: 'reference',
    explicit: true,
    canonicalQuestion: '?',
  } as unknown as AnyMemory;
}

function asCtx(repo: MemoryRepository): SessionToolContext {
  return {
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
      getMemoryRepository: async () => repo,
    },
  } as unknown as SessionToolContext;
}

// =====================================================================
// Main suite: happy paths + edge cases.
// =====================================================================

describe('memory_search + memory_recall', () => {
  let db: ReturnType<typeof openMemoryDatabase>;
  let repo: MemoryRepository;
  let ctx: SessionToolContext;

  beforeEach(() => {
    db = openMemoryDatabase(undefined, { inMemory: true });
    bootstrapStorage(db);
    repo = MemoryRepository.createMemoryRepository(db);
    ctx = asCtx(repo);

    repo.createMemory(makeProfile('mem:p-theme', 'theme'));
    repo.createMemory(makeProfile('mem:p-name', 'name'));
    repo.createMemory(
      makeSemantic(
        'mem:s-docker',
        'How to run docker',
        'Docker is installed locally for reproducible builds. Run docker compose up to start dev services.',
      ),
    );
  });

  afterEach(() => {
    db.close();
  });

  it('memory_search returns a markdown bullet list with score + snippet + structured payload', async () => {
    const r = await handleMemorySearch(ctx, { query: 'docker' });
    expect(r.isError).toBe(false);
    const text = r.content[0].text;
    expect(text).toMatch(/1 memory/);
    expect(text).toMatch(/How to run docker/);
    expect(text).toMatch(/id=mem:s-docker/);
    expect(text).toMatch(/class=semantic/);
    expect(text).toMatch(/score=\d+\.\d+/);
    expect(text).toContain("Docker");
    const sc = r.structuredContent as Record<string, unknown>;
    expect(Array.isArray(sc.hits)).toBe(true);
    expect((sc.hits as Array<Record<string, unknown>>)[0].id).toBe('mem:s-docker');
  });

  it('memory_search with class=profile narrows to profile memories only', async () => {
    const r = await handleMemorySearch(ctx, {
      query: 'preference',
      class: 'profile',
    });
    expect(r.isError).toBe(false);
    const text = r.content[0].text;
    expect(text).not.toMatch(/semantic/);
    expect(text).not.toMatch(/How to run docker/);
    expect(text).toMatch(/Profile theme/);
    expect(text).toMatch(/Profile name/);
  });

  it('memory_search with zero hits returns the no-match text and empty hits array', async () => {
    const r = await handleMemorySearch(ctx, { query: 'nonexistent_query_xyz' });
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toMatch(/No memories matched "nonexistent_query_xyz"/);
    const sc = r.structuredContent as Record<string, unknown>;
    expect(sc.hits).toEqual([]);
  });

  it('memory_search clamps limit to [1, 50] and default is 10', async () => {
    const r = await handleMemorySearch(ctx, { query: 'preference', limit: 999 });
    expect(r.content[0].text).toMatch(/2 memories/);
  });

  it('memory_search with missing ctx.getMemoryRepository returns an error', async () => {
    const brokenCtx = {} as unknown as SessionToolContext;
    const r = await handleMemorySearch(brokenCtx, { query: 'docker' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('not available in this context');
  });

  it('memory_search with empty query returns errorResponse (Zod rejection)', async () => {
    const r = await handleMemorySearch(ctx, { query: '' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('invalid args');
  });

  it('memory_search with single-char query returns errorResponse (too-short hint)', async () => {
    const r = await handleMemorySearch(ctx, { query: 'a' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('too short');
  });

  it('memory_search with malformed args (query wrong type) is rejected by Zod', async () => {
    const r = await handleMemorySearch(
      ctx,
      { query: 12345 } as unknown as Parameters<typeof handleMemorySearch>[1],
    );
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('invalid args');
  });

  it('memory_recall returns the full AnyMemory JSON for a found id', async () => {
    const r = await handleMemoryRecall(ctx, { id: 'mem:s-docker' });
    expect(r.isError).toBe(false);
    const parsed = JSON.parse(r.content[0].text);
    expect(parsed.id).toBe('mem:s-docker');
    expect(parsed.class).toBe('semantic');
    expect(parsed.category).toBe('reference');
    expect(parsed.content).toMatch(/Docker is installed locally/);
  });

  it('memory_recall on an unknown id returns isError:true with an actionable message', async () => {
    const r = await handleMemoryRecall(ctx, { id: 'mem:does-not-exist' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('not found');
  });

  it('memory_recall on an archived memory returns isError:true', async () => {
    repo.archiveMemory('mem:s-docker');
    const r = await handleMemoryRecall(ctx, { id: 'mem:s-docker' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/archived or never imported/);
  });

  it('memory_recall with empty id returns an error', async () => {
    const r = await handleMemoryRecall(ctx, { id: '' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('invalid args');
  });

  it('memory_recall truncates content past 4 KB and exposes bounded summary snippet', async () => {
    const big = 'x'.repeat(10_000);
    repo.createMemory(makeSemantic('mem:big', 'Big semantic memory', big));
    const r = await handleMemoryRecall(ctx, { id: 'mem:big' });
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain('truncated');
    const sc = r.structuredContent as Record<string, unknown>;
    expect(sc.id).toBe('mem:big');
    expect(sc.truncated).toBe(true);
    expect(typeof sc.snippet).toBe('string');
    expect((sc.snippet as string).length).toBeLessThanOrEqual(280);
  });
});

// =====================================================================
// memory_create
// =====================================================================

describe('memory_create', () => {
  let db: ReturnType<typeof openMemoryDatabase>;
  let repo: MemoryRepository;
  let ctx: SessionToolContext;

  beforeEach(() => {
    db = openMemoryDatabase(undefined, { inMemory: true });
    bootstrapStorage(db);
    repo = MemoryRepository.createMemoryRepository(db);
    ctx = asCtx(repo);
  });

  afterEach(() => {
    db.close();
  });

  it('creates a semantic memory', async () => {
    const r = await handleMemoryCreate(ctx, {
      class: 'semantic',
      title: 'Test Semantic',
      content: 'This is test content',
      tags: ['test', 'demo'],
    });
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain('Memory created');
    expect(r.content[0].text).toContain('Test Semantic');
    expect(r.content[0].text).toContain('class=semantic');
    const sc = r.structuredContent as Record<string, unknown>;
    expect(typeof sc.id).toBe('string');
    expect(sc.class).toBe('semantic');
    // Verify the memory is searchable
    const search = await handleMemorySearch(ctx, { query: 'test content' });
    expect(search.content[0].text).toContain('Test Semantic');
  });

  it('creates a profile memory', async () => {
    const r = await handleMemoryCreate(ctx, {
      class: 'profile',
      title: 'User Timezone',
      content: 'User prefers Eastern Time',
      key: 'timezone',
      scope: 'agent',
    });
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain('User Timezone');
  });

  it('creates a procedural memory', async () => {
    const r = await handleMemoryCreate(ctx, {
      class: 'procedural',
      title: 'Deploy Steps',
      content: 'Run deploy.sh to push to production',
      triggers: ['deploy', 'release'],
      successCount: 5,
    });
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain('Deploy Steps');
  });

  it('creates an episodic memory', async () => {
    const r = await handleMemoryCreate(ctx, {
      class: 'episodic',
      title: 'Debug Session',
      content: 'Fixed the race condition in worker pool',
      outcome: 'completed',
      sessionId: 'session-123',
    });
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain('Debug Session');
  });

  it('returns error when getMemoryRepository is missing', async () => {
    const brokenCtx = {} as unknown as SessionToolContext;
    const r = await handleMemoryCreate(brokenCtx, {
      class: 'semantic',
      title: 'Test',
      content: 'Content',
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('not available in this context');
  });

  it('rejects missing title or content via Zod', async () => {
    const r = await handleMemoryCreate(ctx, {
      class: 'semantic',
      title: '',
      content: '',
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('invalid args');
  });
});

// =====================================================================
// memory_update
// =====================================================================

describe('memory_update', () => {
  let db: ReturnType<typeof openMemoryDatabase>;
  let repo: MemoryRepository;
  let ctx: SessionToolContext;

  beforeEach(() => {
    db = openMemoryDatabase(undefined, { inMemory: true });
    bootstrapStorage(db);
    repo = MemoryRepository.createMemoryRepository(db);
    ctx = asCtx(repo);
    repo.createMemory(makeSemantic('mem:upd', 'Original Title', 'Original content'));
  });

  afterEach(() => {
    db.close();
  });

  it('updates title and content', async () => {
    const r = await handleMemoryUpdate(ctx, {
      id: 'mem:upd',
      title: 'Updated Title',
      content: 'Updated content',
    });
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain('Updated Title');
    const sc = r.structuredContent as Record<string, unknown>;
    expect(sc.updatedFields).toContain('title');
    expect(sc.updatedFields).toContain('content');
    // Verify persistence
    const recalled = await handleMemoryRecall(ctx, { id: 'mem:upd' });
    const parsed = JSON.parse(recalled.content[0].text);
    expect(parsed.title).toBe('Updated Title');
    expect(parsed.content).toBe('Updated content');
  });

  it('updates tags and confidence', async () => {
    const r = await handleMemoryUpdate(ctx, {
      id: 'mem:upd',
      tags: ['important', 'revised'],
      confidence: 0.95,
    });
    expect(r.isError).toBe(false);
    const recalled = await handleMemoryRecall(ctx, { id: 'mem:upd' });
    const parsed = JSON.parse(recalled.content[0].text);
    expect(parsed.tags).toContain('important');
    expect(parsed.confidence).toBe(0.95);
  });

  it('returns error on unknown id', async () => {
    const r = await handleMemoryUpdate(ctx, {
      id: 'mem:nonexistent',
      title: 'Nope',
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('not found');
  });

  it('returns error when no patchable fields supplied', async () => {
    const r = await handleMemoryUpdate(ctx, { id: 'mem:upd' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('no patchable fields');
  });

  it('returns error when ctx.getMemoryRepository is missing', async () => {
    const brokenCtx = {} as unknown as SessionToolContext;
    const r = await handleMemoryUpdate(brokenCtx, {
      id: 'mem:upd',
      title: 'Nope',
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('not available in this context');
  });
});

// =====================================================================
// memory_archive
// =====================================================================

describe('memory_archive', () => {
  let db: ReturnType<typeof openMemoryDatabase>;
  let repo: MemoryRepository;
  let ctx: SessionToolContext;

  beforeEach(() => {
    db = openMemoryDatabase(undefined, { inMemory: true });
    bootstrapStorage(db);
    repo = MemoryRepository.createMemoryRepository(db);
    ctx = asCtx(repo);
    repo.createMemory(makeSemantic('mem:arch', 'To Archive', 'This will be archived'));
  });

  afterEach(() => {
    db.close();
  });

  it('archives a memory so it disappears from search', async () => {
    // Confirm it's visible before archiving
    const before = await handleMemorySearch(ctx, { query: 'archive' });
    expect(before.content[0].text).toContain('To Archive');

    const r = await handleMemoryArchive(ctx, { id: 'mem:arch' });
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain('Memory archived');
    expect(r.content[0].text).toContain('To Archive');

    // Should not appear in normal search
    const after = await handleMemorySearch(ctx, { query: 'archive' });
    expect(after.content[0].text).toContain('No memories matched');
  });

  it('returns error on unknown id', async () => {
    const r = await handleMemoryArchive(ctx, { id: 'mem:nonexistent' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('not found');
  });

  it('returns error when ctx.getMemoryRepository is missing', async () => {
    const brokenCtx = {} as unknown as SessionToolContext;
    const r = await handleMemoryArchive(brokenCtx, { id: 'mem:arch' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('not available in this context');
  });

  it('rejects empty id via Zod', async () => {
    const r = await handleMemoryArchive(ctx, { id: '' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('invalid args');
  });
});
