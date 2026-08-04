# Multi-Window State Synchronization

Electron applications often need multiple windows that share state -- a main
editor window with inspector panels, preference windows, or floating toolbars.
Keeping state synchronized across BrowserWindows requires deliberate architecture
because each window runs in its own renderer process with its own memory space.
This reference covers proven patterns for state synchronization, persistence,
and React integration.

## The Challenge

Each BrowserWindow runs an independent renderer process. There is no shared memory
between renderers. If Window A updates a value, Window B has no way to know about
the change unless something explicitly broadcasts it. The main process is the only
entity that can communicate with all windows, making it the natural hub for shared
state.

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  Window A   │       │  Main Proc  │       │  Window B   │
│  (Renderer) │──IPC──│  (State Hub)│──IPC──│  (Renderer) │
│  React App  │       │  electron-  │       │  React App  │
│  Zustand    │       │  store      │       │  Zustand    │
└─────────────┘       └─────────────┘       └─────────────┘
```

## Pattern 1: Main Process as Single Source of Truth

The core pattern uses the main process to hold authoritative state. Renderers
request state on mount, send mutations via IPC, and receive updates via
broadcast events.

### Main Process State Manager

```typescript
// src/main/store.ts
import Store from 'electron-store';
import { BrowserWindow, ipcMain } from 'electron';

interface AppState {
  theme: 'light' | 'dark';
  recentFiles: string[];
  editorSettings: {
    fontSize: number;
    wordWrap: boolean;
    tabSize: number;
  };
}

const defaults: AppState = {
  theme: 'light',
  recentFiles: [],
  editorSettings: { fontSize: 14, wordWrap: true, tabSize: 2 },
};

const store = new Store<AppState>({ defaults });

// Broadcast a state change to all windows
function broadcastStateChange<K extends keyof AppState>(
  key: K,
  value: AppState[K],
): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(`state:${key}`, value);
    }
  });
}

// Watch for changes and broadcast automatically
export function watchState<K extends keyof AppState>(key: K): void {
  store.onDidChange(key, (newValue) => {
    if (newValue !== undefined) {
      broadcastStateChange(key, newValue);
    }
  });
}

// Typed getter and setter
export function getState<K extends keyof AppState>(key: K): AppState[K] {
  return store.get(key);
}

export function setState<K extends keyof AppState>(
  key: K,
  value: AppState[K],
): void {
  store.set(key, value);
  // Note: store.onDidChange triggers broadcastStateChange automatically
}

// Register IPC handlers for state operations
export function registerStateHandlers(): void {
  ipcMain.handle('state:get', (_event, key: keyof AppState) => {
    return getState(key);
  });

  ipcMain.handle(
    'state:set',
    (_event, key: keyof AppState, value: AppState[keyof AppState]) => {
      setState(key, value as AppState[typeof key]);
    },
  );

  // Watch all keys for broadcasting
  const keys: (keyof AppState)[] = ['theme', 'recentFiles', 'editorSettings'];
  keys.forEach((key) => watchState(key));
}
```

### Preload Exposure

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // State management
  getState: (key: string) => ipcRenderer.invoke('state:get', key),

  setState: (key: string, value: unknown) =>
    ipcRenderer.invoke('state:set', key, value),

  onStateChange: (key: string, callback: (value: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on(`state:${key}`, handler);
    return () => ipcRenderer.removeListener(`state:${key}`, handler);
  },
});
```

### Renderer Hook

```typescript
// src/renderer/src/hooks/useSharedState.ts
import { useState, useEffect, useCallback } from 'react';

export function useSharedState<T>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(defaultValue);

  useEffect(() => {
    // Load initial value from main process store
    window.electronAPI.getState(key).then((stored: T | undefined) => {
      if (stored !== undefined) {
        setValue(stored);
      }
    });

    // Subscribe to changes broadcast from main process
    const cleanup = window.electronAPI.onStateChange(
      key,
      (newValue: unknown) => {
        setValue(newValue as T);
      },
    );

    return cleanup;
  }, [key]);

  const updateValue = useCallback(
    (newValue: T) => {
      setValue(newValue); // Optimistic local update
      window.electronAPI.setState(key, newValue); // Persist and broadcast
    },
    [key],
  );

  return [value, updateValue];
}
```

### Usage in Components

```typescript
// src/renderer/src/components/ThemeToggle.tsx
import { useSharedState } from '../hooks/useSharedState';

function ThemeToggle() {
  const [theme, setTheme] = useSharedState<'light' | 'dark'>('theme', 'light');

  return (
    <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
      Current: {theme} (click to toggle)
    </button>
  );
}
```

When Window A toggles the theme, the update flows to the main process, persists
to disk via electron-store, and broadcasts to all windows including Window B.
Both windows update simultaneously.

## Pattern 2: Zustand Store with IPC Sync

For applications with complex renderer-side state, integrate Zustand with the
IPC synchronization pattern for a more ergonomic developer experience.

```typescript
// src/renderer/src/stores/appStore.ts
import { create } from 'zustand';

interface AppStore {
  theme: 'light' | 'dark';
  fontSize: number;
  recentFiles: string[];
  setTheme: (theme: 'light' | 'dark') => void;
  setFontSize: (size: number) => void;
  addRecentFile: (path: string) => void;
  initFromMain: () => Promise<void>;
}

export const useAppStore = create<AppStore>((set, get) => ({
  theme: 'light',
  fontSize: 14,
  recentFiles: [],

  setTheme: (theme) => {
    set({ theme });
    window.electronAPI.setState('theme', theme);
  },

  setFontSize: (fontSize) => {
    set({ fontSize });
    window.electronAPI.setState('editorSettings', {
      ...get(),
      fontSize,
    });
  },

  addRecentFile: (path) => {
    const updated = [path, ...get().recentFiles.filter((f) => f !== path)].slice(
      0,
      10,
    );
    set({ recentFiles: updated });
    window.electronAPI.setState('recentFiles', updated);
  },

  initFromMain: async () => {
    const [theme, editorSettings, recentFiles] = await Promise.all([
      window.electronAPI.getState('theme'),
      window.electronAPI.getState('editorSettings'),
      window.electronAPI.getState('recentFiles'),
    ]);
    set({
      theme: theme ?? 'light',
      fontSize: editorSettings?.fontSize ?? 14,
      recentFiles: recentFiles ?? [],
    });
  },
}));
```

```typescript
// src/renderer/src/App.tsx -- Initialize store and subscribe to broadcasts
import { useEffect } from 'react';
import { useAppStore } from './stores/appStore';

function App() {
  const initFromMain = useAppStore((s) => s.initFromMain);

  useEffect(() => {
    // Load initial state from main process
    initFromMain();

    // Subscribe to cross-window broadcasts
    const cleanupTheme = window.electronAPI.onStateChange('theme', (value) => {
      useAppStore.setState({ theme: value as 'light' | 'dark' });
    });

    const cleanupRecent = window.electronAPI.onStateChange(
      'recentFiles',
      (value) => {
        useAppStore.setState({ recentFiles: value as string[] });
      },
    );

    return () => {
      cleanupTheme();
      cleanupRecent();
    };
  }, [initFromMain]);

  return <MainLayout />;
}
```

## Pattern 3: Window Manager Class

For applications managing many windows, encapsulate window creation and lifecycle
in a dedicated manager class.

```typescript
// src/main/window-manager.ts
import { BrowserWindow, screen } from 'electron';
import { join } from 'path';

interface WindowConfig {
  id: string;
  width: number;
  height: number;
  route?: string;
  parent?: BrowserWindow;
}

class WindowManager {
  private windows = new Map<string, BrowserWindow>();

  create(config: WindowConfig): BrowserWindow {
    if (this.windows.has(config.id)) {
      const existing = this.windows.get(config.id)!;
      existing.focus();
      return existing;
    }

    const win = new BrowserWindow({
      width: config.width,
      height: config.height,
      parent: config.parent,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    // Load the renderer with an optional route hash
    const baseUrl = process.env['ELECTRON_RENDERER_URL'];
    if (baseUrl) {
      const url = config.route ? `${baseUrl}#${config.route}` : baseUrl;
      win.loadURL(url);
    } else {
      const filePath = join(__dirname, '../renderer/index.html');
      const hash = config.route ? `#${config.route}` : '';
      win.loadFile(filePath, { hash });
    }

    win.on('closed', () => {
      this.windows.delete(config.id);
    });

    this.windows.set(config.id, win);
    return win;
  }

  get(id: string): BrowserWindow | undefined {
    return this.windows.get(id);
  }

  getAll(): BrowserWindow[] {
    return Array.from(this.windows.values());
  }

  broadcast(channel: string, ...args: unknown[]): void {
    this.windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    });
  }

  closeAll(): void {
    this.windows.forEach((win) => {
      if (!win.isDestroyed()) win.close();
    });
  }
}

export const windowManager = new WindowManager();
```

```typescript
// src/main/index.ts -- Using the window manager
import { app, ipcMain } from 'electron';
import { windowManager } from './window-manager';
import { registerStateHandlers } from './store';

app.whenReady().then(() => {
  registerStateHandlers();

  // Main editor window
  windowManager.create({ id: 'main', width: 1200, height: 800 });

  // Open inspector panel on request
  ipcMain.handle('open-inspector', () => {
    const main = windowManager.get('main');
    windowManager.create({
      id: 'inspector',
      width: 400,
      height: 600,
      route: '/inspector',
      parent: main,
    });
  });
});
```

## Pattern 4: React Portal for Child Windows

For lightweight child windows that share the parent's React tree and state,
use `window.open()` with React Portals. This approach is useful for floating
panels, detachable widgets, and tool palettes.

```typescript
// src/renderer/src/components/ChildWindow.tsx
import { useState, useEffect, ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ChildWindowProps {
  title?: string;
  width?: number;
  height?: number;
  onClose?: () => void;
  children: ReactNode;
}

function ChildWindow({
  title = 'Panel',
  width = 400,
  height = 300,
  onClose,
  children,
}: ChildWindowProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const features = `width=${width},height=${height},menubar=no,toolbar=no`;
    const childWindow = window.open('', '', features);
    if (!childWindow) return;

    childWindow.document.title = title;

    // Copy stylesheets from parent to child window
    const styleSheets = Array.from(document.styleSheets);
    styleSheets.forEach((sheet) => {
      try {
        if (sheet.href) {
          const link = childWindow.document.createElement('link');
          link.rel = 'stylesheet';
          link.href = sheet.href;
          childWindow.document.head.appendChild(link);
        } else if (sheet.cssRules) {
          const style = childWindow.document.createElement('style');
          Array.from(sheet.cssRules).forEach((rule) => {
            style.appendChild(childWindow.document.createTextNode(rule.cssText));
          });
          childWindow.document.head.appendChild(style);
        }
      } catch {
        // Cross-origin stylesheets may throw; skip them
      }
    });

    // Create a mount point in the child window
    const mountPoint = childWindow.document.createElement('div');
    mountPoint.id = 'child-root';
    childWindow.document.body.appendChild(mountPoint);
    setContainer(mountPoint);

    childWindow.onbeforeunload = () => {
      onClose?.();
    };

    return () => {
      childWindow.close();
    };
  }, [title, width, height, onClose]);

  if (!container) return null;
  return createPortal(children, container);
}

export default ChildWindow;
```

### Using the Portal Pattern

```typescript
// src/renderer/src/components/EditorWithInspector.tsx
import { useState } from 'react';
import ChildWindow from './ChildWindow';
import Inspector from './Inspector';

function EditorWithInspector() {
  const [showInspector, setShowInspector] = useState(false);
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);

  return (
    <div>
      <button onClick={() => setShowInspector(true)}>Open Inspector</button>
      <Editor onNodeSelect={setSelectedNode} />

      {showInspector && (
        <ChildWindow
          title="Inspector"
          width={350}
          height={500}
          onClose={() => setShowInspector(false)}
        >
          {/* This component shares the parent's React state */}
          <Inspector node={selectedNode} />
        </ChildWindow>
      )}
    </div>
  );
}
```

The Portal approach has important trade-offs:

| Advantage                        | Limitation                                    |
|----------------------------------|-----------------------------------------------|
| Shared React state and context   | Child windows are less capable than BrowserWindows |
| No IPC needed for state sync     | No separate preload script                    |
| Simple component-based API       | Styles must be manually copied                |
| Parent state changes auto-render | window.open() may be blocked by some policies |

For full-featured child windows that need their own preload scripts and security
context, use BrowserWindow via the Window Manager pattern instead.

## Combining Patterns

Production applications often combine these patterns:

1. **Window Manager** creates and tracks all BrowserWindows
2. **Main Process Store** (electron-store) holds persistent shared state
3. **IPC Broadcasting** keeps all windows synchronized
4. **Zustand** provides ergonomic state management inside each renderer
5. **React Portals** handle lightweight floating panels within a single window

```typescript
// Typical initialization in main process
app.whenReady().then(() => {
  registerStateHandlers();    // Pattern 1: State with IPC broadcasting

  windowManager.create({      // Pattern 3: Window manager
    id: 'main',
    width: 1200,
    height: 800,
  });
});
```

```typescript
// Typical initialization in renderer
function App() {
  const initFromMain = useAppStore((s) => s.initFromMain);

  useEffect(() => {
    initFromMain();  // Pattern 2: Zustand synced with main store
    // Subscribe to broadcasts...
  }, [initFromMain]);

  return (
    <MainEditor>
      {showPanel && (
        <ChildWindow>         {/* Pattern 4: Portal child window */}
          <FloatingPanel />
        </ChildWindow>
      )}
    </MainEditor>
  );
}
```

## See Also

- [State Management](../integration/state-management.md) -- Zustand and
  electron-store configuration details
- [React Patterns](../integration/react-patterns.md) -- useEffect cleanup,
  Strict Mode considerations, and context providers
- [Typed IPC](../ipc/typed-ipc.md) -- Making the state IPC channels type-safe
  with mapped channel types
- [Process Separation](./process-separation.md) -- Why the main process is
  the right place for shared state
- [Project Structure](./project-structure.md) -- Where window manager and
  store files belong in the directory layout
