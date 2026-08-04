# Multi-Project Test Configuration and Mocking Patterns

Electron's split architecture requires a test setup that mirrors its runtime
structure. This reference covers the multi-project Vitest configuration, the
comprehensive Electron module mocks needed for each environment, and patterns
for fixtures, integration-style IPC testing, and test organization.

---

## Multi-Project Vitest Configuration

Vitest's workspace feature lets you define multiple test projects with
independent environments, setup files, and include patterns.

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          root: './src/main',
          environment: 'node',
          include: ['**/*.test.ts'],
          setupFiles: ['../../tests/setup/main-setup.ts'],
        },
      },
      {
        test: {
          name: 'renderer',
          root: './src/renderer',
          environment: 'jsdom',
          include: ['**/*.test.{ts,tsx}'],
          setupFiles: ['../../tests/setup/renderer-setup.ts'],
        },
      },
    ],
  },
});
```

---

## Main Process Mock Setup

The setup file mocks all Electron modules your application imports so that
importing any main process module does not throw.

```typescript
// tests/setup/main-setup.ts
import { vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    on: vi.fn(),
    quit: vi.fn(),
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(),
    webContents: { send: vi.fn(), on: vi.fn() },
    on: vi.fn(),
    show: vi.fn(),
    close: vi.fn(),
  })),
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
}));
```

Extend this mock as your application uses additional modules like `Menu`,
`Tray`, `shell`, `globalShortcut`, or `autoUpdater`.

---

## Renderer Process Mock Setup

The renderer setup mocks `window.electronAPI` -- the bridge exposed by the
preload script via `contextBridge.exposeInMainWorld`.

```typescript
// tests/setup/renderer-setup.ts
import { vi } from 'vitest';

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: {
    invoke: vi.fn(),
    getState: vi.fn().mockResolvedValue({}),
    setState: vi.fn(),
    onStateChange: vi.fn().mockReturnValue(() => {}),
  },
  writable: true,
});
```

Mark `electronAPI` as `writable: true` so individual tests can override
specific methods with custom mock implementations.

---

## Mocking electron-store

`electron-store` is commonly used for preferences. Mock it with an in-memory
Map-based implementation:

```typescript
// tests/mocks/electron-store.ts
import { vi } from 'vitest';

const store = new Map<string, unknown>();

const ElectronStore = vi.fn().mockImplementation(() => ({
  get: vi.fn((key: string, defaultValue?: unknown) =>
    store.has(key) ? store.get(key) : defaultValue),
  set: vi.fn((key: string, value: unknown) => { store.set(key, value); }),
  delete: vi.fn((key: string) => { store.delete(key); }),
  has: vi.fn((key: string) => store.has(key)),
  clear: vi.fn(() => store.clear()),
}));

export default ElectronStore;
```

---

## Mock IPC Bridge for Integration Tests

Test interactions between main process services and IPC handlers without
launching the full app by connecting handlers and invokers in memory.

```typescript
// tests/helpers/mock-ipc-bridge.ts
import { vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

export const mockIpcMain = {
  handle: vi.fn((channel: string, handler: Handler) => {
    handlers.set(channel, handler);
  }),
  removeHandler: vi.fn((channel: string) => { handlers.delete(channel); }),
  on: vi.fn(),
};

export const mockIpcRenderer = {
  invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No handler for channel: ${channel}`);
    return handler({}, ...args);
  }),
  on: vi.fn((channel: string, callback: (...args: unknown[]) => void) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(callback);
  }),
  removeListener: vi.fn((channel: string, callback: (...args: unknown[]) => void) => {
    listeners.get(channel)?.delete(callback);
  }),
};

export function emitToRenderer(channel: string, ...args: unknown[]) {
  listeners.get(channel)?.forEach((cb) => cb({}, ...args));
}

export function resetMockIpc() {
  handlers.clear();
  listeners.clear();
  vi.clearAllMocks();
}
```

```typescript
// Usage in an integration test
vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  ipcRenderer: mockIpcRenderer,
  dialog: { showSaveDialog: vi.fn() },
}));

import { registerFileHandlers } from '../../../src/main/ipc/file-handlers';

beforeEach(() => { resetMockIpc(); registerFileHandlers(); });

it('round-trips through the IPC bridge', async () => {
  const result = await mockIpcRenderer.invoke('save-file', 'content');
  expect(result).toHaveProperty('success');
});
```

---

## Fixture Patterns for Test Data

Use factory functions rather than static objects so each test gets a fresh copy.

```typescript
// tests/fixtures/test-data.ts
export function createTestUser(overrides: Partial<User> = {}): User {
  return { id: 'user-001', name: 'Test User', email: 'test@example.com', ...overrides };
}

export function createTestDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-001', title: 'Test Document', content: 'Lorem ipsum.',
    createdAt: new Date('2025-01-01').toISOString(),
    ...overrides,
  };
}
```

---

## Test File Organization

```
tests/
├── e2e/                    # Playwright E2E tests
│   ├── app.spec.ts
│   ├── navigation.spec.ts
│   └── helpers.ts
├── unit/
│   ├── main/              # Main process unit tests
│   │   └── file-handlers.test.ts
│   └── renderer/          # Renderer unit tests
│       └── Counter.test.tsx
├── setup/
│   ├── main-setup.ts      # Main process test setup
│   └── renderer-setup.ts  # Renderer test setup
├── mocks/
│   └── electron-store.ts  # Module mocks
├── helpers/
│   ├── ipc-test-utils.ts  # Handler extraction
│   └── mock-ipc-bridge.ts # In-memory IPC bridge
└── fixtures/
    └── test-data.ts       # Factory functions
```

Naming conventions: E2E tests use `*.spec.ts`, unit tests use `*.test.ts` or
`*.test.tsx`, setup files use `*-setup.ts`. Choose either co-located tests
(next to source) or centralized tests (in `tests/`) and be consistent.

---

## Running Tests Selectively

```bash
# All projects
npx vitest run

# Single project
npx vitest run --project main
npx vitest run --project renderer

# Watch mode
npx vitest --project renderer

# With coverage
npx vitest run --coverage
```

Add convenience scripts to `package.json`:

```jsonc
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:main": "vitest run --project main",
    "test:renderer": "vitest run --project renderer",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test"
  }
}
```

---

## See Also

- [Playwright E2E](./playwright-e2e.md) -- End-to-end testing that validates
  the full application flow
- [Unit Testing](./unit-testing.md) -- Detailed patterns for testing IPC
  handlers, React components, and preload scripts
- [Process Separation](../architecture/process-separation.md) -- Understanding
  which code runs in which environment
- [Project Structure](../architecture/project-structure.md) -- Source directory
  layout that test organization mirrors
