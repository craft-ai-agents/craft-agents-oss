# Playwright E2E Testing for Electron Apps

End-to-end testing verifies that your Electron application works correctly from
the user's perspective. Playwright provides experimental but production-viable
Electron support through the Chrome DevTools Protocol (CDP), making it the
recommended replacement for the deprecated Spectron library.

---

## Why Playwright Replaced Spectron

Spectron was the original E2E testing tool for Electron, built on WebDriverIO
and Selenium. In February 2022, Spectron was officially deprecated. It supports
only Electron 13 and below, making it incompatible with any modern release.

Playwright connects to Electron via CDP, giving it access to both the renderer
(browser) context and the main (Node.js) process. You can evaluate code in the
main process, interact with renderer DOM elements, and verify IPC communication
flows end-to-end.

---

## Installation and Configuration

```bash
npm install -D @playwright/test
```

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'electron', testMatch: '**/*.spec.ts' }],
});
```

You do not need Playwright's browser downloads since Electron bundles Chromium.

---

## Launching the App and Basic Tests

```typescript
// tests/e2e/app.spec.ts
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: ['.'],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
});

test('app window has correct title', async () => {
  const title = await window.title();
  expect(title).toBe('My Electron App');
});

test('displays main content', async () => {
  await expect(window.locator('h1')).toHaveText('Welcome');
});

test('save button triggers file save', async () => {
  await window.fill('#editor', 'Hello World');
  await window.click('button#save');
  await expect(window.locator('.status')).toHaveText('File saved');
});

test('visual regression', async () => {
  await expect(window).toHaveScreenshot('main-window.png', {
    maxDiffPixels: 100,
  });
});
```

The `args: ['.']` resolves the `main` field in package.json. Set `NODE_ENV`
to `'test'` so the app can skip auto-update checks or use a test database.

---

## Evaluating Code in the Main Process

`electronApp.evaluate()` runs code in the main process context with access
to all Electron modules.

```typescript
test('evaluate in main process', async () => {
  const appPath = await electronApp.evaluate(async ({ app }) => {
    return app.getAppPath();
  });
  expect(appPath).toBeTruthy();
});

test('evaluate in main process - check version', async () => {
  const version = await electronApp.evaluate(async ({ app }) => {
    return app.getVersion();
  });
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
});

test('verify security settings', async () => {
  const prefs = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const wp = win.webContents.getLastWebPreferences();
    return { contextIsolation: wp.contextIsolation, sandbox: wp.sandbox };
  });
  expect(prefs.contextIsolation).toBe(true);
  expect(prefs.sandbox).toBe(true);
});
```

---

## Stubbing Native Dialogs

Native dialogs block tests. Stub them by replacing dialog methods in the main
process before triggering the UI action.

```typescript
// tests/e2e/helpers.ts
import { ElectronApplication } from '@playwright/test';

export async function stubDialog(app: ElectronApplication, method: string, returnValue: unknown) {
  await app.evaluate(async ({ dialog }, [method, returnValue]) => {
    (dialog as any)[`show${method}`] = () => Promise.resolve(returnValue);
  }, [method, returnValue]);
}
```

```typescript
import { stubDialog } from './helpers';

test('save file flow with stubbed dialog', async () => {
  await stubDialog(electronApp, 'SaveDialog', {
    canceled: false, filePath: '/tmp/test-output.txt',
  });
  await window.fill('#editor', 'Test content');
  await window.click('button#save');
  await expect(window.locator('.status')).toHaveText('File saved');
});
```

The `electron-playwright-helpers` package provides `findLatestBuild()` for
locating packaged builds and a more complete `stubDialog()` implementation.

---

## Testing IPC Communication End-to-End

Verify the full IPC round-trip by triggering renderer actions and asserting
results that flow through preload and main process handlers.

```typescript
test('IPC round-trip: save and verify', async () => {
  await stubDialog(electronApp, 'SaveDialog', {
    canceled: false, filePath: '/tmp/e2e-test.txt',
  });
  await window.fill('#editor', 'E2E test content');
  await window.click('button#save');

  const fileExists = await electronApp.evaluate(async () => {
    const fs = require('fs');
    return fs.existsSync('/tmp/e2e-test.txt');
  });
  expect(fileExists).toBe(true);
});

test('IPC event: main-to-renderer notification', async () => {
  await electronApp.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('notification', 'Test title', 'Test body');
  });
  await expect(window.locator('.notification-title')).toHaveText('Test title');
});
```

---

## Multi-Window Testing

```typescript
test('opening preferences creates a second window', async () => {
  const windowPromise = electronApp.waitForEvent('window');
  await window.click('button#preferences');

  const prefsWindow = await windowPromise;
  await prefsWindow.waitForLoadState('domcontentloaded');
  expect(await prefsWindow.title()).toBe('Preferences');

  await prefsWindow.check('#dark-mode-toggle');
  await prefsWindow.click('button#save-prefs');

  const isDark = await window.evaluate(() =>
    document.documentElement.classList.contains('dark')
  );
  expect(isDark).toBe(true);
});
```

---

## CI Considerations

Electron requires a display server on Linux. Use `xvfb-run` on CI runners:

```yaml
# .github/workflows/test.yml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npm run build
      - run: xvfb-run --auto-servernum npm run test:e2e
```

On macOS and Windows runners, no extra setup is needed. Upload Playwright
trace artifacts on failure for debugging with `playwright show-trace`.

---

## Alternative: WebdriverIO with wdio-electron-service

For teams already using WebdriverIO, `wdio-electron-service` provides Electron
integration with a `browser.electron` namespace for API access. Playwright
remains the officially recommended tool with broader community support.

```typescript
// wdio.conf.ts
export const config = {
  services: ['electron'],
  capabilities: [{
    browserName: 'electron',
    'wdio:electronServiceOptions': {
      appBinaryPath: './out/my-app',
      appArgs: ['--test-mode'],
    },
  }],
};
```

---

## See Also

- [Unit Testing](./unit-testing.md) -- Jest/Vitest configuration for testing
  main and renderer process code in isolation
- [Test Structure](./test-structure.md) -- Multi-project test configuration
  and comprehensive mocking patterns
- [CI/CD Patterns](../packaging/ci-cd-patterns.md) -- GitHub Actions matrix
  builds including E2E test steps
- [Context Isolation](../security/context-isolation.md) -- Security patterns
  that E2E tests should verify
