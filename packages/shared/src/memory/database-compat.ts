// ============================================================================
// SQLite compat layer: bun:sqlite on Bun, better-sqlite3 on Node/Electron
// ============================================================================
// Only loads better-sqlite3 for Electron. Bun support removed for Electron builds.
// ============================================================================

let cachedDatabase: any = null;

/**
 * Resolve better-sqlite3 across the runtimes this bundle ends up in.
 *
 * The esbuild CJS bundle for Electron's main process is *supposed* to have a
 * module-scope `require`, but depending on how the entry is loaded (ESM→CJS
 * translator, `--require` preload, subprocess) that binding is not always
 * present. Rather than assume one, try each strategy and surface every failure
 * so a load error is actually diagnosable.
 */
function loadBetterSqlite3(): any {
  const attempts: Array<[string, () => any]> = [
    // CJS module-scope require (normal Electron main process path)
    ['require', () => (typeof require === 'function' ? require('better-sqlite3') : undefined)],
    // module.require — present whenever this ran through a CJS wrapper
    [
      'module.require',
      () => {
        const m: any = typeof module !== 'undefined' ? module : undefined;
        return typeof m?.require === 'function' ? m.require('better-sqlite3') : undefined;
      },
    ],
    // Electron main entry's own require
    [
      'process.mainModule.require',
      () => {
        const req = (globalThis as any)?.process?.mainModule?.require;
        return typeof req === 'function' ? req('better-sqlite3') : undefined;
      },
    ],
    // Global require (Electron exposes this in some contexts)
    [
      'globalThis.require',
      () => {
        const req = (globalThis as any)?.require;
        return typeof req === 'function' ? req('better-sqlite3') : undefined;
      },
    ],
    // createRequire — last resort, reached only via an already-working require
    [
      'createRequire',
      () => {
        const bootstrap =
          (typeof require === 'function' && require) ||
          (typeof module !== 'undefined' && (module as any)?.require) ||
          (globalThis as any)?.process?.mainModule?.require;
        if (typeof bootstrap !== 'function') return undefined;
        const { createRequire } = bootstrap('node:module');
        const base = (globalThis as any)?.process?.cwd?.() ?? '.';
        return createRequire(`${base}/index.js`)('better-sqlite3');
      },
    ],
  ];

  const failures: string[] = [];
  for (const [name, attempt] of attempts) {
    try {
      const mod = attempt();
      if (mod) return mod;
      failures.push(`${name}: unavailable`);
    } catch (e) {
      failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  throw new Error(
    `Failed to load better-sqlite3 (install it with \`bun install better-sqlite3\`). Attempts — ${failures.join(' | ')}`,
  );
}

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
      cachedDatabase = loadBetterSqlite3();
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

  /**
   * Execute a statement. With bind parameters it goes through `prepare().run()`
   * (better-sqlite3's `exec` takes no parameters); without them it uses `exec`
   * so multi-statement SQL and PRAGMAs still work.
   */
  run(sql: string, ...params: any[]) {
    if (params.length > 0) {
      return this.inner.prepare(sql).run(...params);
    }
    return this.inner.exec(sql);
  }

  close() {
    this.inner.close();
  }

  [Symbol.dispose] = () => this.close();
}
