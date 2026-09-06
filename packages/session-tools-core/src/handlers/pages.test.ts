import { describe, it, expect } from 'bun:test';
import {
  handleListPages,
  handleGetPage,
  handleCreatePage,
  handleUpdatePage,
  handleWritePageData,
  handleDeletePage,
} from './pages.ts';
import type {
  SessionToolContext,
  PagesToolCallbacks,
  PageToolSummary,
  PageToolDetails,
} from '../context.ts';

const SUMMARY: PageToolSummary = {
  slug: 'build-health',
  name: 'Build Health',
  kind: 'live',
  projectId: 'proj_1',
  createdAt: 1,
  updatedAt: 2,
  hasContent: true,
  shared: false,
  folderPath: '/ws/pages/build-health',
};

const DETAILS: PageToolDetails = {
  ...SUMMARY,
  id: 'page_1a2b3c4d',
  contentDigest: 'abc',
  contentLength: 128,
  contentPath: '/ws/pages/build-health/index.html',
  data: null,
  grants: [],
};

function createCtx(overrides?: Partial<PagesToolCallbacks>): {
  ctx: SessionToolContext;
  calls: Array<{ method: string; args: unknown[] }>;
} {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args });
  const pages: PagesToolCallbacks = {
    listPages: () => { record('listPages'); return [SUMMARY, { ...SUMMARY, slug: 'notes', projectId: undefined }]; },
    getPage: (slug, options) => { record('getPage', slug, options); return slug === 'build-health' ? DETAILS : null; },
    createPage: async (input) => { record('createPage', input); return DETAILS; },
    updatePage: async (slug, patch) => { record('updatePage', slug, patch); return DETAILS; },
    writePageData: async (slug, patch) => {
      record('writePageData', slug, patch);
      return { slug, kvCount: 2, seriesCount: 1, generatedAt: 3, snapshotPath: '/ws/pages/build-health/data/snapshot.json', durationMs: 42 };
    },
    deletePage: async (slug) => { record('deletePage', slug); return { deleted: true, publicCopyMayRemain: false }; },
    ...overrides,
  };
  return { ctx: { pages } as unknown as SessionToolContext, calls };
}

describe('pages handlers', () => {
  it('all handlers degrade gracefully without the pages callbacks', async () => {
    const ctx = {} as unknown as SessionToolContext;
    for (const result of [
      await handleListPages(ctx, {}),
      await handleGetPage(ctx, { slug: 's' }),
      await handleCreatePage(ctx, { name: 'n' }),
      await handleUpdatePage(ctx, { slug: 's', name: 'n' }),
      await handleWritePageData(ctx, { slug: 's', set: { a: 1 } }),
      await handleDeletePage(ctx, { slug: 's' }),
    ]) {
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not available');
    }
  });

  it('list_pages returns totals and supports the projectId filter', async () => {
    const { ctx } = createCtx();
    const all = JSON.parse((await handleListPages(ctx, {})).content[0].text);
    expect(all.total).toBe(2);

    const filtered = JSON.parse((await handleListPages(ctx, { projectId: 'proj_1' })).content[0].text);
    expect(filtered.total).toBe(1);
    expect(filtered.pages[0].slug).toBe('build-health');
  });

  it('get_page passes includeContent through and 404s unknown slugs', async () => {
    const { ctx, calls } = createCtx();
    const ok = await handleGetPage(ctx, { slug: 'build-health', includeContent: true });
    expect(ok.isError).toBeFalsy();
    expect(calls[0]).toEqual({ method: 'getPage', args: ['build-health', { includeContent: true }] });

    const missing = await handleGetPage(ctx, { slug: 'nope' });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain('list_pages');
  });

  it('create_page requires a name and returns the created details', async () => {
    const { ctx, calls } = createCtx();
    const noName = await handleCreatePage(ctx, { name: '  ' });
    expect(noName.isError).toBe(true);
    expect(calls).toHaveLength(0);

    const created = await handleCreatePage(ctx, { name: 'Build Health', kind: 'live', content: '<!doctype html>' });
    expect(created.isError).toBeFalsy();
    expect(JSON.parse(created.content[0].text).slug).toBe('build-health');
  });

  it('update_page rejects empty patches without calling the backend', async () => {
    const { ctx, calls } = createCtx();
    const empty = await handleUpdatePage(ctx, { slug: 'build-health' });
    expect(empty.isError).toBe(true);
    expect(empty.content[0].text).toContain('Nothing to update');
    expect(calls).toHaveLength(0);

    const ok = await handleUpdatePage(ctx, { slug: 'build-health', projectId: null });
    expect(ok.isError).toBeFalsy();
    expect(calls[0]).toEqual({ method: 'updatePage', args: ['build-health', { projectId: null }] });
  });

  it('write_page_data separates slug from the patch and returns the summary', async () => {
    const { ctx, calls } = createCtx();
    const result = await handleWritePageData(ctx, {
      slug: 'build-health',
      set: { a: 1 },
      appendSeries: { m: [{ v: 2 }] },
    });
    expect(result.isError).toBeFalsy();
    expect(calls[0].args).toEqual(['build-health', { set: { a: 1 }, appendSeries: { m: [{ v: 2 }] } }]);
    expect(JSON.parse(result.content[0].text).kvCount).toBe(2);
  });

  it('delete_page reports the unpublish outcome and wraps backend failures', async () => {
    const { ctx } = createCtx();
    const ok = await handleDeletePage(ctx, { slug: 'build-health' });
    expect(JSON.parse(ok.content[0].text)).toEqual({ deleted: true, publicCopyMayRemain: false });

    const { ctx: failingCtx } = createCtx({
      deletePage: async () => { throw new Error('Page not found: nope'); },
    });
    const failed = await handleDeletePage(failingCtx, { slug: 'nope' });
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('Page not found');
  });
});
