import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPage, getPageSnapshotPath, getPageStorePath, loadPageConfig } from './storage.ts';
import {
  applyPageDataPatch,
  writePageData,
  validatePageDataPatch,
  PAGE_DATA_PATCH_MAX_BYTES,
} from './data-write.ts';
import { PageDataStore, PAGE_DATA_MAX_KV_KEYS, PAGE_DATA_MAX_SERIES } from './data-store.ts';
import type { PageDataSnapshot } from '@craft-agent/core';

// Pin dev-mode runtime resolution: this suite spawns the real Bun runtime via
// resolveScriptRuntime and must assert dev behavior (PATH fallback allowed)
// even when the suite runs under a packaged Craft Agents host (agent Bash
// sessions inherit CRAFT_IS_PACKAGED=true).
const SAVED_IS_PACKAGED = process.env.CRAFT_IS_PACKAGED;
beforeAll(() => {
  process.env.CRAFT_IS_PACKAGED = '0';
});
afterAll(() => {
  if (SAVED_IS_PACKAGED === undefined) delete process.env.CRAFT_IS_PACKAGED;
  else process.env.CRAFT_IS_PACKAGED = SAVED_IS_PACKAGED;
});

describe('page data write (spawned Bun one-shot)', () => {
  let workspace: string;
  let slug: string;

  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), 'craft-data-write-'));
    slug = createPage(workspace, { name: 'Write Target', kind: 'live' }).slug;
  });
  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  function readSnapshot(): PageDataSnapshot {
    return JSON.parse(readFileSync(getPageSnapshotPath(workspace, slug), 'utf-8'));
  }

  it('applies kv + series writes and exports a snapshot the host can read', async () => {
    const result = await applyPageDataPatch(workspace, slug, {
      set: { summary: { total: 42 }, label: 'hello' },
      appendSeries: { 'ci.duration': [{ t: 1000, v: 10 }, { t: 2000, v: 20 }] },
    });

    expect(result.kvCount).toBe(2);
    expect(result.seriesCount).toBe(1);

    const snapshot = readSnapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.generatedAt).toBe(result.generatedAt);
    expect(snapshot.kv).toEqual({ label: 'hello', summary: { total: 42 } });
    expect(snapshot.series['ci.duration']).toEqual([{ t: 1000, v: 10 }, { t: 2000, v: 20 }]);
  });

  it('is parity-compatible with the bun:sqlite data store in BOTH directions', async () => {
    // data-store (the refresh-script engine) can read what the writer wrote…
    const store = new PageDataStore(getPageStorePath(workspace, slug));
    expect(store.kvGet<string>('label')).toBe('hello');
    expect(store.seriesRange('ci.duration')).toEqual([{ t: 1000, v: 10 }, { t: 2000, v: 20 }]);

    // …and the writer composes with data written by the data store.
    store.kvSet('fromStore', true);
    store.seriesAppend('ci.duration', { t: 3000, v: 30 });
    store.close();

    await applyPageDataPatch(workspace, slug, {
      set: { fromWriter: 1 },
      appendSeries: { 'ci.duration': [{ t: 4000, v: 40 }] },
    });

    const snapshot = readSnapshot();
    expect(snapshot.kv.fromStore).toBe(true);
    expect(snapshot.kv.fromWriter).toBe(1);
    expect(snapshot.series['ci.duration']!.map((p) => p.t)).toEqual([1000, 2000, 3000, 4000]);

    // The exported shape matches what the data store itself would export.
    const verify = new PageDataStore(getPageStorePath(workspace, slug));
    const storeSnapshot = verify.exportSnapshot();
    verify.close();
    expect(storeSnapshot.kv).toEqual(snapshot.kv);
    expect(storeSnapshot.series).toEqual(snapshot.series);
  });

  it('upserts on (series, t), deletes kv keys, and prunes old points', async () => {
    await applyPageDataPatch(workspace, slug, {
      delete: ['label'],
      appendSeries: { 'ci.duration': [{ t: 2000, v: 99 }] }, // overwrite existing t
      pruneSeries: { 'ci.duration': 2000 },                  // drop t < 2000
    });

    const snapshot = readSnapshot();
    expect(snapshot.kv.label).toBeUndefined();
    expect(snapshot.series['ci.duration']).toEqual([
      { t: 2000, v: 99 },
      { t: 3000, v: 30 },
      { t: 4000, v: 40 },
    ]);
  });

  it('writePageData stamps the refresh marker on page.json LAST', async () => {
    const before = loadPageConfig(workspace, slug);
    const { result, config } = await writePageData(workspace, slug, { set: { stamped: true } });

    expect(result.pageSlug).toBe(slug);
    expect(config.lastRefresh?.ok).toBe(true);
    expect(config.updatedAt).toBeGreaterThanOrEqual(before!.updatedAt);
    // Marker written after the snapshot: observers reacting to page.json see complete data.
    expect(readSnapshot().kv.stamped).toBe(true);
    expect(loadPageConfig(workspace, slug)?.lastRefresh?.at).toBe(config.lastRefresh!.at);
  });

  it('concurrent writers never corrupt the snapshot and lose no writes (unique temp files)', async () => {
    const page = createPage(workspace, { name: 'Concurrent Writers', kind: 'live' }).slug;
    const N = 6;

    // Fire N writers at once at the SAME snapshot.json. With a fixed `.tmp`
    // name they race on snapshot.json.tmp → torn JSON / ENOENT. Unique temps
    // keep them disjoint; SQLite busy_timeout serializes the db commits.
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        applyPageDataPatch(workspace, page, {
          set: { [`k${i}`]: i },
          appendSeries: { s: [{ t: (i + 1) * 1000, v: i }] },
        }),
      ),
    );
    expect(results).toHaveLength(N);

    // The on-disk snapshot is whichever writer renamed last — it must always be
    // valid JSON (never torn/empty), even though it may not reflect all N yet.
    const snapshot = JSON.parse(readFileSync(getPageSnapshotPath(workspace, page), 'utf-8')) as PageDataSnapshot;
    expect(snapshot.version).toBe(1);

    // Every write committed: re-export after all writers finished sees all N.
    const store = new PageDataStore(getPageStorePath(workspace, page));
    const finalSnap = store.exportSnapshot();
    store.close();
    for (let i = 0; i < N; i++) expect(finalSnap.kv[`k${i}`]).toBe(i);
    expect(finalSnap.series.s?.length).toBe(N);
  });

  it('enforces the kv/series growth caps transactionally (violating patch rolls back whole)', async () => {
    const page = createPage(workspace, { name: 'Capped', kind: 'live' }).slug;

    // Seed two keys + one series, then push past both caps in single patches.
    await applyPageDataPatch(workspace, page, {
      set: { seedA: 1, seedB: 2 },
      appendSeries: { seed: [{ t: 1, v: 1 }] },
    });

    const kvOverflow: Record<string, unknown> = {};
    for (let i = 0; i < PAGE_DATA_MAX_KV_KEYS; i++) kvOverflow[`k${i}`] = i; // 2 seeds + 1000 > cap
    await expect(applyPageDataPatch(workspace, page, { set: kvOverflow }))
      .rejects.toThrow(/kv keys > max/);

    const seriesOverflow: Record<string, Array<{ t: number; v: number }>> = {};
    for (let i = 0; i < PAGE_DATA_MAX_SERIES; i++) seriesOverflow[`s${i}`] = [{ t: 1, v: i }]; // 1 seed + 100 > cap
    await expect(applyPageDataPatch(workspace, page, { appendSeries: seriesOverflow }))
      .rejects.toThrow(/series > max/);

    // Nothing from the failed patches survived — the whole transaction rolled back.
    const store = new PageDataStore(getPageStorePath(workspace, page));
    const after = store.exportSnapshot();
    store.close();
    expect(after.kv).toEqual({ seedA: 1, seedB: 2 });
    expect(Object.keys(after.series)).toEqual(['seed']);
  });

  it('rejects unknown pages and invalid patches without spawning', async () => {
    await expect(writePageData(workspace, 'nope', { set: { a: 1 } })).rejects.toThrow('Page not found');
    await expect(applyPageDataPatch(workspace, slug, {})).rejects.toThrow('no operations');
    await expect(applyPageDataPatch(workspace, slug, { appendSeries: { m: [{ v: Number.NaN }] } }))
      .rejects.toThrow('non-finite');
    await expect(applyPageDataPatch(workspace, slug, { pruneSeries: { m: 1.5 } }))
      .rejects.toThrow('integer timestamp');

    expect(validatePageDataPatch({ set: { big: 'x'.repeat(PAGE_DATA_PATCH_MAX_BYTES) } }))
      .toContain('exceeds');
  });
});
