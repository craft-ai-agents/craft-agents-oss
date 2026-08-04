# Playwright E2E Configuration for Electron

Playwright has first-class support for testing Electron applications through its `_electron` module. Unlike browser-based E2E testing, Electron tests launch the application binary directly -- there is no web server to configure. The test process connects to the Electron app over the Chrome DevTools Protocol, giving you access to both the renderer (page interactions, DOM assertions) and the main process (evaluating Node.js code, stubbing dialogs, inspecting IPC). The configuration below sets up Playwright for Electron with sensible defaults for CI and local development.

## Playwright Configuration

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,

  // Reporter configuration
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : [['html', { open: 'on-failure' }]],

  use: {
    // Screenshot settings
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },

  // No webServer needed - Electron launches directly
  // The test files use _electron.launch() to start the app

  projects: [
    {
      name: 'electron',
      testMatch: '**/*.spec.ts',
    },
  ],
});
```

## Electron Test Helpers

The helper module below provides reusable utilities for launching the Electron app and stubbing native dialogs. Import these in your test files to avoid duplicating setup logic.

```typescript
// tests/e2e/electron-helpers.ts
import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { resolve } from 'path';

export async function launchElectron(): Promise<{
  app: ElectronApplication;
  window: Page;
}> {
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  return { app, window };
}

export async function stubDialog(
  app: ElectronApplication,
  method: 'OpenDialog' | 'SaveDialog' | 'MessageBox',
  returnValue: unknown
): Promise<void> {
  await app.evaluate(
    async ({ dialog }, [m, rv]) => {
      (dialog as Record<string, unknown>)[`show${m}`] = () => Promise.resolve(rv);
    },
    [method, returnValue] as const
  );
}
```

## Example Test

```typescript
// tests/e2e/app-launch.spec.ts
import { test, expect } from '@playwright/test';
import { launchElectron } from './electron-helpers';

let app: Awaited<ReturnType<typeof launchElectron>>['app'];
let window: Awaited<ReturnType<typeof launchElectron>>['window'];

test.beforeEach(async () => {
  ({ app, window } = await launchElectron());
});

test.afterEach(async () => {
  await app.close();
});

test('application launches and shows main window', async () => {
  const title = await window.title();
  expect(title).toBeTruthy();

  // Verify the window is visible
  const isVisible = await app.evaluate(async ({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    return mainWindow.isVisible();
  });
  expect(isVisible).toBe(true);
});

test('main process version is accessible', async () => {
  const electronVersion = await app.evaluate(async ({ app }) => {
    return app.getVersion();
  });
  expect(electronVersion).toMatch(/\d+\.\d+\.\d+/);
});
```

## Notes

### Build Before Testing

Playwright tests run against the compiled output, not the source files. Ensure you run `electron-vite build` (or your equivalent build command) before executing tests. In CI, add this as a step before the Playwright run. In `package.json`, you can chain the commands:

```json
{
  "scripts": {
    "test:e2e": "electron-vite build && playwright test"
  }
}
```

### Timeout Configuration

The 30-second timeout accounts for Electron's startup time, which is longer than loading a web page. On slower CI runners, you may need to increase this. The `retries: 2` setting for CI handles flaky tests caused by timing issues in the Electron lifecycle without masking genuine failures during local development.

### Traces, Screenshots, and Video

Traces, screenshots, and video are configured to capture only on failure or retry. This keeps test runs fast while still providing full diagnostic information when something goes wrong. Traces are especially valuable -- they record every network request, DOM snapshot, and console message, and can be viewed in the Playwright Trace Viewer.

### Stubbing Native Dialogs

The `stubDialog` helper replaces Electron's native dialog methods (file open, file save, message box) with controlled stubs. This is essential because native OS dialogs cannot be automated through the DevTools Protocol. Always stub dialogs before triggering the action that would open them.

### Main Process Evaluation

The `app.evaluate()` method runs code inside the Electron main process, with access to all Electron modules (`BrowserWindow`, `app`, `dialog`, `ipcMain`, etc.). This is useful for verifying main process state, triggering IPC events, and setting up test fixtures. The callback receives the Electron module namespace as its first argument.

### Running in CI

Electron requires a display server on Linux. In headless CI environments, use `xvfb-run`:

```yaml
- name: Run E2E tests
  run: xvfb-run --auto-servernum -- npx playwright test
```

Alternatively, set the `DISPLAY` environment variable if your CI provides a virtual framebuffer.

### Parallel Execution

Playwright runs test files in parallel by default. Since each test launches its own Electron instance, parallelism works naturally. However, if your tests interact with shared resources (files on disk, a local database), you may need to configure `fullyParallel: false` or use unique temp directories per test.
