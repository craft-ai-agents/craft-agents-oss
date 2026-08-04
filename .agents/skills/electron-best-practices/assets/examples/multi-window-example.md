# Multi-Window State Synchronization Example

Complete example of multi-window state synchronization using `electron-store` for persistence, `BrowserWindow` broadcasting for cross-window communication, and Zustand for renderer-side state management.

---

## Step 1: Shared State Types

```typescript
// src/shared/state-types.ts

export interface AppState {
  theme: 'light' | 'dark';
  sidebarOpen: boolean;
  activeDocument: string | null;
  recentFiles: string[];
}

export const DEFAULT_STATE: AppState = {
  theme: 'light',
  sidebarOpen: true,
  activeDocument: null,
  recentFiles: [],
};

// Keys that should trigger UI updates across all windows
export type SyncableKey = keyof AppState;
```

---

## Step 2: Main Process Store with Broadcasting

The main process holds the authoritative state using `electron-store` for disk persistence. On any change, it broadcasts to all open windows.

```typescript
// src/main/store.ts

import Store from 'electron-store';
import { BrowserWindow, ipcMain } from 'electron';
import type { AppState } from '../shared/state-types';
import { DEFAULT_STATE } from '../shared/state-types';

const store = new Store<AppState>({ defaults: DEFAULT_STATE });

// Broadcast state changes to all windows
function broadcast<K extends keyof AppState>(
  key: K,
  value: AppState[K],
  senderWebContentsId?: number
): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      // Optionally skip the sender to avoid echo
      if (senderWebContentsId && win.webContents.id === senderWebContentsId) {
        return;
      }
      win.webContents.send('state:changed', { key, value });
    }
  });
}

export function registerStateHandlers(): void {
  // Get full state (used for initial hydration)
  ipcMain.handle('state:get-all', () => {
    return store.store;
  });

  // Get single value
  ipcMain.handle('state:get', (_event, key: keyof AppState) => {
    return store.get(key);
  });

  // Set single value and broadcast to other windows
  ipcMain.handle(
    'state:set',
    (_event, key: keyof AppState, value: unknown) => {
      store.set(key, value as AppState[typeof key]);
      broadcast(key, value as AppState[typeof key], _event.sender.id);
    }
  );

}
```

---

## Step 3: Preload API for State

```typescript
// src/preload/index.ts (state portion)

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('stateAPI', {
  getAll: (): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('state:get-all'),

  get: (key: string): Promise<unknown> =>
    ipcRenderer.invoke('state:get', key),

  set: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke('state:set', key, value),

  onChange: (
    callback: (data: { key: string; value: unknown }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      data: { key: string; value: unknown }
    ) => callback(data);
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.removeListener('state:changed', handler);
  },
});
```

Add a corresponding `index.d.ts` that declares `window.stateAPI` with the same method signatures so the renderer has type information.

---

## Step 4: Zustand Store with IPC Sync

Each action updates the local store immediately for responsiveness, then sends the change to main for persistence and broadcasting.

```typescript
// src/renderer/src/store/app-store.ts

import { create } from 'zustand';
import type { AppState } from '../../../shared/state-types';

interface AppStore extends AppState {
  // Actions
  setTheme: (theme: AppState['theme']) => void;
  toggleSidebar: () => void;
  setActiveDocument: (path: string | null) => void;
  addRecentFile: (path: string) => void;

  // Internal: used by sync hook to apply remote changes
  _hydrate: (state: Partial<AppState>) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // Initial values (overwritten on hydration)
  theme: 'light',
  sidebarOpen: true,
  activeDocument: null,
  recentFiles: [],

  setTheme: (theme) => {
    set({ theme });
    window.stateAPI.set('theme', theme);
  },

  toggleSidebar: () => {
    const next = !get().sidebarOpen;
    set({ sidebarOpen: next });
    window.stateAPI.set('sidebarOpen', next);
  },

  setActiveDocument: (path) => {
    set({ activeDocument: path });
    window.stateAPI.set('activeDocument', path);
  },

  addRecentFile: (path) => {
    const current = get().recentFiles;
    // Move to front, deduplicate, cap at 10 entries
    const files = [path, ...current.filter(f => f !== path)].slice(0, 10);
    set({ recentFiles: files });
    window.stateAPI.set('recentFiles', files);
  },

  _hydrate: (state) => set(state),
}));
```

---

## Step 5: Initialization and Sync Hook

Hydrates the Zustand store from the main process on mount, and listens for changes broadcast from other windows.

```typescript
// src/renderer/src/hooks/useStateSync.ts

import { useEffect } from 'react';
import { useAppStore } from '../store/app-store';

export function useStateSync(): void {
  useEffect(() => {
    // 1. Hydrate from main process store on mount
    //    This ensures the window picks up persisted state
    window.stateAPI.getAll().then((state) => {
      useAppStore.getState()._hydrate(state as Record<string, unknown>);
    });

    // 2. Listen for changes broadcast from other windows
    const cleanup = window.stateAPI.onChange(({ key, value }) => {
      useAppStore.getState()._hydrate({ [key]: value });
    });

    return cleanup;
  }, []);
}
```

---

## Step 6: Window Manager in Main Process

```typescript
// src/main/window-manager.ts

import { BrowserWindow } from 'electron';
import { join } from 'path';

const windows = new Map<string, BrowserWindow>();

export function createWindow(
  id: string,
  options?: Partial<Electron.BrowserWindowConstructorOptions>
): BrowserWindow {
  // If a window with this ID already exists, focus it
  if (windows.has(id)) {
    const existing = windows.get(id)!;
    existing.focus();
    return existing;
  }

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    ...options,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      ...options?.webPreferences,
    },
  });

  windows.set(id, win);
  win.on('closed', () => windows.delete(id));

  // Load renderer: dev server in development, file in production
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${id}`);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: id });
  }

  return win;
}

export function getWindow(id: string): BrowserWindow | undefined {
  return windows.get(id);
}

export function getAllWindowIds(): string[] {
  return Array.from(windows.keys());
}
```

```typescript
// src/main/index.ts (entry point)

import { app } from 'electron';
import { registerStateHandlers } from './store';
import { createWindow } from './window-manager';

app.whenReady().then(() => {
  registerStateHandlers();
  createWindow('main');
});

// Open a new window from IPC (e.g., for a secondary panel)
import { ipcMain } from 'electron';
ipcMain.handle('window:open', (_event, id: string) => {
  createWindow(id);
});
```

---

## Step 7: Usage in App Component

```tsx
// src/renderer/src/App.tsx

import { useStateSync } from './hooks/useStateSync';
import { useAppStore } from './store/app-store';

export default function App() {
  // Initialize sync on mount
  useStateSync();

  const theme = useAppStore(s => s.theme);
  const setTheme = useAppStore(s => s.setTheme);
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const toggleSidebar = useAppStore(s => s.toggleSidebar);
  const recentFiles = useAppStore(s => s.recentFiles);

  return (
    <div className={`app ${theme}`}>
      <header>
        <button onClick={toggleSidebar}>
          {sidebarOpen ? 'Hide' : 'Show'} Sidebar
        </button>
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
          Toggle Theme
        </button>
      </header>

      {sidebarOpen && (
        <aside>
          <h3>Recent Files</h3>
          <ul>
            {recentFiles.map(file => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </aside>
      )}

      <main>
        {/* Application content here */}
        <p>Current theme: {theme}</p>
        <p>Open another window to see state sync in action.</p>
      </main>
    </div>
  );
}
```

When a user toggles the theme in one window: Zustand updates locally, the IPC call persists to `electron-store` and broadcasts to all other windows, each window's `onChange` listener fires `_hydrate`, and React re-renders.

---

## Summary

**Key takeaways from this pattern:**

1. **Main process is the single source of truth.** All state mutations flow through main, which persists via `electron-store` and broadcasts to all windows. This avoids split-brain problems.

2. **Optimistic local updates.** Zustand updates immediately, then asynchronously persists via IPC. The UI stays responsive without waiting for round-trip confirmation.

3. **Broadcast with sender exclusion.** The `broadcast` function skips the sender window to avoid redundant re-renders.

4. **Hydration on window open.** Every new window calls `state:get-all` on mount, so windows opened at different times converge to the same state.

5. **Cleanup prevents leaks.** The `onChange` listener returns an unsubscribe function used in `useEffect` cleanup.

6. **Separation of state and transport.** Renderer components interact only with Zustand. They have no knowledge of IPC or broadcasting, making them testable in isolation.

7. **Extensibility.** Adding new state fields requires changes in three places: the shared `AppState` type, the Zustand store, and the consuming component. Persistence and sync layers handle new fields automatically.
