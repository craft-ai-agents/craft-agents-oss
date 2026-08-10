import { describe, expect, it, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleCraftPage, handleCraftPageDelete } from './craft-page.ts';
import type { SessionToolContext, PageCatalogEntry } from '../context.ts';

let dataPath: string;
let registered: PageCatalogEntry[];
let unregistered: string[];

function ctx(withCatalog = true): SessionToolContext {
  const base = {
    sessionId: 'sess-1',
    workspacePath: '/ws',
    dataPath,
  } as unknown as SessionToolContext;
  if (withCatalog) {
    (base as SessionToolContext).pageCatalog = {
      register: async (e) => { registered.push(e); },
      unregister: async (id) => { unregistered.push(id); },
      resolve: async () => null,
      listForSession: async () => [],
    };
  }
  return base;
}

const text = (r: { content: Array<{ text: string }> }) => r.content.map(c => c.text).join('\n');

beforeEach(() => {
  dataPath = mkdtempSync(join(tmpdir(), 'craft-page-h-'));
  registered = [];
  unregistered = [];
});

describe('craft_page create', () => {
  it('creates a page and registers it in the catalog', async () => {
    const r = await handleCraftPage(ctx(), {
      command: 'create', slug: 'demo', title: 'Demo',
      files: [{ path: 'index.html', content: '<h1>hi</h1>' }],
    });
    expect(r.isError).toBeFalsy();
    expect(registered).toHaveLength(1);
    expect(registered[0]!.slug).toBe('demo');
    expect(registered[0]!.sessionId).toBe('sess-1');
  });

  it('returns a craft-page fence carrying pageId AND rev', async () => {
    const r = await handleCraftPage(ctx(), {
      command: 'create', slug: 'demo', title: 'Demo',
      files: [{ path: 'index.html', content: '<h1>hi</h1>' }],
    });
    const out = text(r as never);
    expect(out).toContain('```craft-page');
    // rev must be in the fence: the renderer keys the preview on pageId:rev, so
    // without it an edited page shows stale content.
    expect(out).toContain('"rev": 1');
    expect(out).toMatch(/"pageId": "[0-9a-f-]{36}"/);
  });

  it('reports validation failures as tool errors, not throws', async () => {
    const r = await handleCraftPage(ctx(), {
      command: 'create', slug: 'BAD SLUG', title: 'x',
      files: [{ path: 'index.html', content: 'x' }],
    });
    expect(r.isError).toBe(true);
    expect(text(r as never)).toContain('[ERROR]');
  });

  it('still writes the page when no catalog is injected', async () => {
    const r = await handleCraftPage(ctx(false), {
      command: 'create', slug: 'demo', title: 'Demo',
      files: [{ path: 'index.html', content: '<h1>hi</h1>' }],
    });
    expect(r.isError).toBeFalsy();
  });
});

describe('craft_page update / read / list', () => {
  beforeEach(async () => {
    await handleCraftPage(ctx(), {
      command: 'create', slug: 'demo', title: 'Demo',
      files: [
        { path: 'index.html', content: '<h1>hi</h1>' },
        { path: 'styles.css', content: 'a{color:red}' },
      ],
    });
  });

  it('bumps the revision in the returned fence', async () => {
    const r = await handleCraftPage(ctx(), {
      command: 'update', slug: 'demo',
      files: [{ path: 'styles.css', content: 'a{color:blue}' }],
    });
    expect(text(r as never)).toContain('"rev": 2');
  });

  it('surfaces an expectedRev conflict as a recoverable error', async () => {
    const r = await handleCraftPage(ctx(), {
      command: 'update', slug: 'demo', expectedRev: 42,
      files: [{ path: 'styles.css', content: 'x' }],
    });
    expect(r.isError).toBe(true);
    expect(text(r as never)).toContain('revision 1');
  });

  it('reads a single file', async () => {
    const r = await handleCraftPage(ctx(), { command: 'read', slug: 'demo', filePath: 'styles.css' });
    expect(text(r as never)).toContain('a{color:red}');
  });

  it('lists pages', async () => {
    const r = await handleCraftPage(ctx(), { command: 'list' });
    expect(text(r as never)).toContain('demo');
  });

  it('reports an empty list without erroring', async () => {
    dataPath = mkdtempSync(join(tmpdir(), 'craft-page-empty-'));
    const r = await handleCraftPage(ctx(), { command: 'list' });
    expect(r.isError).toBeFalsy();
    expect(text(r as never)).toContain('No pages');
  });
});

describe('craft_page_delete', () => {
  beforeEach(async () => {
    await handleCraftPage(ctx(), {
      command: 'create', slug: 'demo', title: 'Demo',
      files: [{ path: 'index.html', content: '<h1>hi</h1>' }],
    });
  });

  it('refuses without confirm: true', async () => {
    const r = await handleCraftPageDelete(ctx(), { slug: 'demo', confirm: false });
    expect(r.isError).toBe(true);
    expect(text(r as never)).toContain('confirm: true');
    // and the page must survive
    const list = await handleCraftPage(ctx(), { command: 'list' });
    expect(text(list as never)).toContain('demo');
  });

  it('deletes with confirm and unregisters from the catalog', async () => {
    const r = await handleCraftPageDelete(ctx(), { slug: 'demo', confirm: true });
    expect(r.isError).toBeFalsy();
    expect(unregistered).toHaveLength(1);
    const list = await handleCraftPage(ctx(), { command: 'list' });
    expect(text(list as never)).toContain('No pages');
  });

  it('errors on an unknown slug', async () => {
    const r = await handleCraftPageDelete(ctx(), { slug: 'nope', confirm: true });
    expect(r.isError).toBe(true);
  });
});
