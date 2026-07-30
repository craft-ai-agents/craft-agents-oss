/**
 * apps/electron/playwright.config.ts
 *
 * Playwright config for LayoutShell affordance visual regression tests.
 * Capture-only — does not drive the real Electron app. Instead, opens
 * static HTML harness pages in Chromium that mirror the affordances'
 * DOM + the corresponding CSS rules from apps/electron/src/renderer/
 * shell/LayoutShell.css.
 *
 * Setup:
 *   1. cd apps/electron && bun install
 *   2. bun run playwright:install      # downloads Chromium (~300MB)
 *   3. bun run playwright:test:update  # record baselines (one time)
 *   4. bun run playwright:test         # verify on every change
 *
 * Baselines land in playwright/tests/__screenshots__/ and are checked
 * into source control. Diff threshold is 0 (pixel-perfect) — adjust the
 * `maxDiffPixelRatio` config below if a small drift is acceptable.
 */
import { defineConfig, devices } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// apps/electron/package.json has "type": "module", so CommonJS globals
// (__dirname, require) are unavailable.  Derive __dirname from the
// module URL.
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const HARNESS_DIR = './playwright/affordances'

// Stable file:// base URL.  Resolve relative to this config file
// (invariant of invocation directory — the npm scripts run from
// apps/electron but contributors who invoke Playwright via the GUI /
// IDE / a CI matrix task may not).
const BASE_URL =
  'file://' +
  resolve(__dirname, '../' + HARNESS_DIR + '/').replace(/\\/g, '/') +
  '/'

export default defineConfig({
  testDir: './playwright/tests',
  outputDir: './playwright/test-results',

  // Single worker — affordances are quick (~200ms each) and serial
  // runs keep the chromium cache under control on Windows.
  fullyParallel: false,
  workers: 1,

  reporter: process.env.CI ? 'github' : 'list',

  // Baselines: apps/electron/playwright/tests/__screenshots__/
  //   {testFilePath}/{testName}-{snapshotName}{ext}
  // Default Playwright template is fine — snapshotPathTemplate omitted.
  expect: {
    // First-recordings on a fresh Chromium install can show subpixel
    // drift (font hinting, color-mix rounding). 0.001 (~1 px per
    // 1000) catches real CSS refactors without flaking on first
    // record. After the first cross-machine baseline pass, drop to 0.
    maxDiffPixelRatio: 0.001,
    toHaveScreenshot: {
      // Disable animations + transitions for stable snapshots. The CSS
      // already has @media (prefers-reduced-motion) blocks, but having
      // the override at the test layer means tests don't have to set
      // the media query.
      animations: 'disabled',
      caret: 'hide',
      scale: 'device',
    },
  },

  use: {
    headless: true,
    viewport: { width: 1400, height: 900 },
    // Stable Chromium fonts on all platforms.
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // Resolve the harness directory once so the spec can `goto()`
    // each affordance file via a stable relative path.
    baseURL: BASE_URL,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
