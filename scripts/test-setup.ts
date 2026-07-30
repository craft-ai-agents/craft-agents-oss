/**
 * Bun test preload — stubs Vite-only module imports so renderer tests
 * can run under `bun test` without a Vite build step.
 *
 * Why this file exists
 * --------------------
 * Vite-only imports that bun's loader cannot resolve at runtime:
 *   - `?url` / `?worker` / `?raw` import suffixes
 *   - `import '*.css'` style side-effect imports
 *   - `import.meta.glob(...)` inside ThemeContext.tsx
 *
 * bun's `Bun.plugin()` only fires inside the bundler, NOT under `bun test`,
 * so we have to use `mock.module()` calls (which DO fire at test runtime).
 * Each problematic import specifier is registered here, replacing the real
 * module with an empty stub so the import statement has a valid target.
 *
 * Adding new stubs
 * ----------------
 * When a new renderer test fails with "Cannot find module" or
 * "Missing 'default' export in module '...?url'", grep the source for the
 * failing path and add a matching `mock.module()` line below.
 *
 * Loaded via `bunfig.toml`:
 *   [test]
 *   preload = ["./scripts/test-setup.ts"]
 */

import { mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseExcludePaths } from './read-bunfig-excludes'

// ── 0. Build-artifact exclusion summary ─────────────────────────────────
// Print why certain paths are excluded from test discovery so contributors
// understand the exclusion list without reading bunfig.toml comments.
// Uses a globalThis flag so the summary prints only once per worker process
// (Bun may run multiple test files in the same worker).
//
// import.meta.main guard in read-bunfig-excludes.ts prevents the CLI block
// from executing when we import parseExcludePaths here.
if (!(globalThis as any).__EXCLUDE_SUMMARY_PRINTED) {
  ;(globalThis as any).__EXCLUDE_SUMMARY_PRINTED = true
  try {
    const tomlPath = resolve(process.cwd(), 'bunfig.toml')
    const tomlText = readFileSync(tomlPath, 'utf-8')
    const excludes = parseExcludePaths(tomlText)
    if (excludes.length > 0) {
      const patterns = excludes.map((e) => e.pattern).join(', ')
      console.log(
        `[test-setup] ${excludes.length} path(s) excluded from discovery: ${patterns}`,
      )
    }
  } catch {
    // bunfig.toml missing or unreadable — silently skip.
  }
}

// ── 1. Vite `?url` / `?worker` / `?raw` asset imports ───────────────────────
// These are just URL strings at runtime. The catch-all plugin doesn't fire
// under bun:test, so we mock each specifier explicitly.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('@resources/icon-set/icon-512.png?url', () => ({ default: '' }))

// ── 2. CSS side-effect imports ──────────────────────────────────────────────
// LayoutShell (and its panel imports) pull in their own stylesheets. Each
// `import './foo.css'` resolves to an absolute path under bun's loader; we
// register mocks for each one so the import statement has a valid default
// export to bind to. The CSS content itself is irrelevant — we're not
// rendering styles in tests.
const cssPaths = [
  'apps/electron/src/renderer/index.css',
  'apps/electron/src/renderer/shell/LayoutShell.css',
  'apps/electron/src/renderer/home/index.css',
  'apps/electron/src/renderer/components/shiki/index.css',
  // Panel CSS — only loaded if the panel is statically imported by
  // LayoutShell.tsx. Keep this list in sync with LayoutShell's imports.
  'apps/electron/src/renderer/panels/memory/index.css',
  'apps/electron/src/renderer/panels/runs/index.css',
  'apps/electron/src/renderer/panels/command/index.css',
  'apps/electron/src/renderer/panels/projects/index.css',
  'apps/electron/src/renderer/panels/integrations/index.css',
  'apps/electron/src/renderer/panels/search/index.css',
  'apps/electron/src/renderer/panels/security/index.css',
  'apps/electron/src/renderer/panels/settings/index.css',
  'apps/electron/src/renderer/panels/media-lab/index.css',
  'apps/electron/src/renderer/panels/prompts/index.css',
  'apps/electron/src/renderer/panels/providers.css',
  'apps/electron/src/renderer/components/ChatSurface.css',
  'apps/electron/src/renderer/components/ChatEmptyState.css',
  'apps/electron/src/renderer/components/OnboardingMural.css',
  'apps/electron/src/renderer/tokens.css',
]
for (const relPath of cssPaths) {
  const absPath = pathToFileURL(resolve(process.cwd(), relPath)).href
  mock.module(absPath, () => ({ default: {} }))
}

// ── 3. ThemeContext — uses `import.meta.glob` (Vite-only) ───────────────────
// ThemeContext.tsx's top-level code calls `import.meta.glob(...)`, which is
// a Vite compile-time transform. bun evaluates it at runtime and crashes
// ("import.meta.glob is not a function"). Replacing the whole module avoids
// the call entirely.
//
// Path is normalized via pathToFileURL so the specifier matches what bun's
// resolver actually uses internally (POSIX-style, with `file://` prefix),
// regardless of host OS.
const themeContextPath = pathToFileURL(
  resolve(process.cwd(), 'apps/electron/src/renderer/context/ThemeContext.tsx'),
).href
mock.module(themeContextPath, () => ({
  ThemeContext: {
    Provider: ({ children }: { children: unknown }) => children,
  },
  ThemeProvider: ({ children }: { children: unknown }) => children,
  useTheme: () => ({
    theme: 'light',
    font: 'sans',
    isUserOverride: false,
    setTheme: () => {},
    setFont: () => {},
    setUserOverride: () => {},
  }),
}))

// ── 4. pdfjs-dist main module ───────────────────────────────────────────────
// The worker `?url` import is stubbed above. The main `pdfjs-dist` module
// also needs a no-op implementation so any code calling `getDocument()` at
// module-load time doesn't blow up.
mock.module('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({}),
}))

// ── 5. NAPI panic fix (previously Bun v1.3.x issue) ─────────────────────
//
// bun test previously crashed with:
//   panic(main thread): NAPI FATAL ERROR: Error::New napi_get_last_error_info
// after all tests passed. Root cause: better-sqlite3's native .node binary
// was loaded via process_dlopen during test execution (context-file-watcher
// test → prompts handler → getMemoryRepository → new Database →
// loadBetterSqlite3). Bun's NAPI cleanup callback failed at exit.
//
// Fixed by switching database-compat.ts to use bun:sqlite (built into the
// Bun runtime) when running under Bun. No native addon is loaded, so the
// NAPI cleanup crash is eliminated. better-sqlite3 is still used for
// Node/Electron production builds.