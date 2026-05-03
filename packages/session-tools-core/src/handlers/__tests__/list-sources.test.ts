import { describe, it, expect } from 'bun:test';
import type {
  SessionToolContext,
  ListSourcesOptions,
  ListSourcesResult,
  SourceListItem,
} from '../../context.ts';
import { handleListSources, type ListSourcesArgs } from '../list-sources.ts';

function makeItem(partial: Partial<SourceListItem>): SourceListItem {
  return {
    slug: partial.slug ?? 'src',
    name: partial.name ?? 'Src',
    description: partial.description ?? '',
    tags: partial.tags ?? [],
    type: partial.type ?? 'mcp',
    tier: partial.tier ?? 'workspace',
    enabled: partial.enabled ?? true,
    authStatus: partial.authStatus ?? 'untested',
    iconUrl: partial.iconUrl,
  };
}

const ALL_ITEMS: SourceListItem[] = [
  makeItem({
    slug: 'notion', name: 'Notion', description: 'Knowledge base and docs.',
    tags: ['knowledge', 'docs'], type: 'mcp', tier: 'global',
    enabled: true, authStatus: 'connected',
  }),
  makeItem({
    slug: 'linear', name: 'Linear', description: 'Issue tracker.',
    tags: ['issues'], type: 'mcp', tier: 'global-dormant',
    enabled: false, authStatus: 'untested',
  }),
  makeItem({
    slug: 'project-data', name: 'project-data', description: 'Project MCP.',
    tags: [], type: 'mcp', tier: 'workspace', enabled: true, authStatus: 'needs_auth',
  }),
  makeItem({
    slug: 'web-search', name: 'Web Search', description: 'Generic web search.',
    tags: ['search'], type: 'api', tier: 'global',
    enabled: true, authStatus: 'none',
  }),
  makeItem({
    slug: 'fs', name: 'Filesystem', description: 'Local filesystem connector.',
    tags: ['local'], type: 'local', tier: 'project',
    enabled: true, authStatus: 'none',
  }),
];

function makeCtx(opts?: {
  listSources?: (options?: ListSourcesOptions) => ListSourcesResult;
}): SessionToolContext {
  const ctx: Partial<SessionToolContext> = {
    sessionId: 't',
    workspacePath: '/tmp',
    plansFolderPath: '/tmp/plans',
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: {
      exists: () => false,
      readFile: () => '',
      readFileBuffer: () => Buffer.from(''),
      writeFile: () => {},
      isDirectory: () => false,
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
    get sourcesPath() { return '/tmp/sources'; },
    get skillsPath() { return '/tmp/skills'; },
  };
  if (opts?.listSources) ctx.listSources = opts.listSources;
  return ctx as SessionToolContext;
}

/**
 * Reference implementation matching the binding's filter behavior
 * (kept inline so the test asserts against an explicit contract).
 */
function fakeListSources(items: SourceListItem[]) {
  return (options?: ListSourcesOptions): ListSourcesResult => {
    let out = items;
    if (options?.activeOnly) {
      out = out.filter(s => s.tier !== 'global-dormant');
    }
    if (options?.type) {
      out = out.filter(s => s.type === options.type);
    }
    if (options?.tags && options.tags.length > 0) {
      const required = options.tags.map(t => t.toLowerCase());
      out = out.filter(s => {
        const haystack = s.tags.map(t => t.toLowerCase());
        return required.every(t => haystack.includes(t));
      });
    }
    if (options?.search && options.search.trim().length > 0) {
      const q = options.search.toLowerCase();
      out = out.filter(s =>
        s.slug.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q)),
      );
    }
    return { total: out.length, returned: out.length, sources: out };
  };
}

function parseResult(text: string): ListSourcesResult {
  return JSON.parse(text);
}

describe('handleListSources', () => {
  it('errors when context capability is missing', async () => {
    const result = await handleListSources(makeCtx(), {});
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('not available in this context');
  });

  it('returns an empty array for an empty workspace', async () => {
    const ctx = makeCtx({ listSources: fakeListSources([]) });
    const result = await handleListSources(ctx, {});
    expect(result.isError).toBeFalsy();
    const parsed = parseResult((result.content[0] as any).text);
    expect(parsed.total).toBe(0);
    expect(parsed.returned).toBe(0);
    expect(parsed.sources).toEqual([]);
  });

  it('activeOnly excludes global-dormant sources', async () => {
    const ctx = makeCtx({ listSources: fakeListSources(ALL_ITEMS) });
    const result = await handleListSources(ctx, { activeOnly: true } satisfies ListSourcesArgs);
    const parsed = parseResult((result.content[0] as any).text);
    const slugs = parsed.sources.map(s => s.slug);
    expect(slugs).not.toContain('linear');
    expect(slugs).toContain('notion');
    expect(slugs).toContain('web-search');
  });

  it('activeOnly omitted (default) returns dormant sources too', async () => {
    const ctx = makeCtx({ listSources: fakeListSources(ALL_ITEMS) });
    const result = await handleListSources(ctx, {});
    const parsed = parseResult((result.content[0] as any).text);
    expect(parsed.sources.find(s => s.slug === 'linear')?.tier).toBe('global-dormant');
  });

  it('search filter matches name and description case-insensitively', async () => {
    const ctx = makeCtx({ listSources: fakeListSources(ALL_ITEMS) });
    const byName = parseResult(
      (await handleListSources(ctx, { search: 'NOTION' })).content[0]!.text as string,
    );
    expect(byName.sources.map(s => s.slug)).toEqual(['notion']);

    const byDescription = parseResult(
      (await handleListSources(ctx, { search: 'issue' })).content[0]!.text as string,
    );
    expect(byDescription.sources.map(s => s.slug)).toEqual(['linear']);
  });

  it('type filter narrows results', async () => {
    const ctx = makeCtx({ listSources: fakeListSources(ALL_ITEMS) });
    const apis = parseResult(
      (await handleListSources(ctx, { type: 'api' })).content[0]!.text as string,
    );
    expect(apis.sources.map(s => s.slug)).toEqual(['web-search']);

    const locals = parseResult(
      (await handleListSources(ctx, { type: 'local' })).content[0]!.text as string,
    );
    expect(locals.sources.map(s => s.slug)).toEqual(['fs']);
  });

  it('tier values are returned correctly for each known tier', async () => {
    const ctx = makeCtx({ listSources: fakeListSources(ALL_ITEMS) });
    const all = parseResult((await handleListSources(ctx, {})).content[0]!.text as string);
    const tiers = new Set(all.sources.map(s => s.tier));
    expect(tiers.has('workspace')).toBe(true);
    expect(tiers.has('global')).toBe(true);
    expect(tiers.has('global-dormant')).toBe(true);
    expect(tiers.has('project')).toBe(true);
  });

  it('reports an authStatus of "none" for sources whose config declares no auth', async () => {
    const ctx = makeCtx({ listSources: fakeListSources(ALL_ITEMS) });
    const all = parseResult((await handleListSources(ctx, {})).content[0]!.text as string);
    const ws = all.sources.find(s => s.slug === 'web-search');
    expect(ws?.authStatus).toBe('none');
    expect(ws?.enabled).toBe(true);
  });

  it('forwards thrown errors as a tool error', async () => {
    const ctx = makeCtx({
      listSources: () => {
        throw new Error('boom');
      },
    });
    const result = await handleListSources(ctx, {});
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Failed to list sources');
    expect((result.content[0] as any).text).toContain('boom');
  });
});
