// ============================================================================
// SQLite compat layer: bun:sqlite on Bun, node:sqlite on Node/Electron
// ============================================================================
// IMPORTANT: This module does a lazy runtime require so bundlers (esbuild)
// don't try to resolve bun:sqlite at bundle time.
//
// Usage: mark "bun:sqlite" as external in esbuild so the require() call
// is emitted into the bundle, then at runtime this module picks the right
// driver (bun:sqlite or node:sqlite).
// ============================================================================

function isBun() {
  return typeof (process as any).versions?.bun !== 'undefined';
}

function loadNative() {
  if (isBun()) {
    return require('bun:sqlite');
  }
  try {
    return require('node:sqlite');
  } catch {
    throw new Error('No SQLite module available (tried bun:sqlite and node:sqlite)');
  }
}

const native = loadNative();
const isBunRuntime = isBun();

/** Statement wrapper that normalises bun:sqlite vs node:sqlite APIs */
export class Statement {
  private inner: any;

  constructor(inner: any) {
    this.inner = inner;
  }

  get(...params: any[]) {
    return this.inner.get(...params);
  }

  all(...params: any[]) {
    return this.inner.all(...params);
  }

  run(...params: any[]) {
    return this.inner.run(...params);
  }

  finalize() {
    if (typeof this.inner.finalize === 'function') {
      this.inner.finalize();
    }
  }
}

/** Database wrapper that normalises bun:sqlite vs node:sqlite APIs */
export class Database {
  private inner: any;

  constructor(path: string, _opts?: { create?: boolean; readwrite?: boolean }) {
    if (isBunRuntime) {
      this.inner = new native.Database(path, { create: true, readwrite: true });
    } else {
      this.inner = new native.DatabaseSync(path);
      this.inner.exec('PRAGMA journal_mode = WAL');
      this.inner.exec('PRAGMA foreign_keys = ON');
      this.inner.exec('PRAGMA busy_timeout = 5000');
      this.inner.exec('PRAGMA cache_size = -4000');
    }
  }

  prepare(sql: string): Statement {
    return new Statement(this.inner.prepare(sql));
  }

  run(sql: string) {
    if (isBunRuntime) {
      return this.inner.run(sql);
    }
    return this.inner.exec(sql);
  }

  close() {
    this.inner.close();
  }

  [Symbol.dispose] = () => this.close();
}
