/**
 * Page Data Store — BUN-ONLY (bun:sqlite)
 *
 * Working store for page refresh scripts: a small key-value + timeseries
 * layer over SQLite at pages/{slug}/data/store.sqlite.
 *
 * ⚠️ Runtime contract — read before importing:
 * - This module statically imports `bun:sqlite`, which exists ONLY under the
 *   Bun runtime. The Electron main process (Node) must NEVER import it —
 *   that is why it is exported solely as the '@craft-agent/shared/pages/data-store'
 *   subpath and deliberately NOT re-exported from '@craft-agent/shared/pages'.
 * - The SQLite file is script-private. The cross-process contract is
 *   data/snapshot.json (atomically written by exportSnapshot); hosts read
 *   only the snapshot, and page.json is the completion marker they watch.
 *
 * Typical refresh script:
 *   const store = openPageDataStore(process.env.CRAFT_WORKSPACE_PATH!, process.env.CRAFT_PAGE_SLUG!);
 *   store.kvSet('summary', { total: 42 });
 *   store.seriesAppend('revenue', { v: 1234.5 });
 *   store.exportSnapshot();   // writes snapshot.json atomically
 *   store.close();
 *   // executor then records the run on page.json → watcher → pages:changed
 */

import { Database } from 'bun:sqlite';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';
import type { PageDataSnapshot, PageSeriesPoint } from '@craft-agent/core';
import { atomicWriteFileSync } from '../utils/files.ts';
import { getPageSnapshotPath, getPageStorePath, PAGE_SNAPSHOT_FILENAME } from './storage.ts';
import {
  DEFAULT_SNAPSHOT_MAX_POINTS_PER_SERIES,
  PAGE_DATA_MAX_KV_KEYS,
  PAGE_DATA_MAX_SERIES,
} from './data-store-constants.ts';

export { DEFAULT_SNAPSHOT_MAX_POINTS_PER_SERIES, PAGE_DATA_MAX_KV_KEYS, PAGE_DATA_MAX_SERIES };

interface KvRow {
  key: string;
  value: string;
}

interface SeriesRow {
  t: number;
  v: number;
}

export interface SeriesRangeOptions {
  /** Inclusive lower bound on t */
  from?: number;
  /** Inclusive upper bound on t */
  to?: number;
  /** Max points returned (newest kept, ascending order) */
  limit?: number;
}

export interface ExportSnapshotOptions {
  maxPointsPerSeries?: number;
}

export class PageDataStore {
  private readonly db: Database;
  private readonly snapshotPath: string;

  constructor(dbPath: string, snapshotPath?: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.snapshotPath = snapshotPath ?? join(dirname(dbPath), PAGE_SNAPSHOT_FILENAME);
    this.db = new Database(dbPath);
    // busy_timeout MUST be set before switching to WAL: on a brand-new db,
    // concurrent first-writers each need the exclusive lock to flip journal_mode,
    // and without a timeout that contends immediately as SQLITE_BUSY. Setting it
    // first makes the WAL switch (and every later write) wait instead of failing
    // (refresh script vs. agent write_page_data).
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS timeseries (
        series TEXT NOT NULL,
        t INTEGER NOT NULL,
        v REAL NOT NULL,
        PRIMARY KEY (series, t)
      ) WITHOUT ROWID;
    `);
  }

  // ==========================================================
  // Growth caps (post-write, inside the write transaction)
  // ==========================================================

  /** @throws when the kv table exceeds PAGE_DATA_MAX_KV_KEYS */
  private assertKvCap(): void {
    const row = this.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM kv').get();
    if ((row?.n ?? 0) > PAGE_DATA_MAX_KV_KEYS) {
      throw new Error(
        `Page data store limit exceeded: ${row!.n} kv keys > max ${PAGE_DATA_MAX_KV_KEYS}. Delete unused keys (kvDelete) instead of growing the store.`,
      );
    }
  }

  /** @throws when distinct series exceed PAGE_DATA_MAX_SERIES */
  private assertSeriesCap(): void {
    const row = this.db.query<{ n: number }, []>('SELECT COUNT(DISTINCT series) AS n FROM timeseries').get();
    if ((row?.n ?? 0) > PAGE_DATA_MAX_SERIES) {
      throw new Error(
        `Page data store limit exceeded: ${row!.n} series > max ${PAGE_DATA_MAX_SERIES}. Reuse series names; prune old ones (seriesPrune) instead of growing the store.`,
      );
    }
  }

  // ==========================================================
  // Key-value
  // ==========================================================

  /** Set a key to any JSON-serializable value. @throws over PAGE_DATA_MAX_KV_KEYS (write rolled back) */
  kvSet(key: string, value: unknown): void {
    const run = this.db.transaction(() => {
      this.db
        .query('INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .run(key, JSON.stringify(value ?? null), Date.now());
      this.assertKvCap();
    });
    run();
  }

  /** Get a key's value, or undefined when absent. */
  kvGet<T = unknown>(key: string): T | undefined {
    const row = this.db.query<KvRow, [string]>('SELECT key, value FROM kv WHERE key = ?1').get(key);
    if (!row) return undefined;
    return JSON.parse(row.value) as T;
  }

  /** Delete a key. Returns true if it existed. */
  kvDelete(key: string): boolean {
    const result = this.db.query('DELETE FROM kv WHERE key = ?1').run(key);
    return result.changes > 0;
  }

  /** All key-value entries (values JSON-parsed). */
  kvEntries(): Record<string, unknown> {
    const rows = this.db.query<KvRow, []>('SELECT key, value FROM kv ORDER BY key').all();
    const entries: Record<string, unknown> = {};
    for (const row of rows) {
      entries[row.key] = JSON.parse(row.value);
    }
    return entries;
  }

  // ==========================================================
  // Timeseries
  // ==========================================================

  /**
   * Append a datapoint (t defaults to now). Writing an existing (series, t)
   * overwrites its value, so re-runs are idempotent.
   * @throws over PAGE_DATA_MAX_SERIES (write rolled back)
   */
  seriesAppend(series: string, point: { t?: number; v: number }): void {
    const run = this.db.transaction(() => {
      this.db
        .query('INSERT INTO timeseries (series, t, v) VALUES (?1, ?2, ?3) ON CONFLICT(series, t) DO UPDATE SET v = excluded.v')
        .run(series, point.t ?? Date.now(), point.v);
      this.assertSeriesCap();
    });
    run();
  }

  /** Append many datapoints in one transaction. @throws over PAGE_DATA_MAX_SERIES (batch rolled back) */
  seriesAppendMany(series: string, points: Array<{ t?: number; v: number }>): void {
    const insert = this.db
      .query('INSERT INTO timeseries (series, t, v) VALUES (?1, ?2, ?3) ON CONFLICT(series, t) DO UPDATE SET v = excluded.v');
    const run = this.db.transaction((batch: Array<{ t?: number; v: number }>) => {
      for (const point of batch) {
        insert.run(series, point.t ?? Date.now(), point.v);
      }
      this.assertSeriesCap();
    });
    run(points);
  }

  /** Points of a series in ascending t order, optionally bounded/limited. */
  seriesRange(series: string, options: SeriesRangeOptions = {}): PageSeriesPoint[] {
    const from = options.from ?? Number.MIN_SAFE_INTEGER;
    const to = options.to ?? Number.MAX_SAFE_INTEGER;
    if (options.limit !== undefined) {
      // Keep the newest `limit` points, returned ascending.
      const rows = this.db
        .query<SeriesRow, [string, number, number, number]>(
          'SELECT t, v FROM timeseries WHERE series = ?1 AND t >= ?2 AND t <= ?3 ORDER BY t DESC LIMIT ?4',
        )
        .all(series, from, to, options.limit);
      return rows.reverse();
    }
    return this.db
      .query<SeriesRow, [string, number, number]>(
        'SELECT t, v FROM timeseries WHERE series = ?1 AND t >= ?2 AND t <= ?3 ORDER BY t ASC',
      )
      .all(series, from, to);
  }

  /** Newest datapoint of a series, or undefined when empty. */
  seriesLatest(series: string): PageSeriesPoint | undefined {
    return (
      this.db
        .query<SeriesRow, [string]>('SELECT t, v FROM timeseries WHERE series = ?1 ORDER BY t DESC LIMIT 1')
        .get(series) ?? undefined
    );
  }

  /** All series names. */
  seriesNames(): string[] {
    return this.db
      .query<{ series: string }, []>('SELECT DISTINCT series FROM timeseries ORDER BY series')
      .all()
      .map((row) => row.series);
  }

  /** Delete points older than `beforeT` (exclusive). Returns deleted count. */
  seriesPrune(series: string, beforeT: number): number {
    const result = this.db.query('DELETE FROM timeseries WHERE series = ?1 AND t < ?2').run(series, beforeT);
    return result.changes;
  }

  // ==========================================================
  // Snapshot export
  // ==========================================================

  /**
   * Export the current store contents to data/snapshot.json (atomic write:
   * tmp + rename). This is the ONLY artifact other processes read.
   */
  exportSnapshot(options: ExportSnapshotOptions = {}): PageDataSnapshot {
    const maxPoints = options.maxPointsPerSeries ?? DEFAULT_SNAPSHOT_MAX_POINTS_PER_SERIES;
    const series: Record<string, PageSeriesPoint[]> = {};
    let kv: PageDataSnapshot['kv'] = {};

    // Read every series + kv inside ONE transaction so a concurrent writer
    // (another process sharing this store under WAL) cannot commit between the
    // seriesNames() listing and the per-series reads and yield a torn snapshot.
    this.db.transaction(() => {
      for (const name of this.seriesNames()) {
        series[name] = this.seriesRange(name, { limit: maxPoints });
      }
      kv = this.kvEntries();
    })();

    const snapshot: PageDataSnapshot = {
      version: 1,
      generatedAt: Date.now(),
      kv,
      series,
    };

    atomicWriteFileSync(this.snapshotPath, JSON.stringify(snapshot, null, 2));
    return snapshot;
  }

  /** Close the underlying SQLite handle. */
  close(): void {
    this.db.close();
  }
}

/**
 * Open (creating if needed) the data store for a page.
 * Path layout comes from pages/storage.ts so scripts and host agree.
 */
export function openPageDataStore(workspaceRootPath: string, pageSlug: string): PageDataStore {
  return new PageDataStore(
    getPageStorePath(workspaceRootPath, pageSlug),
    getPageSnapshotPath(workspaceRootPath, pageSlug),
  );
}
