import { describe, expect, it, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createPage, updatePage, readPage, listPages, deletePage, currentRev, PageStoreError,
} from './store.ts';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'craft-pages-')); });

const html = (path = 'index.html', content = '<h1>hi</h1>') => ({ path, content });

describe('createPage', () => {
  it('creates revision 1 with a minted page id', () => {
    const r = createPage(root, { slug: 'demo', title: 'Demo', files: [html()] });
    expect(r.rev).toBe(1);
    expect(r.pageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(existsSync(join(root, 'demo', 'revisions', '1', 'public', 'index.html'))).toBe(true);
  });

  it('keeps the manifest OUTSIDE the served public/ tree', () => {
    createPage(root, { slug: 'demo', title: 'Demo', files: [html()] });
    expect(existsSync(join(root, 'demo', 'page.json'))).toBe(true);
    expect(existsSync(join(root, 'demo', 'revisions', '1', 'public', 'page.json'))).toBe(false);
  });

  it('requires index.html', () => {
    expect(() => createPage(root, { slug: 'demo', title: 'D', files: [html('home.html')] }))
      .toThrow(PageStoreError);
  });

  it('rejects a duplicate slug rather than clobbering', () => {
    createPage(root, { slug: 'demo', title: 'D', files: [html()] });
    expect(() => createPage(root, { slug: 'demo', title: 'D', files: [html()] })).toThrow(/already exists/);
  });

  it('rejects unsafe paths and slugs', () => {
    expect(() => createPage(root, { slug: 'Bad Slug', title: 'x', files: [html()] })).toThrow(PageStoreError);
    expect(() => createPage(root, { slug: 'ok', title: 'x', files: [html(), html('../escape.html')] }))
      .toThrow(PageStoreError);
  });

  it('writes binary assets via base64', () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
    const r = createPage(root, {
      slug: 'demo', title: 'D',
      files: [html(), { path: 'assets/x.png', content: png, encoding: 'base64' }],
    });
    expect(r.files).toContain('assets/x.png');
  });
});

describe('updatePage — revisions are immutable', () => {
  beforeEach(() => {
    createPage(root, { slug: 'demo', title: 'Demo', files: [html(), { path: 'styles.css', content: 'a{color:red}' }] });
  });

  it('creates a NEW revision and leaves the old one untouched', () => {
    const r = updatePage(root, { slug: 'demo', files: [{ path: 'styles.css', content: 'a{color:blue}' }] });
    expect(r.rev).toBe(2);
    expect(readPage(root, 'demo').rev).toBe(2);
    // rev 1 must still be byte-identical — this is what makes rollback possible
    // and what stops a half-written update corrupting what is being served.
    const old = join(root, 'demo', 'revisions', '1', 'public', 'styles.css');
    expect(Bun.file(old).text()).resolves.toBe('a{color:red}');
  });

  it('patch mode carries forward files it did not mention', () => {
    updatePage(root, { slug: 'demo', files: [{ path: 'styles.css', content: 'a{color:blue}' }] });
    const after = readPage(root, 'demo');
    // index.html was not in the update but must survive, or an agent editing
    // one file would silently destroy the rest of the page.
    expect(after.files).toContain('index.html');
    expect(after.files).toContain('styles.css');
  });

  it('replaceAll drops unmentioned files, but only when asked', () => {
    const r = updatePage(root, {
      slug: 'demo', replaceAll: true,
      files: [html('index.html', '<h1>new</h1>')],
    });
    expect(r.files).toEqual(['index.html']);
  });

  it('refuses a replaceAll that would remove index.html', () => {
    expect(() => updatePage(root, {
      slug: 'demo', replaceAll: true, files: [{ path: 'styles.css', content: 'x' }],
    })).toThrow(/index\.html/);
  });

  it('enforces expectedRev for optimistic concurrency', () => {
    expect(() => updatePage(root, {
      slug: 'demo', expectedRev: 99, files: [html()],
    })).toThrow(/expectedRev 99/);

    // correct rev succeeds
    expect(updatePage(root, { slug: 'demo', expectedRev: 1, files: [html()] }).rev).toBe(2);
  });

  it('rejects an unknown slug', () => {
    expect(() => updatePage(root, { slug: 'nope', files: [html()] })).toThrow(/not found/);
  });
});

describe('crash safety', () => {
  it('ignores an incomplete staging directory when resolving the current revision', () => {
    createPage(root, { slug: 'demo', title: 'D', files: [html()] });
    // Simulate a crash mid-write: a staging dir exists for a higher revision.
    const staging = join(root, 'demo', 'revisions', '.staging-2', 'public');
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, 'index.html'), '<h1>half written</h1>');

    // Must still report rev 1 — a partial revision is never served.
    expect(currentRev(root, 'demo')).toBe(1);
    expect(readPage(root, 'demo').rev).toBe(1);
  });

  it('sweeps stale staging directories on the next write', () => {
    createPage(root, { slug: 'demo', title: 'D', files: [html()] });
    mkdirSync(join(root, 'demo', 'revisions', '.staging-2'), { recursive: true });
    updatePage(root, { slug: 'demo', files: [html()] });
    const names = readdirSync(join(root, 'demo', 'revisions'));
    expect(names.some(n => n.startsWith('.staging-'))).toBe(false);
  });

  it('does not advance the revision when a write fails', () => {
    createPage(root, { slug: 'demo', title: 'D', files: [html()] });
    // Oversized file is rejected before anything is committed.
    expect(() => updatePage(root, {
      slug: 'demo',
      files: [{ path: 'big.txt', content: 'x'.repeat(3 * 1024 * 1024) }],
    })).toThrow(PageStoreError);
    expect(currentRev(root, 'demo')).toBe(1);
  });
});

describe('readPage / listPages / deletePage', () => {
  beforeEach(() => {
    createPage(root, { slug: 'a', title: 'A', files: [html()] });
    createPage(root, { slug: 'b', title: 'B', files: [html()] });
  });

  it('reads a named file from the current revision', () => {
    expect(readPage(root, 'a', 'index.html').content).toBe('<h1>hi</h1>');
  });

  it('refuses to read outside the page', () => {
    expect(() => readPage(root, 'a', '../../page.json')).toThrow(PageStoreError);
    expect(() => readPage(root, 'a', 'missing.html')).toThrow(/not in page/);
  });

  it('lists pages, newest first', () => {
    expect(listPages(root).map(p => p.slug).sort()).toEqual(['a', 'b']);
  });

  it('deletes a page and returns its id', () => {
    const id = readPage(root, 'a').manifest.id;
    expect(deletePage(root, 'a').pageId).toBe(id);
    expect(existsSync(join(root, 'a'))).toBe(false);
    expect(listPages(root).map(p => p.slug)).toEqual(['b']);
  });

  it('rejects deleting an unknown page', () => {
    expect(() => deletePage(root, 'nope')).toThrow(/not found/);
  });

  it('listPages tolerates junk directories', () => {
    mkdirSync(join(root, 'not-a-page'), { recursive: true });
    expect(() => listPages(root)).not.toThrow();
    expect(listPages(root).map(p => p.slug).sort()).toEqual(['a', 'b']);
  });
});
