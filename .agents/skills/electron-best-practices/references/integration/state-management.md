# State Management in Electron + React Applications

Electron state management differs fundamentally from web apps. Web apps live
for a single tab session and lose state on refresh. Electron apps are
long-running desktop processes with persistent windows, multiple windows, and
a main process that outlives any individual renderer. This creates three state
layers that must be coordinated.

---

## The Three State Layers

| Layer | Location | Lifetime | Examples |
|-------|----------|----------|----------|
| Transient UI | Renderer (React/Zustand) | Window session | Sidebar open, scroll position |
| Shared App | Main process (memory) | App session | Active connections, running tasks |
| Persisted | Main process (electron-store) | Across restarts | Theme, window bounds, recent files |

## Decision Matrix

| State Type | Where to Store | Why |
|-----------|---------------|-----|
| UI state (sidebar open) | Zustand (renderer) | Transient, single window |
| Theme preference | Zustand + electron-store | Persists across sessions |
| Recent files | Zustand + electron-store | Persists, may sync across windows |
| Window position/size | electron-store (main) | Managed by main process |
| Auth tokens | electron-store (main) | Security, never in renderer |
| Document content | Zustand (renderer) | Large, frequently changing |
| App settings | electron-store (main) | Shared across windows |

Rule: if it survives a restart, use electron-store. If shared across windows,
route through main. If local to one window's UI, use Zustand or React state.

---

## Zustand for Renderer-Side State

Zustand is recommended for Electron: ~1KB, no boilerplate, TypeScript-native,
and integrates easily with IPC for persistence.

```typescript
// renderer/store.ts
import { create } from 'zustand';

interface AppState {
  theme: 'light' | 'dark';
  recentFiles: string[];
  sidebarOpen: boolean;
  setTheme: (theme: 'light' | 'dark') => void;
  addRecentFile: (path: string) => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  theme: 'light',
  recentFiles: [],
  sidebarOpen: true,

  setTheme: (theme) => {
    set({ theme });
    window.electronAPI.setState('theme', theme); // Persist to main
  },

  addRecentFile: (path) => {
    const files = [path, ...get().recentFiles.filter(f => f !== path)].slice(0, 10);
    set({ recentFiles: files });
    window.electronAPI.setState('recentFiles', files);
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
```

Note that `toggleSidebar` does not call IPC -- it is transient UI state. Only
`setTheme` and `addRecentFile` sync to the main process.

---

## electron-store for Main Process Persistence

`electron-store` provides typed key-value storage backed by a JSON file in the
user's app data directory with atomic writes and schema validation.

```typescript
// main/store.ts
import Store from 'electron-store';

interface PersistedState {
  theme: 'light' | 'dark';
  recentFiles: string[];
  windowBounds: { x: number; y: number; width: number; height: number };
}

const store = new Store<PersistedState>({
  defaults: {
    theme: 'light',
    recentFiles: [],
    windowBounds: { x: 0, y: 0, width: 1200, height: 800 },
  },
});

export default store;
```

---

## IPC Handlers for State Operations

The renderer never accesses electron-store directly. All access goes through
typed IPC handlers, respecting context isolation.

```typescript
// main/ipc/state-handlers.ts
import { ipcMain } from 'electron';
import store from '../store';

ipcMain.handle('get-persisted-state', () => ({
  theme: store.get('theme'),
  recentFiles: store.get('recentFiles'),
}));

ipcMain.handle('set-state', (_event, key: string, value: unknown) => {
  const allowed = ['theme', 'recentFiles'];
  if (!allowed.includes(key)) throw new Error(`Key "${key}" not allowed`);
  store.set(key as any, value);
});
```

```typescript
// preload/index.ts
contextBridge.exposeInMainWorld('electronAPI', {
  getPersistedState: () => ipcRenderer.invoke('get-persisted-state'),
  setState: (key: string, value: unknown) =>
    ipcRenderer.invoke('set-state', key, value),
});
```

---

## Initial State Hydration

Hydrate the Zustand store from persisted state before rendering content.

```typescript
// renderer/initStore.ts
import { useAppStore } from './store';

export async function initializeStore() {
  const persisted = await window.electronAPI.getPersistedState();
  useAppStore.setState({
    theme: persisted.theme ?? 'light',
    recentFiles: persisted.recentFiles ?? [],
  });
}
```

```typescript
// renderer/main.tsx
import { initializeStore } from './initStore';

async function bootstrap() {
  await initializeStore();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><App /></React.StrictMode>
  );
}
bootstrap();
```

---

## Cross-Window State Synchronization

The main process acts as hub: receives changes via IPC, persists them, and
broadcasts to all other windows.

```typescript
// main/ipc/state-sync.ts
import { BrowserWindow, ipcMain } from 'electron';
import store from '../store';

const syncedKeys = new Set(['theme', 'recentFiles']);

ipcMain.handle('set-state', (event, key: string, value: unknown) => {
  store.set(key as any, value);
  if (syncedKeys.has(key)) {
    const senderId = event.sender.id;
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.id !== senderId) {
        win.webContents.send('state-changed', key, value);
      }
    }
  }
});
```

```typescript
// renderer/hooks/useStateSyncListener.ts
import { useEffect } from 'react';
import { useAppStore } from '../store';

export function useStateSyncListener() {
  useEffect(() => {
    const cleanup = window.electronAPI.onStateChanged((key, value) => {
      useAppStore.setState({ [key]: value });
    });
    return cleanup;
  }, []);
}
```

Mount the listener at the app root so every window stays synchronized.

---

## Zustand Middleware for Automatic IPC Persistence

For apps with many persisted keys, a middleware automates the sync:

```typescript
// renderer/middleware/ipcPersist.ts
import { StateCreator } from 'zustand';

export function ipcPersist<T extends object>(
  keys: Array<keyof T & string>,
  creator: StateCreator<T>
): StateCreator<T> {
  return (set, get, api) => {
    const wrappedSet: typeof set = (partial, replace) => {
      const prev = get();
      set(partial, replace);
      const next = get();
      for (const key of keys) {
        if (prev[key] !== next[key]) {
          window.electronAPI.setState(key, next[key]);
        }
      }
    };
    return creator(wrappedSet, get, api);
  };
}

// Usage
export const useAppStore = create<AppState>(
  ipcPersist(['theme', 'recentFiles'], (set) => ({
    theme: 'light',
    recentFiles: [],
    sidebarOpen: true,
    setTheme: (theme) => set({ theme }),        // auto-persisted
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })), // not persisted
  }))
);
```

---

## Debounced Persistence

For rapidly changing state (window resize, editor content), debounce writes:

```typescript
// main/utils/debounced-store.ts
import store from '../store';

const pending = new Map<string, NodeJS.Timeout>();

export function debouncedSet<K extends keyof typeof store.store>(
  key: K, value: (typeof store.store)[K], delayMs = 500
) {
  const existing = pending.get(key as string);
  if (existing) clearTimeout(existing);
  pending.set(key as string, setTimeout(() => {
    store.set(key, value);
    pending.delete(key as string);
  }, delayMs));
}

export function flushPendingWrites() {
  for (const [, timeout] of pending) clearTimeout(timeout);
  pending.clear();
}
```

```typescript
// main/main.ts -- flush before quit
app.on('before-quit', () => flushPendingWrites());
```

---

## When to Use Plain React State

Not everything belongs in Zustand. Use `useState`/`useReducer` for state that
is component-local (form inputs, hover), derived (`useMemo`), or ephemeral
(loading spinners, single-operation errors). Elevate to Zustand only when
state is shared between components or must survive unmount/remount. Persist
to electron-store only when it must survive restarts.

---

## Security: Keep Secrets in Main

Auth tokens and API keys must never live in renderer state or Zustand.

```typescript
// WRONG: token accessible to any renderer code
const useAuth = create((set) => ({
  token: localStorage.getItem('auth-token'),
}));

// RIGHT: token stays in main process
let authToken: string | null = null;
ipcMain.handle('auth-get-token', () => authToken);
ipcMain.handle('auth-set-token', (_e, token: string) => {
  authToken = token;
  store.set('authToken', token);
});
```

See [Context Isolation](../security/context-isolation.md) for why the renderer
must not access sensitive data directly.

---

## See Also

- [React Patterns](./react-patterns.md) -- React 18 lifecycle patterns and IPC
  cleanup hooks that pair with the state patterns shown here.
- [Multi-Window State](../architecture/multi-window-state.md) -- Deeper
  architectural patterns for multi-window state coordination.
- [Typed IPC](../ipc/typed-ipc.md) -- Type-safe IPC channel definitions for
  the state read/write handlers shown in this reference.
- [Context Isolation](../security/context-isolation.md) -- Security boundary
  governing how state flows between main and renderer processes.
