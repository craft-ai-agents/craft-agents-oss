import { describe, expect, it, beforeEach } from 'bun:test';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleCraftPage, handleCraftPageDelete } from './craft-page.ts';
import type { SessionToolContext, PageCatalogEntry } from '../context.ts';

let dataPath: string;
let workspacePath: string;
let registered: PageCatalogEntry[];
let unregistered: string[];

function ctx(withCatalog = true): SessionToolContext {
  const base = {
    sessionId: 'sess-1',
    workspacePath,
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
  workspacePath = mkdtempSync(join(tmpdir(), 'craft-page-ws-'));
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

describe('requesting live data', () => {
  const FILES = [{ path: 'index.html', content: '<h1>x</h1>' }];
  const QUERY = {
    name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages',
    fixedArgs: { maxResults: 25 }, paramSchema: { q: { type: 'string', maxLength: 64 } },
  };

  it('records the request on the manifest without granting anything', async () => {
    const r = await handleCraftPage(ctx(), {
      command: 'create', slug: 'dash', title: 'Dash', files: FILES, queries: [QUERY],
    });
    expect(r.isError).toBeFalsy();

    const read = await handleCraftPage(ctx(), { command: 'read', slug: 'dash' });
    expect(text(read)).toContain('unread');

    // The tool must be explicit that this is a request awaiting the user, not
    // access the page already has — otherwise the model tells the user the
    // dashboard is live when it is inert.
    expect(text(r)).toMatch(/approv/i);
  });

  it('tells the agent which queries are pending so it can say so', async () => {
    const r = await handleCraftPage(ctx(), {
      command: 'create', slug: 'dash', title: 'Dash', files: FILES, queries: [QUERY],
    });
    expect(text(r)).toContain('gmail.list_messages');
  });

  it('creates no page at all when a query is malformed', async () => {
    const r = await handleCraftPage(ctx(), {
      command: 'create', slug: 'dash', title: 'Dash', files: FILES,
      queries: [{ name: 'bad name', sourceSlug: 'gmail', toolName: 'list_messages' }],
    });
    expect(r.isError).toBe(true);

    // Partial creation would leave a page whose requested queries silently
    // differ from what the agent wrote.
    const list = await handleCraftPage(ctx(), { command: 'list' });
    expect(text(list)).not.toContain('dash');
    expect(registered).toHaveLength(0);
  });

  it('replaces the whole set on update, so a removed query loses its request', async () => {
    await handleCraftPage(ctx(), {
      command: 'create', slug: 'dash', title: 'Dash', files: FILES, queries: [QUERY],
    });
    const r = await handleCraftPage(ctx(), {
      command: 'update', slug: 'dash', files: FILES,
      queries: [{ name: 'recent', sourceSlug: 'linear', toolName: 'list_issues' }],
    });
    expect(r.isError).toBeFalsy();

    const read = await handleCraftPage(ctx(), { command: 'read', slug: 'dash' });
    expect(text(read)).toContain('recent');
    expect(text(read)).not.toContain('unread');
  });

  it('leaves the existing set alone when update omits queries', async () => {
    // Editing CSS must not silently drop the page's data access.
    await handleCraftPage(ctx(), {
      command: 'create', slug: 'dash', title: 'Dash', files: FILES, queries: [QUERY],
    });
    await handleCraftPage(ctx(), {
      command: 'update', slug: 'dash', files: [{ path: 'a.css', content: 'h1{}' }],
    });
    const read = await handleCraftPage(ctx(), { command: 'read', slug: 'dash' });
    expect(text(read)).toContain('unread');
  });

  it('drops every request when update passes an empty array', async () => {
    await handleCraftPage(ctx(), {
      command: 'create', slug: 'dash', title: 'Dash', files: FILES, queries: [QUERY],
    });
    await handleCraftPage(ctx(), { command: 'update', slug: 'dash', files: FILES, queries: [] });
    const read = await handleCraftPage(ctx(), { command: 'read', slug: 'dash' });
    expect(text(read)).not.toContain('unread');
  });

  it('says nothing about approval for a page that requests nothing', async () => {
    const r = await handleCraftPage(ctx(), {
      command: 'create', slug: 'plain', title: 'Plain', files: FILES,
    });
    expect(text(r)).not.toMatch(/approv/i);
  });
});

describe('craft_page export', () => {
  const FILES = [{ path: 'index.html', content: '<h1>x</h1>' }];

  it('exports to a folder under the workspace and reports where', async () => {
    await handleCraftPage(ctx(), { command: 'create', slug: 'site', title: 'Site', files: FILES });
    const r = await handleCraftPage(ctx(), { command: 'export', slug: 'site' });

    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain('site');
    expect(existsSync(join(workspacePath, 'exports', 'site', 'index.html'))).toBe(true);
  });

  it('does not let the agent choose where the files land', async () => {
    // The destination is derived, never supplied. An agent-chosen path is a
    // write anywhere on disk wearing an "export" label.
    await handleCraftPage(ctx(), { command: 'create', slug: 'site', title: 'Site', files: FILES });
    const r = await handleCraftPage(ctx(), {
      command: 'export', slug: 'site',
      destination: '/tmp/anywhere', outputDir: '../../etc',
    } as never);

    expect(r.isError).toBeFalsy();
    expect(existsSync(join(workspacePath, 'exports', 'site', 'index.html'))).toBe(true);
    expect(existsSync('/tmp/anywhere')).toBe(false);
  });

  it('warns that live queries stop working once exported', async () => {
    // Silence here means the user opens the export, sees an empty dashboard,
    // and concludes the export is broken.
    await handleCraftPage(ctx(), {
      command: 'create', slug: 'dash', title: 'Dash', files: FILES,
      queries: [{ name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages' }],
    });
    const r = await handleCraftPage(ctx(), { command: 'export', slug: 'dash' });

    expect(text(r)).toContain('unread');
    expect(text(r)).toMatch(/live data|will not|no longer|offline/i);
  });

  it('says nothing about live data for a static page', async () => {
    await handleCraftPage(ctx(), { command: 'create', slug: 'site', title: 'Site', files: FILES });
    expect(text(await handleCraftPage(ctx(), { command: 'export', slug: 'site' })))
      .not.toMatch(/live data/i);
  });

  it('requires a slug', async () => {
    expect((await handleCraftPage(ctx(), { command: 'export' })).isError).toBe(true);
  });

  it('reports a missing page as an error rather than an empty export', async () => {
    expect((await handleCraftPage(ctx(), { command: 'export', slug: 'nope' })).isError).toBe(true);
  });

  it('needs a workspace path, and says so', async () => {
    const noWorkspace = { sessionId: 's', dataPath } as unknown as SessionToolContext;
    const r = await handleCraftPage(noWorkspace, { command: 'export', slug: 'site' });
    expect(r.isError).toBe(true);
  });
});
