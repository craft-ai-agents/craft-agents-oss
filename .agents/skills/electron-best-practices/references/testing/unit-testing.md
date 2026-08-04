# Unit Testing Main and Renderer Processes

Electron applications run code in fundamentally different environments -- the
main process operates in Node.js while the renderer runs in a browser context.
Effective unit testing requires separate configurations for each environment,
careful mocking of Electron APIs, and strategies for testing the IPC boundary
without launching the full application.

---

## Why Multi-Environment Testing Matters

A single test runner configuration cannot properly test both processes. Main
process code uses Node.js APIs and Electron modules (`app`, `BrowserWindow`,
`ipcMain`). Renderer code uses browser APIs and React. Running renderer tests
in Node misses DOM bugs; running main tests in jsdom misses Node-specific
behavior. The solution is a multi-project config with `node` and `jsdom`
environments. See [Test Structure](./test-structure.md) for the full setup.

---

## Testing IPC Handlers in Isolation

IPC handlers contain the core business logic of the main process. Test them
by mocking `ipcMain.handle`, extracting the registered handler, and calling
it directly.

```typescript
// tests/unit/main/file-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerFileHandlers } from '../../../src/main/ipc/file-handlers';

// Mock Electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  dialog: {
    showSaveDialog: vi.fn(),
  },
}));

import { ipcMain, dialog } from 'electron';

describe('File Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerFileHandlers();
  });

  it('registers save-file handler', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('save-file', expect.any(Function));
  });

  it('save-file handler writes content', async () => {
    const handler = (ipcMain.handle as any).mock.calls
      .find(([channel]: [string]) => channel === 'save-file')[1];

    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/test.txt',
    });

    const result = await handler({}, 'test content');
    expect(result.success).toBe(true);
  });

  it('handles cancelled dialog gracefully', async () => {
    const handler = (ipcMain.handle as any).mock.calls
      .find(([channel]: [string]) => channel === 'save-file')[1];

    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: true,
      filePath: undefined,
    });

    const result = await handler({}, 'test content');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Save cancelled');
  });
});
```

### Handler Extraction Helper

The pattern of extracting handlers from mock calls is common enough to warrant
a reusable helper:

```typescript
// tests/helpers/ipc-test-utils.ts
import { ipcMain } from 'electron';

export function getHandler(channel: string) {
  const call = (ipcMain.handle as any).mock.calls
    .find(([ch]: [string]) => ch === channel);
  if (!call) throw new Error(`No handler registered for channel: ${channel}`);
  return call[1];
}
```

---

## Testing React Components That Use electronAPI

Components calling `window.electronAPI` methods need the mock set up before
rendering. Mock specific methods and verify interactions.

```typescript
// tests/unit/renderer/Counter.test.tsx
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Counter from '../../../src/renderer/src/components/Counter';

// Mock window.electronAPI
const mockOnUpdateCounter = vi.fn();
beforeEach(() => {
  window.electronAPI = {
    onUpdateCounter: mockOnUpdateCounter.mockReturnValue(() => {}),
    // ... other methods
  } as any;
});

describe('Counter', () => {
  it('subscribes to counter updates on mount', () => {
    render(<Counter />);
    expect(mockOnUpdateCounter).toHaveBeenCalled();
  });

  it('cleans up subscription on unmount', () => {
    const cleanup = vi.fn();
    mockOnUpdateCounter.mockReturnValue(cleanup);
    const { unmount } = render(<Counter />);
    unmount();
    expect(cleanup).toHaveBeenCalled();
  });

  it('displays the counter value from IPC events', () => {
    let capturedCallback: (value: number) => void;
    mockOnUpdateCounter.mockImplementation((cb: (value: number) => void) => {
      capturedCallback = cb;
      return () => {};
    });
    render(<Counter />);
    act(() => { capturedCallback(42); });
    expect(screen.getByText('42')).toBeTruthy();
  });
});
```

### Testing Async IPC Interactions

For components that invoke IPC on user interaction, use `waitFor` for async
updates:

```typescript
// tests/unit/renderer/FileEditor.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FileEditor from '../../../src/renderer/src/components/FileEditor';

beforeEach(() => {
  window.electronAPI = {
    saveFile: vi.fn().mockResolvedValue({ success: true, data: '/tmp/test.txt' }),
    openFile: vi.fn().mockResolvedValue({
      success: true, data: { path: '/tmp/doc.txt', content: 'Hello' },
    }),
  } as any;
});

describe('FileEditor', () => {
  it('calls saveFile with editor content', async () => {
    render(<FileEditor />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New content' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(window.electronAPI.saveFile).toHaveBeenCalledWith('New content');
    });
  });

  it('shows error message on failed save', async () => {
    (window.electronAPI.saveFile as any).mockResolvedValue({
      success: false, error: 'Disk full',
    });
    render(<FileEditor />);
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(screen.getByText('Disk full')).toBeTruthy();
    });
  });
});
```

---

## Testing Preload Scripts

Preload scripts are thin wrappers around `ipcRenderer`. Test them by mocking
`ipcRenderer` and verifying correct channel and argument forwarding.

```typescript
// tests/unit/preload/preload.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}));

import { contextBridge, ipcRenderer } from 'electron';
import '../../../src/preload/index';

describe('Preload Script', () => {
  it('exposes electronAPI to main world', () => {
    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith(
      'electronAPI', expect.any(Object)
    );
  });

  it('saveFile invokes correct channel', async () => {
    const api = (contextBridge.exposeInMainWorld as any).mock.calls[0][1];
    vi.mocked(ipcRenderer.invoke).mockResolvedValue({ success: true });
    await api.saveFile('content');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('save-file', 'content');
  });

  it('onFileChanged registers and returns cleanup', () => {
    const api = (contextBridge.exposeInMainWorld as any).mock.calls[0][1];
    const cleanup = api.onFileChanged(vi.fn());
    expect(ipcRenderer.on).toHaveBeenCalledWith('file-changed', expect.any(Function));
    cleanup();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'file-changed', expect.any(Function)
    );
  });
});
```

---

## Code Coverage Strategies

Track coverage per process to prevent renderer-heavy coverage from masking
untested main process code:

```bash
npx vitest run --project main --coverage
npx vitest run --project renderer --coverage
```

---

## Best Practices for Test Isolation

1. **Clear mocks between tests** -- Use `beforeEach(() => vi.clearAllMocks())`
   to prevent state leakage between test cases.
2. **Avoid shared mutable state** -- Each test should set up its own mock
   return values rather than relying on shared setup.
3. **Mock at the boundary** -- Mock `electron` and `window.electronAPI`, not
   internal application modules, to test more actual code.
4. **Test error paths** -- Cover dialog cancellation, file system errors, and
   permission denied cases for all IPC result type variants.
5. **Use TypeScript for tests** -- Type errors in tests catch API drift between
   mocks and the actual electronAPI interface.
6. **Keep unit tests fast** -- Target under 10 seconds total. Slow tests often
   indicate unresolved promises or missing mock implementations.

---

## See Also

- [Playwright E2E](./playwright-e2e.md) -- End-to-end testing that launches
  the full Electron application
- [Test Structure](./test-structure.md) -- Multi-project configuration and
  comprehensive Electron module mocks
- [Typed IPC](../ipc/typed-ipc.md) -- The IPC channel map pattern that test
  mocks should align with
- [Project Structure](../architecture/project-structure.md) -- Directory layout
  that determines test file organization
