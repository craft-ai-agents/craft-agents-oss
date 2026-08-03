/**
 * Per-test coverage config.
 *
 * Declares the production source files whose BrowserWindow / BrowserView /
 * WebContents call surface this test's mock must cover. The audit script
 * scans these consumers and generates `__snapshots__/coverage.snap.ts`.
 */
export const coverageConsumers = [
  'apps/electron/src/main/browser-pane-manager.ts',
] as const
