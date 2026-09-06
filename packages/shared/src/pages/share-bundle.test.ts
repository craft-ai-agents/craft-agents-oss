/**
 * Share-bundle invariants: exclusion-by-construction, explicit data opt-in,
 * size caps, grants acknowledgment, and the page_publish_token credential
 * key round-trip.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createPage, addPageGrant, getPagePath, recordPageThumbnail, savePageContent } from './storage.ts';
import { isPageGrantUsable } from './types.ts';
import {
  buildPageShareBundle,
  getShareSnapshotSizeBytes,
  scanPageShareData,
  scanSnapshotForSecretCandidates,
  pageShareErrorCode,
  PAGE_SHARE_MAX_CONTENT_BYTES,
} from './share-bundle.ts';
import { accountToCredentialId, credentialIdToAccount } from '../credentials/types.ts';

const HTML = '<!doctype html><html><body>bundle</body></html>';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'craft-share-bundle-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSnapshot(slug: string, value: unknown): void {
  const dataDir = join(getPagePath(root, slug), 'data');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'snapshot.json'), typeof value === 'string' ? value : JSON.stringify(value));
}

describe('buildPageShareBundle', () => {
  test('manifest is built field-by-field — local-only state cannot leak', () => {
    const page = createPage(root, {
      name: 'Leak Test',
      description: 'desc',
      kind: 'live',
      projectId: 'proj_secret',
      content: HTML,
      refresh: { cron: '*/5 * * * *', script: 'pages/leak-test/scripts/refresh.ts' },
    });
    addPageGrant(root, page.slug, {
      action: { kind: 'api', sourceSlug: 'gmail-secret-slug', method: 'GET', pathPattern: '/x' },
    });

    const bundle = buildPageShareBundle(root, page.slug, {
      includeData: false,
      viewOnlyAcknowledged: true,
    });

    // Exactly the allowlisted manifest fields — nothing else.
    expect(Object.keys(bundle.manifest).sort()).toEqual(
      ['contentDigest', 'description', 'includesData', 'kind', 'slug', 'title', 'version'].sort(),
    );
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('proj_secret');
    expect(serialized).not.toContain('gmail-secret-slug');
    expect(serialized).not.toContain('refresh.ts');
    expect(serialized).not.toContain(root); // no local paths
  });

  test('the cached-poster pointer never ships in the bundle', () => {
    const page = createPage(root, { name: 'Poster Excluded', kind: 'static', content: HTML });
    recordPageThumbnail(root, page.slug, {
      digest: page.contentDigest!,
      capturedAt: 1,
      width: 800,
      height: 500,
    });

    const bundle = buildPageShareBundle(root, page.slug, { includeData: false });
    expect(Object.keys(bundle.manifest)).not.toContain('thumbnail');
    expect(JSON.stringify(bundle)).not.toContain('thumbnail');
  });

  test('snapshot ships only on explicit opt-in and must be valid JSON', () => {
    const page = createPage(root, { name: 'Data Opt In', content: HTML });
    writeSnapshot(page.slug, { version: 1, generatedAt: 1, kv: { k: 'v' }, series: {} });

    const withoutData = buildPageShareBundle(root, page.slug, { includeData: false });
    expect(withoutData.snapshotJson).toBeUndefined();
    expect(withoutData.manifest.includesData).toBe(false);

    const withData = buildPageShareBundle(root, page.slug, { includeData: true });
    expect(withData.snapshotJson).toContain('"k"');
    expect(withData.manifest.includesData).toBe(true);

    writeSnapshot(page.slug, '{not-json');
    expect(() => buildPageShareBundle(root, page.slug, { includeData: true })).toThrow(
      /PAGE_SHARE_SNAPSHOT_INVALID/,
    );
    // Broken snapshot is irrelevant when data is not included.
    expect(buildPageShareBundle(root, page.slug, { includeData: false }).snapshotJson).toBeUndefined();
  });

  test('grants require the view-only acknowledgment', () => {
    const page = createPage(root, { name: 'Grant Ack', content: HTML });
    addPageGrant(root, page.slug, {
      action: { kind: 'mcp', sourceSlug: 'slack', toolName: 'post_message' },
    });
    expect(() => buildPageShareBundle(root, page.slug, { includeData: false })).toThrow(
      /PAGE_SHARE_ACTIONS_ACK_REQUIRED/,
    );
    expect(
      buildPageShareBundle(root, page.slug, { includeData: false, viewOnlyAcknowledged: true }).manifest.title,
    ).toBe('Grant Ack');
  });

  test('stale grants (older content version) do not require the ack', () => {
    const page = createPage(root, { name: 'Stale Grant', content: HTML });
    addPageGrant(root, page.slug, {
      action: { kind: 'mcp', sourceSlug: 'slack', toolName: 'post_message' },
    });
    // Content change stales the grant — locally inert, so nothing to acknowledge.
    savePageContent(root, page.slug, HTML.replace('bundle', 'bundle v2'));
    expect(
      buildPageShareBundle(root, page.slug, { includeData: false }).manifest.title,
    ).toBe('Stale Grant');
  });

  test('expired grants do not require the ack', () => {
    const page = createPage(root, { name: 'Expired Grant', content: HTML });
    addPageGrant(root, page.slug, {
      action: { kind: 'mcp', sourceSlug: 'slack', toolName: 'post_message' },
      ttlMs: -1000,
    });
    expect(
      buildPageShareBundle(root, page.slug, { includeData: false }).manifest.title,
    ).toBe('Expired Grant');
  });

  test('a script grant blocks publishing outright — the ack cannot rescue it', () => {
    const page = createPage(root, { name: 'Script Grant', content: HTML });
    addPageGrant(root, page.slug, {
      action: { kind: 'script', script: 'pages/script-grant/run.sh', runtime: 'bun' },
    });
    expect(() => buildPageShareBundle(root, page.slug, { includeData: false })).toThrow(
      /PAGE_SHARE_SCRIPT_GRANT/,
    );
    // Host command execution must never reach a public URL, ack or not.
    expect(() =>
      buildPageShareBundle(root, page.slug, { includeData: false, viewOnlyAcknowledged: true }),
    ).toThrow(/PAGE_SHARE_SCRIPT_GRANT/);
  });

  test('even a STALE script grant blocks publishing — remove it, never bypass it', () => {
    const page = createPage(root, { name: 'Stale Script Grant', content: HTML });
    addPageGrant(root, page.slug, {
      action: { kind: 'script', script: 'pages/stale-script-grant/run.sh' },
      ttlMs: -1000, // expired
    });
    savePageContent(root, page.slug, HTML.replace('bundle', 'bundle v2')); // and digest-stale
    expect(() =>
      buildPageShareBundle(root, page.slug, { includeData: false, viewOnlyAcknowledged: true }),
    ).toThrow(/PAGE_SHARE_SCRIPT_GRANT/);
  });

  test('enforces content size cap and missing-content/page errors', () => {
    const page = createPage(root, { name: 'Too Big' });
    expect(() => buildPageShareBundle(root, page.slug, { includeData: false })).toThrow(/PAGE_NO_CONTENT/);

    writeFileSync(join(getPagePath(root, page.slug), 'index.html'), 'x'.repeat(PAGE_SHARE_MAX_CONTENT_BYTES + 1));
    expect(() => buildPageShareBundle(root, page.slug, { includeData: false })).toThrow(/PAGE_SHARE_TOO_LARGE/);

    expect(() => buildPageShareBundle(root, 'does-not-exist', { includeData: false })).toThrow(/PAGE_NOT_FOUND/);
  });

  test('snapshot size helper and error-code extraction', () => {
    const page = createPage(root, { name: 'Size Helper', content: HTML });
    expect(getShareSnapshotSizeBytes(root, page.slug)).toBeNull();
    writeSnapshot(page.slug, { version: 1, generatedAt: 1, kv: {}, series: {} });
    expect(getShareSnapshotSizeBytes(root, page.slug)).toBeGreaterThan(10);

    expect(pageShareErrorCode(new Error('PAGE_SHARING_DISABLED: nope'))).toBe('PAGE_SHARING_DISABLED');
    expect(pageShareErrorCode(new Error('random failure'))).toBeNull();
  });
});

describe('isPageGrantUsable', () => {
  const grant = { contentDigest: 'digest-a', expiresAt: 1000 };

  test('usable only when digest matches and not expired', () => {
    expect(isPageGrantUsable(grant, 'digest-a', 999)).toBe(true);
    expect(isPageGrantUsable(grant, 'digest-b', 999)).toBe(false); // stale content
    expect(isPageGrantUsable(grant, 'digest-a', 1000)).toBe(false); // expired (boundary)
    expect(isPageGrantUsable(grant, 'digest-a', 1001)).toBe(false); // expired
  });

  test('a page without content makes nothing usable', () => {
    expect(isPageGrantUsable(grant, undefined, 0)).toBe(false);
  });
});

describe('page_publish_token credential id', () => {
  test('round-trips through account string encoding', () => {
    const id = { type: 'page_publish_token' as const, workspaceId: 'ws-1', name: 'page_ab12cd34' };
    const account = credentialIdToAccount(id);
    expect(account).toBe('page_publish_token::ws-1::page_ab12cd34');
    expect(accountToCredentialId(account)).toEqual(id);
  });

  test('malformed accounts are rejected', () => {
    expect(accountToCredentialId('page_publish_token::only-workspace')).toBeNull();
    expect(accountToCredentialId('page_publish_token::a::b::c')).toBeNull();
  });
});

describe('scanSnapshotForSecretCandidates / scanPageShareData', () => {
  test('flags credential-looking kv keys, nested keys, and series names', () => {
    const candidates = scanSnapshotForSecretCandidates(
      JSON.stringify({
        version: 1,
        generatedAt: 1,
        kv: {
          summary: { total: 42 },
          apiKey: 'sk-live-123',
          config: { nested: { authToken: 'abc' } },
          items: [{ password: 'x' }],
        },
        series: { 'token.usage': [{ t: 1, v: 2 }], 'ci.duration': [{ t: 1, v: 2 }] },
      }),
    );
    expect(candidates).toContain('kv.apiKey');
    expect(candidates).toContain('kv.config.nested.authToken');
    expect(candidates).toContain('kv.items.password'); // array items keep the parent path
    expect(candidates).toContain('series.token.usage');
    expect(candidates).not.toContain('kv.summary');
    expect(candidates.some((c) => c.includes('ci.duration'))).toBe(false);
  });

  test('clean snapshots, malformed JSON, and non-object roots report nothing', () => {
    expect(
      scanSnapshotForSecretCandidates(
        JSON.stringify({ version: 1, generatedAt: 1, kv: { total: 1 }, series: { revenue: [] } }),
      ),
    ).toEqual([]);
    expect(scanSnapshotForSecretCandidates('{not json')).toEqual([]);
    expect(scanSnapshotForSecretCandidates('"just a string"')).toEqual([]);
  });

  test('the candidate list is capped', () => {
    const kv: Record<string, string> = {};
    for (let i = 0; i < 50; i++) kv[`apiKey${i}`] = 'x';
    const candidates = scanSnapshotForSecretCandidates(JSON.stringify({ version: 1, generatedAt: 1, kv, series: {} }));
    expect(candidates.length).toBe(20);
  });

  test('scanPageShareData reads the snapshot once and pairs size with candidates', () => {
    const page = createPage(root, { name: 'Scan Me', kind: 'live', content: HTML });
    expect(scanPageShareData(root, page.slug)).toEqual({ snapshotBytes: null, secretCandidates: [] });

    writeSnapshot(page.slug, { version: 1, generatedAt: 1, kv: { webhookSecret: 'shh', safe: 1 }, series: {} });
    const scan = scanPageShareData(root, page.slug);
    expect(scan.snapshotBytes).toBeGreaterThan(0);
    expect(scan.secretCandidates).toEqual(['kv.webhookSecret']);
  });
});
