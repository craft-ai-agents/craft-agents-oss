import { openMemoryDatabase, bootstrapStorage } from '../database';
import { MemoryRepository } from '../repository';
import type { AnyMemory } from '../types';

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function makeMemory(overrides: Partial<AnyMemory> & { id: string; class: AnyMemory['class']; title: string; content: string }): AnyMemory {
  const base = {
    id: overrides.id,
    class: overrides.class,
    scope: (overrides.scope ?? 'global') as AnyMemory['scope'],
    scopeId: overrides.scopeId ?? null as any,
    title: overrides.title,
    content: overrides.content,
    confidence: overrides.confidence ?? 0.8,
    sensitivity: overrides.sensitivity ?? 'internal' as const,
    source: overrides.source,
    expiry: overrides.expiry,
    createdAt: overrides.createdAt ?? nowIso(),
    updatedAt: overrides.updatedAt ?? nowIso(),
    supersededById: overrides.supersededById ?? undefined,
    supersedesIds: overrides.supersedesIds ?? [],
    tags: overrides.tags ?? [],
    archived: overrides.archived ?? false,
  } as any;

  if (overrides.class === 'profile') {
    return { ...base, key: overrides.key ?? 'name', previousValues: overrides.previousValues ?? [] } as AnyMemory;
  }
  if (overrides.class === 'semantic') {
    return {
      ...base,
      category: overrides.category ?? 'reference',
      explicit: overrides.explicit ?? true,
      canonicalQuestion: overrides.canonicalQuestion,
    } as AnyMemory;
  }
  if (overrides.class === 'episodic') {
    return {
      ...base,
      sessionId: overrides.sessionId ?? 'sess:fake',
      outcome: overrides.outcome ?? 'completed',
      decisions: overrides.decisions ?? [],
      artifacts: overrides.artifacts ?? [],
      tokenCost: overrides.tokenCost,
      durationSeconds: overrides.durationSeconds,
    } as AnyMemory;
  }
  return {
    ...base,
    triggers: overrides.triggers ?? [],
    steps: overrides.steps ?? [],
    successCount: overrides.successCount ?? 0,
    pitfalls: overrides.pitfalls ?? [],
    dependencies: overrides.dependencies ?? [],
  } as AnyMemory;
}

describe('Memory FTS5 search', () => {
  let db: ReturnType<typeof openMemoryDatabase>;
  let repo: MemoryRepository;

  beforeEach(() => {
    db = openMemoryDatabase(undefined, { inMemory: true });
    bootstrapStorage(db);
    repo = MemoryRepository.createMemoryRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('inserts populate the FTS5 index', () => {
    repo.createMemory(makeMemory({
      id: 'mem:profile:name',
      class: 'profile',
      title: 'Owner name',
      content: 'The owner prefers the name Lucian for the AI assistant.',
      tags: ['name', 'owner'],
    }));

    const hits = repo.searchMemories({ query: 'Lucian' });
    expect(hits).toHaveLength(1);
    expect(hits[0].memory.id).toBe('mem:profile:name');
    expect(hits[0].score).toBeGreaterThanOrEqual(0);
    expect(hits[0].score).toBeLessThanOrEqual(1);
  });

  it('finds matches across content, title, canonical_question, key, triggers, and tags', () => {
    repo.createMemory(makeMemory({
      id: 'mem:semantic:docker',
      class: 'semantic',
      category: 'environment',
      title: 'Container runtime',
      content: 'Docker is installed locally for reproducible builds.',
      canonicalQuestion: 'How do I run a CLI tool in a sandbox?',
      tags: ['docker', 'env'],
    }));
    repo.createMemory(makeMemory({
      id: 'mem:procedural:deploy',
      class: 'procedural',
      title: 'Deploy to staging',
      content: 'Run the docker compose push step then promote via k8s.',
      triggers: ['docker deploy', 'release staging'],
      tags: ['deploy'],
    }));
    repo.createMemory(makeMemory({
      id: 'mem:profile:theme',
      class: 'profile',
      key: 'theme',
      title: 'Color theme',
      content: 'Default to dark mode plus the emerald-pine palette.',
      tags: ['theme'],
    }));

    expect(repo.searchMemories({ query: 'docker' }).map((h) => h.memory.id).sort())
      .toEqual(['mem:procedural:deploy', 'mem:semantic:docker']);

    // tags are tokenized too — searching a tag string matches the row.
    expect(repo.searchMemories({ query: 'env' }).map((h) => h.memory.id))
      .toEqual(['mem:semantic:docker']);

    // canonicalQuestion is indexed.
    expect(repo.searchMemories({ query: 'sandbox' }).map((h) => h.memory.id))
      .toEqual(['mem:semantic:docker']);

    // key is indexed.
    expect(repo.searchMemories({ query: 'theme' }).map((h) => h.memory.id))
      .toEqual(['mem:profile:theme']);
  });

  it('decorates results with `<mark>`-wrapped snippets', () => {
    repo.createMemory(makeMemory({
      id: 'mem:snippet-test',
      class: 'semantic',
      title: 'Snippet test',
      content: 'The quick brown fox jumps over the lazy dog repeatedly.',
      tags: [],
    }));

    const hits = repo.searchMemories({ query: 'fox' });
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toBeDefined();
    expect(hits[0].snippet).toContain('<mark>');
    expect(hits[0].snippet).toContain('</mark>');
    expect(hits[0].snippet!.toLowerCase()).toContain('fox');
  });

  it('ranks more relevant rows first by bm25', () => {
    repo.createMemory(makeMemory({
      id: 'mem:rank-weak',
      class: 'semantic',
      title: 'Unrelated',
      content: 'This memory mentions TypeScript once in passing.',
    }));
    repo.createMemory(makeMemory({
      id: 'mem:rank-strong',
      class: 'semantic',
      title: 'TypeScript everywhere',
      content: 'TypeScript is the primary language. TypeScript governs the build pipeline. TypeScript everywhere.',
    }));

    const hits = repo.searchMemories({ query: 'TypeScript' });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0].memory.id).toBe('mem:rank-strong');
    expect(hits[1].memory.id).toBe('mem:rank-weak');
    // bm25 returns lower = better, so we expose score = max(0, 1 - bm25).
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
  });

  it('applies SQL-side filters: class, scope, scopeId, minConfidence, category', () => {
    repo.createMemory(makeMemory({
      id: 'mem:semantic:linux',
      class: 'semantic',
      scope: 'project',
      scopeId: 'project-arch',
      title: 'Linux build host',
      content: 'Build host runs Arch Linux on bare metal.',
      category: 'environment',
    }));
    repo.createMemory(makeMemory({
      id: 'mem:episodic:meeting',
      class: 'episodic',
      scope: 'project',
      scopeId: 'project-arch',
      sessionId: 'sess-1',
      title: 'Standup summary',
      content: 'We discussed the Linux migration milestones.',
    }));
    repo.createMemory(makeMemory({
      id: 'mem:semantic:windows',
      class: 'semantic',
      scope: 'project',
      scopeId: 'project-other',
      title: 'Windows peculiarity',
      content: 'On Windows, cmd uses backslashes and CRLF line endings.',
    }));

    const classOnly = repo.searchMemories({ query: 'Linux', class: 'semantic' });
    expect(classOnly.map((h) => h.memory.id)).toEqual(['mem:semantic:linux']);

    const scopeAndScopeId = repo.searchMemories({
      query: 'Linux',
      class: 'semantic',
      scope: 'project',
      scopeId: 'project-arch',
    });
    expect(scopeAndScopeId.map((h) => h.memory.id)).toEqual(['mem:semantic:linux']);

    const categoryOnly = repo.searchMemories({ query: 'Linux', category: 'environment' });
    expect(categoryOnly.map((h) => h.memory.id)).toEqual(['mem:semantic:linux']);

    const weak = repo.searchMemories({ query: 'Linux', minConfidence: 0.99 });
    expect(weak).toEqual([]);
  });

  it('does not return archived memories by default', () => {
    repo.createMemory(makeMemory({
      id: 'mem:archived:1',
      class: 'semantic',
      title: 'Old fact',
      content: 'Long-forgotten lore about the project.',
    }));
    repo.archiveMemory('mem:archived:1');

    expect(repo.searchMemories({ query: 'forgotten' })).toEqual([]);
    const hits = repo.searchMemories({ query: 'forgotten', includeArchived: true });
    expect(hits).toHaveLength(1);
    expect(hits[0].memory.id).toBe('mem:archived:1');
  });

  it('updates the FTS index when a memory is updated', () => {
    repo.createMemory(makeMemory({
      id: 'mem:mutating',
      class: 'semantic',
      title: 'Original',
      content: 'Original content about TypeScript builds.',
    }));
    expect(repo.searchMemories({ query: 'TypeScript' })).toHaveLength(1);

    repo.updateMemory('mem:mutating', { title: 'Replaced', content: 'Replaced content about Rust builds.' });
    expect(repo.searchMemories({ query: 'TypeScript' })).toEqual([]);
    const hits = repo.searchMemories({ query: 'Rust' });
    expect(hits).toHaveLength(1);
    expect(hits[0].memory.title).toBe('Replaced');
  });

  it('removes the FTS row on delete', () => {
    repo.createMemory(makeMemory({
      id: 'mem:to-delete',
      class: 'semantic',
      title: 'To be deleted',
      content: 'Phantom text content unique enough to grep.',
    }));
    expect(repo.searchMemories({ query: 'phantom' })).toHaveLength(1);

    repo.deleteMemory('mem:to-delete');
    expect(repo.searchMemories({ query: 'phantom' })).toEqual([]);
  });

  it('falls back to filtered list when query is empty', () => {
    repo.createMemory(makeMemory({
      id: 'mem:a', class: 'semantic', title: 'A', content: 'aaa', tags: ['t1'],
    }));
    repo.createMemory(makeMemory({
      id: 'mem:b', class: 'episodic', title: 'B', content: 'bbb', sessionId: 's', tags: ['t2'],
    }));

    expect(repo.searchMemories({}).map((h) => h.memory.id).sort()).toEqual(['mem:a', 'mem:b']);
    expect(repo.searchMemories({ class: 'semantic' }).map((h) => h.memory.id)).toEqual(['mem:a']);
  });

  // Empty-query + tags filter is the path that had been broken: buildSearchFilters
  // used to emit `memory_index_fts.tags MATCH ?` unconditionally, which fails
  // when the empty-FTS branch doesn't join memory_index_fts. After the fix, the
  // empty-FTS branch uses json_each over memories.tags.
  it('applies a tag filter in the empty-query branch via json_each', () => {
    repo.createMemory(makeMemory({
      id: 'mem:tagged-a', class: 'semantic', title: 'A', content: 'aaa', tags: ['arch', 'core'],
    }));
    repo.createMemory(makeMemory({
      id: 'mem:tagged-b', class: 'semantic', title: 'B', content: 'bbb', tags: ['arch', 'experimental'],
    }));
    repo.createMemory(makeMemory({
      id: 'mem:tagged-c', class: 'semantic', title: 'C', content: 'ccc', tags: ['misc'],
    }));

    expect(repo.searchMemories({ query: '', tags: ['arch'] }).map((h) => h.memory.id).sort())
      .toEqual(['mem:tagged-a', 'mem:tagged-b']);
    expect(repo.searchMemories({ tags: ['core'] }).map((h) => h.memory.id))
      .toEqual(['mem:tagged-a']);
    // AND-of-tags: both tags must match.
    expect(repo.searchMemories({ tags: ['arch', 'core'] }).map((h) => h.memory.id))
      .toEqual(['mem:tagged-a']);
  });

  it('sanitizes FTS5-special characters and bounds result count', () => {
    repo.createMemory(makeMemory({
      id: 'mem:spec', class: 'semantic', title: 'Special', content: 'Words with colons: foo:bar.',
    }));
    // The sanitizer drops stray unquoted `:` while keeping `foo` and `bar`
    // — we should still find the memory under either token.
    expect(repo.searchMemories({ query: 'foo' })).toHaveLength(1);
    expect(repo.searchMemories({ query: 'bar' })).toHaveLength(1);
    expect(repo.searchMemories({ query: 'foo:bar' }).map((h) => h.memory.id)).toContain('mem:spec');
    // And a query that's only syntax chars falls back cleanly to the no-FTS
    // branch instead of throwing a syntax error.
    expect(() => repo.searchMemories({ query: '""' })).not.toThrow();
  });

  it('respects limit + offset for pagination', () => {
    for (let i = 0; i < 7; i++) {
      repo.createMemory(makeMemory({
        id: `mem:p${i}`,
        class: 'semantic',
        title: `Page hit ${i}`,
        content: `Shared search needle appears in page hit ${i}.`,
      }));
    }
    const page1 = repo.searchMemories({ query: 'needle', limit: 3, offset: 0 });
    const page2 = repo.searchMemories({ query: 'needle', limit: 3, offset: 3 });
    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    expect(page1.map((h) => h.memory.id)).not.toEqual(page2.map((h) => h.memory.id));
  });
});
