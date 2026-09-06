/**
 * Tests for page storage/CRUD.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deletePageWithUnpublish } from './publisher.ts';
import {
  createPage,
  updatePage,
  deletePage,
  loadPage,
  loadPageById,
  loadWorkspacePages,
  loadPageConfig,
  savePageConfig,
  pageExists,
  generatePageSlug,
  getPagePath,
  loadPageContent,
  savePageContent,
  computePageContentDigest,
  readPageDataSnapshot,
  recordPageRefresh,
  addPageGrant,
  revokePageGrant,
  getPageSnapshotPath,
  ensurePageDataDir,
  recordPageThumbnail,
  isThumbnailFresh,
} from './storage.ts';
import { isValidPageSlug, InvalidPageSlugError } from './validation.ts';
import { atomicWriteFileSync } from '../utils/files.ts';

describe('pages/storage', () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'pages-storage-test-'));
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  describe('slug validation (path traversal safety)', () => {
    const BAD_SLUGS = ['..', '../x', '../../etc', '/abs', 'a/b', 'a\\b', '', '.', 'UPPER', 'under_score', 'space bar'];

    it('isValidPageSlug accepts safe slugs and rejects unsafe ones', () => {
      expect(isValidPageSlug('my-page-1')).toBe(true);
      expect(isValidPageSlug('page')).toBe(true);
      for (const bad of BAD_SLUGS) expect(isValidPageSlug(bad)).toBe(false);
      expect(isValidPageSlug(undefined)).toBe(false);
      expect(isValidPageSlug(null)).toBe(false);
    });

    it('getPagePath throws on an unsafe slug (the single chokepoint)', () => {
      for (const bad of BAD_SLUGS) {
        expect(() => getPagePath(workspaceDir, bad)).toThrow(InvalidPageSlugError);
      }
      // A valid slug resolves under pages/ — the guard is not over-broad.
      expect(getPagePath(workspaceDir, 'ok')).toBe(join(workspaceDir, 'pages', 'ok'));
    });

    it('deletePage refuses a traversal slug and never touches the workspace tree', () => {
      const page = createPage(workspaceDir, { name: 'Keep Me', content: '<p>x</p>' });
      expect(() => deletePage(workspaceDir, '..')).toThrow(InvalidPageSlugError);
      expect(() => deletePage(workspaceDir, '../..')).toThrow(InvalidPageSlugError);
      // The workspace and the real page survive the rejected deletes.
      expect(existsSync(workspaceDir)).toBe(true);
      expect(pageExists(workspaceDir, page.slug)).toBe(true);
    });

    it('lenient readers treat an unsafe slug as not-found (no throw)', () => {
      for (const bad of BAD_SLUGS) {
        expect(loadPageConfig(workspaceDir, bad)).toBeNull();
        expect(loadPageContent(workspaceDir, bad)).toBeNull();
        expect(readPageDataSnapshot(workspaceDir, bad)).toBeNull();
        expect(pageExists(workspaceDir, bad)).toBe(false);
      }
    });
  });

  describe('thumbnail pointer (cached poster)', () => {
    it('records the pointer, freshness tracks contentDigest, and updatePage cannot touch it', () => {
      const page = createPage(workspaceDir, { name: 'Poster', kind: 'static', content: '<p>a</p>' });
      expect(page.contentDigest).toBeDefined();
      expect(isThumbnailFresh(page)).toBe(false); // none captured yet

      const stamped = recordPageThumbnail(workspaceDir, page.slug, {
        digest: page.contentDigest!,
        capturedAt: 123,
        width: 800,
        height: 500,
      });
      expect(stamped.thumbnail).toEqual({ digest: page.contentDigest!, capturedAt: 123, width: 800, height: 500 });
      expect(isThumbnailFresh(stamped)).toBe(true);

      // updatePage must not be able to set/clear the managed thumbnail field.
      const afterUpdate = updatePage(workspaceDir, page.slug, {
        // @ts-expect-error thumbnail is excluded from the updatePage patch type
        thumbnail: undefined,
        name: 'Renamed',
      });
      expect(afterUpdate.name).toBe('Renamed');
      expect(afterUpdate.thumbnail).toEqual(stamped.thumbnail);

      // A content change makes the existing poster stale (digest mismatch).
      const afterContent = savePageContent(workspaceDir, page.slug, '<p>changed</p>');
      expect(afterContent.thumbnail).toEqual(stamped.thumbnail); // pointer retained…
      expect(isThumbnailFresh(afterContent)).toBe(false); // …but now stale

      // Clearing the pointer.
      const cleared = recordPageThumbnail(workspaceDir, page.slug, undefined);
      expect(cleared.thumbnail).toBeUndefined();
    });
  });

  describe('create / load / update / delete', () => {
    it('creates a page with config, data dir, and optional content', () => {
      const config = createPage(workspaceDir, {
        name: 'Revenue Dashboard',
        description: 'KPIs',
        content: '<html><body>hi</body></html>',
        refresh: { cron: '*/5 * * * *', script: 'scripts/refresh.ts' },
      });

      expect(config.slug).toBe('revenue-dashboard');
      expect(config.id).toMatch(/^page_[0-9a-f-]{8}$/);
      expect(config.contentDigest).toBe(computePageContentDigest('<html><body>hi</body></html>'));
      expect(pageExists(workspaceDir, 'revenue-dashboard')).toBe(true);
      expect(existsSync(join(workspaceDir, 'pages', 'revenue-dashboard', 'data'))).toBe(true);
      expect(loadPageContent(workspaceDir, 'revenue-dashboard')).toBe('<html><body>hi</body></html>');

      const loaded = loadPage(workspaceDir, 'revenue-dashboard');
      expect(loaded?.config.name).toBe('Revenue Dashboard');
      expect(loaded?.dataPath).toBe(join(workspaceDir, 'pages', 'revenue-dashboard', 'data'));

      expect(loadPageById(workspaceDir, config.id)?.config.slug).toBe('revenue-dashboard');
    });

    it('generates unique slugs', () => {
      createPage(workspaceDir, { name: 'My Page' });
      createPage(workspaceDir, { name: 'My Page' });
      const slugs = loadWorkspacePages(workspaceDir).map((p) => p.config.slug).sort();
      expect(slugs).toEqual(['my-page', 'my-page-2']);
      expect(generatePageSlug(workspaceDir, 'My Page')).toBe('my-page-3');
    });

    it('updates metadata but never managed fields', () => {
      const created = createPage(workspaceDir, { name: 'Dash', content: 'v1' });
      const updated = updatePage(workspaceDir, created.slug, {
        name: 'Renamed',
        // @ts-expect-error managed field is excluded from the patch type
        contentDigest: 'ffff',
      });
      expect(updated.name).toBe('Renamed');
      expect(updated.contentDigest).toBe(computePageContentDigest('v1'));
    });

    it('updatePage: explicit null clears optional fields; absent keys leave them unchanged', () => {
      const created = createPage(workspaceDir, {
        name: 'Null Clears',
        kind: 'live',
        description: 'desc',
        projectId: 'proj_1',
        refresh: { cron: '*/10 * * * *', script: 'scripts/refresh.ts' },
      });

      // A patch WITHOUT the keys must not touch them.
      updatePage(workspaceDir, created.slug, { name: 'Renamed' });
      let cfg = loadPageConfig(workspaceDir, created.slug)!;
      expect(cfg.name).toBe('Renamed');
      expect(cfg.projectId).toBe('proj_1');
      expect(cfg.description).toBe('desc');
      expect(cfg.refresh?.cron).toBe('*/10 * * * *');

      // Explicit null clears — the literal value the pages:update RPC and the
      // update_page tool forward over JSON (undefined never survives transport).
      updatePage(workspaceDir, created.slug, { projectId: null });
      cfg = loadPageConfig(workspaceDir, created.slug)!;
      expect(cfg.projectId).toBeUndefined();
      expect(cfg.description).toBe('desc');

      updatePage(workspaceDir, created.slug, { description: null, refresh: null });
      cfg = loadPageConfig(workspaceDir, created.slug)!;
      expect(cfg.description).toBeUndefined();
      expect(cfg.refresh).toBeUndefined();
      // Truly absent on disk (valid optional), not stored as null.
      expect('projectId' in cfg).toBe(false);
      expect('refresh' in cfg).toBe(false);
    });

    it('rejects invalid configs on save', () => {
      expect(() =>
        savePageConfig(workspaceDir, {
          schemaVersion: 1,
          id: 'page_x',
          slug: 'Bad Slug!',
          name: 'x',
          kind: 'interactive',
          createdAt: 1,
          updatedAt: 1,
        }),
      ).toThrow(/Invalid page config/);
    });

    it('deletes the whole page folder', () => {
      const created = createPage(workspaceDir, { name: 'Gone', content: 'x' });
      deletePage(workspaceDir, created.slug);
      expect(pageExists(workspaceDir, created.slug)).toBe(false);
      expect(existsSync(join(workspaceDir, 'pages', created.slug))).toBe(false);
    });
  });

  describe('deletePageWithUnpublish local-delete failure', () => {
    // Fault injection via a read-only parent dir: meaningless as root (rm
    // succeeds anyway) and different semantics on win32 — skip there so the
    // test cannot false-fail in CI (it verifies the error message contract,
    // not platform chmod behavior).
    const canInjectFsFailure =
      process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0;

    (canInjectFsFailure ? it : it.skip)(
      'surfaces a contextual error when the local folder cannot be removed, then succeeds once it can',
      async () => {
        const created = createPage(workspaceDir, { name: 'Sticky', kind: 'static', content: '<p>x</p>' });
        const pagesDir = join(workspaceDir, 'pages');

        chmodSync(pagesDir, 0o555); // removing an entry needs write perm on the parent
        try {
          await expect(deletePageWithUnpublish(workspaceDir, 'ws-test', created.slug)).rejects.toThrow(
            /Deleting the local page folder failed/,
          );
        } finally {
          chmodSync(pagesDir, 0o755);
        }

        // Unshared page → no publisher involved; delete now completes cleanly.
        const outcome = await deletePageWithUnpublish(workspaceDir, 'ws-test', created.slug);
        expect(outcome.publicCopyMayRemain).toBe(false);
        expect(pageExists(workspaceDir, created.slug)).toBe(false);
      },
    );

    it('is a clean no-op outcome for a page that does not exist', async () => {
      const outcome = await deletePageWithUnpublish(workspaceDir, 'ws-test', 'never-existed');
      expect(outcome.publicCopyMayRemain).toBe(false);
    });
  });

  describe('content and digest', () => {
    it('savePageContent updates the digest (staling grants)', () => {
      const created = createPage(workspaceDir, { name: 'Dash', content: 'v1' });
      const grant = addPageGrant(workspaceDir, created.slug, {
        action: { kind: 'api', sourceSlug: 'github', method: 'GET', pathPattern: '/repos/.*' },
      });
      const updated = savePageContent(workspaceDir, created.slug, 'v2');

      expect(updated.contentDigest).toBe(computePageContentDigest('v2'));
      // Grant persists but is bound to the v1 digest — stale by design
      const persisted = loadPageConfig(workspaceDir, created.slug)!;
      expect(persisted.grants?.[0]?.id).toBe(grant.id);
      expect(persisted.grants?.[0]?.contentDigest).toBe(computePageContentDigest('v1'));
    });
  });

  describe('data snapshot + refresh recording', () => {
    it('reads a snapshot written to data/snapshot.json', () => {
      const created = createPage(workspaceDir, { name: 'Dash' });
      ensurePageDataDir(workspaceDir, created.slug);
      atomicWriteFileSync(
        getPageSnapshotPath(workspaceDir, created.slug),
        JSON.stringify({ version: 1, generatedAt: 123, kv: { total: 42 }, series: {} }),
      );
      const snapshot = readPageDataSnapshot(workspaceDir, created.slug);
      expect(snapshot?.kv.total).toBe(42);
      expect(readPageDataSnapshot(workspaceDir, 'missing')).toBeNull();
    });

    it('recordPageRefresh writes lastRefresh with capped error', () => {
      const created = createPage(workspaceDir, { name: 'Dash' });
      recordPageRefresh(workspaceDir, created.slug, {
        at: 111,
        ok: false,
        durationMs: 5,
        error: 'x'.repeat(5000),
      });
      const config = loadPageConfig(workspaceDir, created.slug)!;
      expect(config.lastRefresh?.ok).toBe(false);
      expect(config.lastRefresh?.error?.length).toBe(2000);
    });
  });

  describe('grants', () => {
    it('requires content before issuing a grant', () => {
      const created = createPage(workspaceDir, { name: 'NoContent' });
      expect(() =>
        addPageGrant(workspaceDir, created.slug, {
          action: { kind: 'mcp', sourceSlug: 'linear', toolName: 'create_issue' },
        }),
      ).toThrow(/no content/);
    });

    it('issues digest-bound expiring grants and revokes them', () => {
      const created = createPage(workspaceDir, { name: 'Dash', content: 'v1' });
      const grant = addPageGrant(workspaceDir, created.slug, {
        action: { kind: 'api', sourceSlug: 'github', method: 'POST', pathPattern: '/issues' },
        description: 'File issues',
        ttlMs: 60_000,
      });
      expect(grant.contentDigest).toBe(computePageContentDigest('v1'));
      expect(grant.expiresAt - grant.createdAt).toBe(60_000);

      expect(revokePageGrant(workspaceDir, created.slug, grant.id)).toBe(true);
      expect(revokePageGrant(workspaceDir, created.slug, grant.id)).toBe(false);
      expect(loadPageConfig(workspaceDir, created.slug)?.grants).toEqual([]);
    });
  });

  describe('atomicity marker', () => {
    it('page.json writes go through the .tmp+rename pattern', () => {
      // Indirect check: after a save there is no lingering .tmp file
      createPage(workspaceDir, { name: 'Dash' });
      const dir = join(workspaceDir, 'pages', 'dash');
      expect(existsSync(join(dir, 'page.json'))).toBe(true);
      expect(existsSync(join(dir, 'page.json.tmp'))).toBe(false);
      expect(JSON.parse(readFileSync(join(dir, 'page.json'), 'utf-8')).slug).toBe('dash');
    });
  });
});
