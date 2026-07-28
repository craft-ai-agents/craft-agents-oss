/**
 * Mock-coverage helper.
 *
 * Used by tests that mock `electron` (BrowserWindow, BrowserView, WebContents,
 * session, ipcMain, etc.) via `mock.module('electron', () => ({...}))`. The
 * generated `REQUIRED_ELECTRON_MEMBERS` const at
 * `scripts/__generated__/required-electron-members.ts` lists every member the
 * production consumer code accesses; `assertMockCoverage` confirms the mock
 * implements each one. If the consumer adds a new method/property but the
 * mock does not expose it, this throws at `beforeAll` instead of silently
 * returning `undefined` and ticking the test green.
 *
 * Wire in the test file:
 *
 *     import { REQUIRED_ELECTRON_MEMBERS } from '../../../../scripts/__generated__/required-electron-members'
 *     import { assertMockCoverage } from './_mock-coverage'
 *
 *     beforeAll(() => {
 *       const electron = require('electron') as any
 *       const dummyWindow = new electron.BrowserWindow(opts)
 *       assertMockCoverage(dummyWindow, REQUIRED_ELECTRON_MEMBERS.BrowserWindow, 'BrowserWindow')
 *       const dummyView = new electron.BrowserView(opts)
 *       assertMockCoverage(dummyView, REQUIRED_ELECTRON_MEMBERS.BrowserView, 'BrowserView')
 *       assertMockCoverage(dummyView.webContents, REQUIRED_ELECTRON_MEMBERS.WebContents, 'WebContents')
 *     })
 */

export class MockCoverageError extends Error {
  constructor(label: string, missing: readonly string[]) {
    super(
      `Mock-coverage drift on ${label}: missing required members: ${missing.join(', ')}\n` +
        `Fix by adding the missing members to the corresponding mock.module('electron', ...) factory, ` +
        `then run \`bun run mock:audit\` to refresh REQUIRED_ELECTRON_MEMBERS.`,
    )
    this.name = 'MockCoverageError'
  }
}

/**
 * Assert that `mockInstance` (object produced by a `mock.module('electron', ...)`
 * factory) exposes every key in `requiredKeys` as its own property.
 *
 * Function-valued and getter-valued members are both treated as covered — `key in obj`
 * is the only thing asserted, since some mocks expose properties lazily and some expose
 * functions directly. To verify a property's TYPE is correct, add a follow-up check
 * (e.g. `typeof mock[key] === 'function'`) in the consumer's beforeAll.
 */
export function assertMockCoverage(
  mockInstance: unknown,
  requiredKeys: readonly string[],
  label: string,
): void {
  if (typeof mockInstance !== 'object' || mockInstance === null) {
    throw new MockCoverageError(label, [...requiredKeys])
  }
  const present = mockInstance as Record<string, unknown>
  const missing = requiredKeys.filter((k) => !(k in present))
  if (missing.length > 0) {
    throw new MockCoverageError(label, missing)
  }
}
