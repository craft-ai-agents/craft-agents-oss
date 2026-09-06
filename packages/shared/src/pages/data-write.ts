/**
 * Page Data Write — Node-safe patch application
 *
 * Applies a `PageDataPatch` (kv upserts/deletes + timeseries appends/prunes)
 * to a page's SQLite store and regenerates data/snapshot.json — WITHOUT ever
 * opening the SQLite file in the host process.
 *
 * How: a self-contained one-shot script is generated and argv-spawned under
 * the Bun runtime (resolveScriptRuntime, same primitive the automation script
 * action uses). This keeps the locked design intact — the store stays
 * script-private (`bun:sqlite`), hosts only ever read snapshot.json — and it
 * works identically whether the host is Electron main (Node) or the headless
 * server (Bun), in dev and packaged builds (CRAFT_BUN).
 *
 * ⚠️ The generated script duplicates the data-store schema/SQL on purpose
 * (it must not depend on module resolution from a temp directory). Parity
 * with pages/data-store.ts is pinned by data-write.test.ts — if you change
 * the schema or snapshot shape in one place, change BOTH and the test.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveScriptRuntime } from '@craft-agent/session-tools-core';
import type { PageConfig, PageDataSnapshot } from '@craft-agent/core';
import { createLogger } from '../utils/debug.ts';
import {
  getPageSnapshotPath,
  getPageStorePath,
  loadPageConfig,
  recordPageRefresh,
} from './storage.ts';
import {
  DEFAULT_SNAPSHOT_MAX_POINTS_PER_SERIES,
  PAGE_DATA_MAX_KV_KEYS,
  PAGE_DATA_MAX_SERIES,
} from './data-store-constants.ts';

const log = createLogger('page-data-write');

/** Per-run timeout for the one-shot writer (writes are small and local). */
const WRITE_TIMEOUT_MS = 30_000;
/** Grace between SIGTERM and SIGKILL (mirrors script-executor). */
const SIGKILL_GRACE_MS = 5_000;
/** Cap on the serialized patch embedded into the one-shot script. */
export const PAGE_DATA_PATCH_MAX_BYTES = 1024 * 1024;

/**
 * A batch of data mutations applied in ONE SQLite transaction.
 * Mirrors the data-store API: kv upserts are JSON values, series points are
 * `{ t?, v }` with idempotent `(series, t)` upserts.
 */
export interface PageDataPatch {
  /** KV upserts: key → any JSON-serializable value */
  set?: Record<string, unknown>;
  /** KV keys to delete */
  delete?: string[];
  /** Timeseries appends: series name → points ({ t? epoch ms, defaults to now; v number }) */
  appendSeries?: Record<string, Array<{ t?: number; v: number }>>;
  /** Timeseries prunes: series name → deleteBefore timestamp (removes points with t < value) */
  pruneSeries?: Record<string, number>;
}

/** Result of a successful patch application (parsed from the writer's stdout). */
export interface PageDataWriteResult {
  pageSlug: string;
  /** KV key count after the write */
  kvCount: number;
  /** Series count after the write */
  seriesCount: number;
  /** Snapshot regeneration timestamp (matches snapshot.generatedAt) */
  generatedAt: number;
  snapshotPath: string;
  durationMs: number;
}

/** Validate a patch shape beyond what schemas guarantee (finite numbers, non-empty keys). */
export function validatePageDataPatch(patch: PageDataPatch): string | null {
  const hasOps =
    (patch.set && Object.keys(patch.set).length > 0) ||
    (patch.delete && patch.delete.length > 0) ||
    (patch.appendSeries && Object.keys(patch.appendSeries).length > 0) ||
    (patch.pruneSeries && Object.keys(patch.pruneSeries).length > 0);
  if (!hasOps) return 'Patch has no operations (set / delete / appendSeries / pruneSeries all empty)';

  for (const key of Object.keys(patch.set ?? {})) {
    if (!key.trim()) return 'KV keys must be non-empty strings';
  }
  for (const key of patch.delete ?? []) {
    if (typeof key !== 'string' || !key.trim()) return 'delete entries must be non-empty strings';
  }
  for (const [series, points] of Object.entries(patch.appendSeries ?? {})) {
    if (!series.trim()) return 'Series names must be non-empty strings';
    for (const point of points) {
      if (typeof point.v !== 'number' || !Number.isFinite(point.v)) {
        return `Series "${series}" has a non-finite value`;
      }
      if (point.t !== undefined && (!Number.isFinite(point.t) || !Number.isInteger(point.t))) {
        return `Series "${series}" has a non-integer timestamp`;
      }
    }
  }
  for (const [series, beforeT] of Object.entries(patch.pruneSeries ?? {})) {
    if (!series.trim()) return 'Series names must be non-empty strings';
    if (!Number.isFinite(beforeT) || !Number.isInteger(beforeT)) {
      return `pruneSeries["${series}"] must be an integer timestamp`;
    }
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(patch);
  } catch {
    return 'Patch is not JSON-serializable';
  }
  if (Buffer.byteLength(serialized, 'utf-8') > PAGE_DATA_PATCH_MAX_BYTES) {
    return `Patch exceeds ${PAGE_DATA_PATCH_MAX_BYTES} bytes when serialized`;
  }
  return null;
}

/**
 * Build the self-contained one-shot writer script.
 *
 * Everything (paths, patch, caps) is embedded as a JSON literal — the script
 * imports only Bun/Node built-ins so it runs from a temp directory with zero
 * module resolution. SQL and snapshot shape MUST stay in lockstep with
 * pages/data-store.ts (see the parity test).
 */
export function buildPageDataWriterScript(input: {
  dbPath: string;
  snapshotPath: string;
  patch: PageDataPatch;
  maxPointsPerSeries: number;
  maxKvKeys: number;
  maxSeries: number;
}): string {
  // Double-stringify → a JS string literal containing JSON; JSON.parse at
  // runtime sidesteps every code-injection / literal-escaping edge case.
  const inputLiteral = JSON.stringify(JSON.stringify(input));
  return `// Generated by @craft-agent/shared/pages/data-write — self-contained on purpose.
import { Database } from 'bun:sqlite';
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const INPUT = JSON.parse(${inputLiteral});
const patch = INPUT.patch;

mkdirSync(dirname(INPUT.dbPath), { recursive: true });
const db = new Database(INPUT.dbPath);
// busy_timeout before WAL: concurrent first-writers each need the exclusive
// lock to flip journal_mode, which contends immediately as SQLITE_BUSY without
// a timeout set first. (Kept in lockstep with pages/data-store.ts.)
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec(\`
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
\`);

const kvUpsert = db.query('INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
const kvDelete = db.query('DELETE FROM kv WHERE key = ?1');
const seriesUpsert = db.query('INSERT INTO timeseries (series, t, v) VALUES (?1, ?2, ?3) ON CONFLICT(series, t) DO UPDATE SET v = excluded.v');
const seriesPrune = db.query('DELETE FROM timeseries WHERE series = ?1 AND t < ?2');

const applyAll = db.transaction(() => {
  for (const [key, value] of Object.entries(patch.set ?? {})) {
    kvUpsert.run(key, JSON.stringify(value ?? null), Date.now());
  }
  for (const key of patch.delete ?? []) {
    kvDelete.run(key);
  }
  for (const [series, points] of Object.entries(patch.appendSeries ?? {})) {
    for (const point of points) {
      seriesUpsert.run(series, point.t ?? Date.now(), point.v);
    }
  }
  for (const [series, beforeT] of Object.entries(patch.pruneSeries ?? {})) {
    seriesPrune.run(series, beforeT);
  }
  // Growth caps, post-write inside the transaction so a violating patch rolls
  // back whole. (Kept in lockstep with PageDataStore's assertKvCap/assertSeriesCap.)
  const kvCount = db.query('SELECT COUNT(*) AS n FROM kv').get().n;
  if (kvCount > INPUT.maxKvKeys) {
    throw new Error('Page data store limit exceeded: ' + kvCount + ' kv keys > max ' + INPUT.maxKvKeys + '. Delete unused keys instead of growing the store.');
  }
  const distinctSeries = db.query('SELECT COUNT(DISTINCT series) AS n FROM timeseries').get().n;
  if (distinctSeries > INPUT.maxSeries) {
    throw new Error('Page data store limit exceeded: ' + distinctSeries + ' series > max ' + INPUT.maxSeries + '. Reuse series names and prune old ones instead of growing the store.');
  }
});
applyAll();

// Snapshot export — mirrors PageDataStore.exportSnapshot exactly, including the
// single read transaction so a concurrent writer can't yield a torn snapshot.
const kv = {};
const series = {};
let seriesNames = [];
db.transaction(() => {
  for (const row of db.query('SELECT key, value FROM kv ORDER BY key').all()) {
    kv[row.key] = JSON.parse(row.value);
  }
  seriesNames = db.query('SELECT DISTINCT series FROM timeseries ORDER BY series').all().map((row) => row.series);
  for (const name of seriesNames) {
    const rows = db.query('SELECT t, v FROM timeseries WHERE series = ?1 ORDER BY t DESC LIMIT ?2').all(name, INPUT.maxPointsPerSeries);
    series[name] = rows.reverse();
  }
})();
const snapshot = { version: 1, generatedAt: Date.now(), kv, series };

// Unique temp name per writer (pid + random): a fixed '.tmp' collides when a
// refresh script and this host one-shot regenerate snapshot.json concurrently.
const tmpPath = INPUT.snapshotPath + '.' + process.pid + '.' + randomBytes(6).toString('hex') + '.tmp';
try {
  writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2));
  renameSync(tmpPath, INPUT.snapshotPath);
} catch (error) {
  try { unlinkSync(tmpPath); } catch {}
  throw error;
}
db.close();

console.log(JSON.stringify({
  ok: true,
  kvCount: Object.keys(kv).length,
  seriesCount: seriesNames.length,
  generatedAt: snapshot.generatedAt,
}));
`;
}

/** Minimal child env: platform essentials only — the script needs nothing else. */
function buildWriterEnv(): Record<string, string> {
  const essentials = process.platform === 'win32'
    ? ['USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']
    : ['HOME'];
  const env: Record<string, string> = {};
  for (const key of essentials) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Apply a data patch to a page's store and regenerate its snapshot.
 *
 * Pure data operation — does NOT touch page.json. Callers that want observers
 * to react (watcher → `pages:changed`) should use writePageData(), which
 * stamps the refresh marker as the LAST write, per the locked design.
 */
export async function applyPageDataPatch(
  workspaceRootPath: string,
  pageSlug: string,
  patch: PageDataPatch,
  options?: { maxPointsPerSeries?: number },
): Promise<Omit<PageDataWriteResult, 'pageSlug'>> {
  const validationError = validatePageDataPatch(patch);
  if (validationError) {
    throw new Error(`Invalid page data patch: ${validationError}`);
  }

  const runtime = resolveScriptRuntime('bun');
  const script = buildPageDataWriterScript({
    dbPath: getPageStorePath(workspaceRootPath, pageSlug),
    snapshotPath: getPageSnapshotPath(workspaceRootPath, pageSlug),
    patch,
    maxPointsPerSeries: options?.maxPointsPerSeries ?? DEFAULT_SNAPSHOT_MAX_POINTS_PER_SERIES,
    maxKvKeys: PAGE_DATA_MAX_KV_KEYS,
    maxSeries: PAGE_DATA_MAX_SERIES,
  });

  const startTime = Date.now();
  const tempDir = mkdtempSync(join(tmpdir(), 'craft-page-data-'));
  const scriptPath = join(tempDir, 'apply-patch.ts');
  try {
    writeFileSync(scriptPath, script, 'utf-8');

    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(runtime.command, [...runtime.argsPrefix, scriptPath], {
        cwd: workspaceRootPath,
        env: buildWriterEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });

      const termTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, WRITE_TIMEOUT_MS);
      const killTimer = setTimeout(() => {
        if (!child.killed || child.exitCode === null) child.kill('SIGKILL');
      }, WRITE_TIMEOUT_MS + SIGKILL_GRACE_MS);

      child.on('error', (error) => {
        clearTimeout(termTimer);
        clearTimeout(killTimer);
        reject(new Error(`Page data writer failed to spawn: ${error.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(termTimer);
        clearTimeout(killTimer);
        if (timedOut) {
          reject(new Error(`Page data write timed out after ${WRITE_TIMEOUT_MS}ms`));
        } else if (code !== 0) {
          reject(new Error(`Page data write failed (exit ${code}): ${stderr.trim().slice(0, 2000) || 'no stderr'}`));
        } else {
          resolve(stdout);
        }
      });
    });

    // The result is the last stdout line that parses as JSON with ok: true.
    const lines = output.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { ok?: boolean; kvCount?: number; seriesCount?: number; generatedAt?: number };
        if (parsed.ok === true) {
          return {
            kvCount: parsed.kvCount ?? 0,
            seriesCount: parsed.seriesCount ?? 0,
            generatedAt: parsed.generatedAt ?? Date.now(),
            snapshotPath: getPageSnapshotPath(workspaceRootPath, pageSlug),
            durationMs: Date.now() - startTime,
          };
        }
      } catch {
        // not the result line — keep scanning upward
      }
    }
    throw new Error('Page data writer produced no result line');
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/**
 * Apply a data patch AND stamp the refresh marker on page.json (LAST write),
 * so the config watcher broadcasts `pages:changed` and open renders receive
 * the new snapshot. This is the entry point for agent/tool-driven writes;
 * scheduled refresh scripts keep using the data-store directly (their
 * executor stamps the marker).
 */
export async function writePageData(
  workspaceRootPath: string,
  pageSlug: string,
  patch: PageDataPatch,
): Promise<{ result: PageDataWriteResult; config: PageConfig }> {
  const existing = loadPageConfig(workspaceRootPath, pageSlug);
  if (!existing) {
    throw new Error(`Page not found: ${pageSlug}`);
  }

  const applied = await applyPageDataPatch(workspaceRootPath, pageSlug, patch);
  const config = recordPageRefresh(workspaceRootPath, pageSlug, {
    at: Date.now(),
    ok: true,
    durationMs: applied.durationMs,
  });
  log.debug(`[writePageData] ${pageSlug}: kv=${applied.kvCount} series=${applied.seriesCount} in ${applied.durationMs}ms`);
  return { result: { pageSlug, ...applied }, config };
}

/** Re-export for snapshot readers that want the shared type. */
export type { PageDataSnapshot };
