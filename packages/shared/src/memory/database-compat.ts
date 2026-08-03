// ============================================================================
// SQLite compat layer: bun:sqlite on Bun, better-sqlite3 on Node/Electron
// ============================================================================
// Under `bun test`, better-sqlite3's native .node addon panics Bun's NAPI at
// process exit ("NAPI FATAL ERROR: Error::New napi_get_last_error_info"), so we
// use bun:sqlite (built into the Bun runtime) when running under Bun. Electron
// production builds still load better-sqlite3.
// ============================================================================

let cachedDatabase: any = null;

/** True when the current process is Bun (its sqlite is bundled into the runtime). */
function isBunRuntime(): boolean {
  return typeof process !== 'undefined' && !!(process as any).versions?.bun;
}

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

/**
 * Resolve bun:sqlite. Loaded lazily via createRequire so this module can be
 * imported by Node/Electron too — the `bun:sqlite` specifier is never resolved
 * unless we're actually running under Bun.
 */
function loadBunSqlite(): any {
  const { createRequire } = requireNodeModule();
  const base = (globalThis as any)?.process?.cwd?.() ?? '.';
  const req = createRequire(`${base}/index.js`);
  return req('bun:sqlite');
}

/** createRequire available across both runtimes without top-level node: imports. */
function requireNodeModule(): { createRequire: (path: string) => NodeRequire } {
  const bootstrap =
    (typeof require === 'function' && require) ||
    (typeof module !== 'undefined' && (module as any)?.require) ||
    (globalThis as any)?.process?.mainModule?.require;
  if (typeof bootstrap === 'function') {
    return bootstrap('node:module');
  }
  throw new Error('No require available to load node:module');
}

/** Resolve the sqlite driver appropriate for the current runtime. */
function loadSqliteDriver(): any {
  if (isBunRuntime()) {
    const sqlite = loadBunSqlite();
    return sqlite.Database ?? sqlite;
  }
  return loadBetterSqlite3();
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

/** Database wrapper for better-sqlite3 / bun:sqlite */
export class Database {
  private inner: any;
  private bun: boolean;

  constructor(path: string, opts?: { create?: boolean; readwrite?: boolean }) {
    // Lazy-load the driver only when a Database is first created
    if (!cachedDatabase) {
      cachedDatabase = loadSqliteDriver();
    }
    this.bun = isBunRuntime();

    // Create database instance. bun:sqlite accepts {create, readwrite} options;
    // better-sqlite3 takes the path alone (create is implied).
    this.inner = this.bun ? new cachedDatabase(path, opts) : new cachedDatabase(path);

    // bun:sqlite exposes pragma() through exec(); better-sqlite3's pragma()
    // auto-prefixes `PRAGMA `, so exec needs the prefix added explicitly.
    const runPragma = (sql: string) => {
      if (this.bun) {
        this.inner.exec(`PRAGMA ${sql}`);
      } else {
        this.inner.pragma(sql);
      }
    };

    runPragma('journal_mode = WAL');
    runPragma('foreign_keys = ON');
    runPragma('busy_timeout = 5000');
    runPragma('cache_size = -4000');
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
