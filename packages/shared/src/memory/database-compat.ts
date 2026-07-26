// ============================================================================
// SQLite compat layer: bun:sqlite on Bun, better-sqlite3 on Node/Electron
// ============================================================================
// Only loads better-sqlite3 for Electron. Bun support removed for Electron builds.
// ============================================================================

let cachedDatabase: any = null;

/** Statement wrapper that normalises better-sqlite3 API */
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

/** Database wrapper for better-sqlite3 */
export class Database {
  private inner: any;

  constructor(path: string, _opts?: { create?: boolean; readwrite?: boolean }) {
    // Lazy-load better-sqlite3 only when a Database is first created
    if (!cachedDatabase) {
      try {
        // Use require in a way that esbuild won't statically analyze
        const req = (0, eval)('require') as any;
        cachedDatabase = req('better-sqlite3');
      } catch (e) {
        throw new Error(
          `Failed to load better-sqlite3. Ensure it's installed with: npm install better-sqlite3 or bun install better-sqlite3. Error: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    // Create database instance
    this.inner = new cachedDatabase(path);

    // Set up PRAGMAs for optimal performance
    this.inner.pragma('journal_mode = WAL');
    this.inner.pragma('foreign_keys = ON');
    this.inner.pragma('busy_timeout = 5000');
    this.inner.pragma('cache_size = -4000');
  }

  prepare(sql: string): Statement {
    return new Statement(this.inner.prepare(sql));
  }

  run(sql: string) {
    return this.inner.exec(sql);
  }

  close() {
    this.inner.close();
  }

  [Symbol.dispose] = () => this.close();
}
