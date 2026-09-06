/**
 * Tests for the Bun-only SQLite page data store (bun:sqlite — these tests
 * run under `bun test`, which always has the module).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPageDataStore, PageDataStore, PAGE_DATA_MAX_KV_KEYS, PAGE_DATA_MAX_SERIES } from './data-store.ts';
import { getPageSnapshotPath, getPageStorePath } from './storage.ts';

describe('pages/data-store', () => {
  let workspaceDir: string;
  let store: PageDataStore;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'page-data-store-test-'));
    store = openPageDataStore(workspaceDir, 'dash');
  });

  afterEach(() => {
    store.close();
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  describe('key-value', () => {
    it('round-trips JSON values', () => {
      store.kvSet('summary', { total: 42, items: ['a', 'b'] });
      store.kvSet('label', 'hello');
      store.kvSet('nullish', null);

      expect(store.kvGet<{ total: number; items: string[] }>('summary')).toEqual({ total: 42, items: ['a', 'b'] });
      expect(store.kvGet<string>('label')).toBe('hello');
      expect(store.kvGet('nullish')).toBeNull();
      expect(store.kvGet('missing')).toBeUndefined();
    });

    it('overwrites, deletes, and lists entries', () => {
      store.kvSet('k', 1);
      store.kvSet('k', 2);
      store.kvSet('other', true);

      expect(store.kvGet<number>('k')).toBe(2);
      expect(store.kvEntries()).toEqual({ k: 2, other: true });
      expect(store.kvDelete('k')).toBe(true);
      expect(store.kvDelete('k')).toBe(false);
      expect(store.kvEntries()).toEqual({ other: true });
    });
  });

  describe('timeseries', () => {
    it('appends, ranges, and reports latest in ascending order', () => {
      store.seriesAppendMany('revenue', [
        { t: 300, v: 3 },
        { t: 100, v: 1 },
        { t: 200, v: 2 },
      ]);

      expect(store.seriesRange('revenue')).toEqual([
        { t: 100, v: 1 },
        { t: 200, v: 2 },
        { t: 300, v: 3 },
      ]);
      expect(store.seriesRange('revenue', { from: 150, to: 250 })).toEqual([{ t: 200, v: 2 }]);
      expect(store.seriesRange('revenue', { limit: 2 })).toEqual([
        { t: 200, v: 2 },
        { t: 300, v: 3 },
      ]);
      expect(store.seriesLatest('revenue')).toEqual({ t: 300, v: 3 });
      expect(store.seriesLatest('missing')).toBeUndefined();
      expect(store.seriesNames()).toEqual(['revenue']);
    });

    it('is idempotent on (series, t) and prunes old points', () => {
      store.seriesAppend('cpu', { t: 100, v: 1 });
      store.seriesAppend('cpu', { t: 100, v: 9 });
      expect(store.seriesRange('cpu')).toEqual([{ t: 100, v: 9 }]);

      store.seriesAppend('cpu', { t: 200, v: 2 });
      expect(store.seriesPrune('cpu', 150)).toBe(1);
      expect(store.seriesRange('cpu')).toEqual([{ t: 200, v: 2 }]);
    });

    it('defaults t to now', () => {
      const before = Date.now();
      store.seriesAppend('ticks', { v: 5 });
      const latest = store.seriesLatest('ticks')!;
      expect(latest.v).toBe(5);
      expect(latest.t).toBeGreaterThanOrEqual(before);
    });
  });

  describe('growth caps', () => {
    it('rejects the kv write that would exceed the key cap and rolls it back', () => {
      for (let i = 0; i < PAGE_DATA_MAX_KV_KEYS; i++) {
        store.kvSet(`k${i}`, i);
      }
      expect(() => store.kvSet('one-too-many', 1)).toThrow(/kv keys > max/);
      // Rolled back: the offending key is gone and the count did not grow.
      expect(store.kvGet('one-too-many')).toBeUndefined();
      expect(Object.keys(store.kvEntries()).length).toBe(PAGE_DATA_MAX_KV_KEYS);
      // Updating an EXISTING key at the cap is fine — no growth.
      store.kvSet('k0', 'updated');
      expect(store.kvGet<string>('k0')).toBe('updated');
    });

    it('rejects the series write that would exceed the series cap and rolls it back', () => {
      for (let i = 0; i < PAGE_DATA_MAX_SERIES; i++) {
        store.seriesAppend(`s${i}`, { t: 1, v: i });
      }
      expect(() => store.seriesAppend('one-too-many', { t: 1, v: 1 })).toThrow(/series > max/);
      expect(() => store.seriesAppendMany('one-too-many', [{ t: 1, v: 1 }, { t: 2, v: 2 }])).toThrow(/series > max/);
      expect(store.seriesNames().length).toBe(PAGE_DATA_MAX_SERIES);
      expect(store.seriesLatest('one-too-many')).toBeUndefined();
      // Appending to an EXISTING series at the cap is fine — no growth.
      store.seriesAppend('s0', { t: 2, v: 99 });
      expect(store.seriesLatest('s0')).toEqual({ t: 2, v: 99 });
    });
  });

  describe('snapshot export', () => {
    it('writes snapshot.json atomically with kv + capped series', () => {
      store.kvSet('total', 42);
      for (let i = 0; i < 10; i++) {
        store.seriesAppend('s', { t: i, v: i });
      }

      const snapshot = store.exportSnapshot({ maxPointsPerSeries: 3 });
      expect(snapshot.version).toBe(1);
      expect(snapshot.kv.total).toBe(42);
      // Newest 3 points, ascending
      expect(snapshot.series.s).toEqual([
        { t: 7, v: 7 },
        { t: 8, v: 8 },
        { t: 9, v: 9 },
      ]);

      const snapshotPath = getPageSnapshotPath(workspaceDir, 'dash');
      expect(existsSync(snapshotPath)).toBe(true);
      expect(existsSync(snapshotPath + '.tmp')).toBe(false);
      const onDisk = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
      expect(onDisk).toEqual(JSON.parse(JSON.stringify(snapshot)));
    });

    it('persists across store reopen (sqlite file is the working store)', () => {
      store.kvSet('persist', 'yes');
      store.close();

      store = openPageDataStore(workspaceDir, 'dash');
      expect(store.kvGet<string>('persist')).toBe('yes');
      expect(existsSync(getPageStorePath(workspaceDir, 'dash'))).toBe(true);
    });
  });
});
