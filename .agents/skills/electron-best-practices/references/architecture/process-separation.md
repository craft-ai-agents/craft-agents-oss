# Process Separation: Main, Preload, and Renderer Responsibilities

Electron applications run across three distinct process types, each with different
capabilities and security constraints. Understanding these boundaries is essential
for building secure, well-structured applications. This reference covers what each
process can do, what code belongs where, and how data flows between them.

## The Three Processes

### Main Process

The main process is the entry point of every Electron application. It runs in a
full Node.js environment with unrestricted access to system APIs, the file system,
native modules, and Electron's main-process APIs (BrowserWindow, dialog, Menu,
Notification, Tray, and more).

There is exactly one main process per application. It creates and manages all
BrowserWindows and handles IPC messages from renderer processes.

```typescript
// src/main/index.ts -- Main process capabilities
import { app, BrowserWindow, dialog, ipcMain, Notification } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import Store from 'electron-store';

// Full Node.js and Electron API access
const store = new Store();

app.whenReady().then(() => {
  const win = new BrowserWindow({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Handle IPC from renderer processes
  ipcMain.handle('read-file', async (_event, filePath: string) => {
    // Validate the path before accessing the file system
    if (!filePath.startsWith(app.getPath('userData'))) {
      return { success: false, error: 'Access denied: path outside user data' };
    }
    try {
      const content = await readFile(filePath, 'utf-8');
      return { success: true, data: content };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
});
```

### Preload Process

The preload script runs before the renderer's web content loads. With sandbox
enabled (the default since Electron 20), the preload script has access to a
limited subset of Node.js APIs and the `contextBridge` module. Its sole job is
to define the API surface that the renderer can access.

Each BrowserWindow has its own preload script instance. The preload script runs
in an isolated context -- the renderer cannot access its variables or scope
directly. Only values explicitly exposed through `contextBridge` are visible
to the renderer.

```typescript
// src/preload/index.ts -- Preload capabilities (sandboxed)
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Available in sandbox: contextBridge, ipcRenderer (limited), Buffer, process (limited)
// NOT available: require(), fs, path, child_process, native modules

contextBridge.exposeInMainWorld('electronAPI', {
  readFile: (path: string) => ipcRenderer.invoke('read-file', path),
  writeFile: (path: string, content: string) =>
    ipcRenderer.invoke('write-file', path, content),
  showNotification: (title: string, body: string) =>
    ipcRenderer.invoke('show-notification', title, body),

  // Event listener with cleanup
  onProgress: (callback: (percent: number) => void) => {
    const handler = (_e: IpcRendererEvent, percent: number) => callback(percent);
    ipcRenderer.on('progress-update', handler);
    return () => ipcRenderer.removeListener('progress-update', handler);
  },
});
```

### Renderer Process

The renderer process is a Chromium web page. With context isolation enabled and
node integration disabled (both defaults), it has no access to Node.js APIs.
It is a pure web environment where your React application runs. The only bridge
to system capabilities is through the API exposed by the preload script on
`window.electronAPI`.

```typescript
// src/renderer/src/components/FileEditor.tsx -- Renderer capabilities
import { useState, useEffect } from 'react';

function FileEditor() {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('');

  // Access system features only through the preload bridge
  async function handleSave() {
    const result = await window.electronAPI.writeFile('/data/notes.txt', content);
    if (result.success) {
      setStatus('Saved successfully');
    } else {
      setStatus(`Save failed: ${result.error}`);
    }
  }

  // Subscribe to main process events
  useEffect(() => {
    const cleanup = window.electronAPI.onProgress((percent) => {
      setStatus(`Saving... ${percent}%`);
    });
    return cleanup; // Always clean up listeners
  }, []);

  return (
    <div>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} />
      <button onClick={handleSave}>Save</button>
      <p>{status}</p>
    </div>
  );
}
```

## Security Boundary Model

The security architecture creates a layered defense:

```
┌────────────────────────────────────────────────────────────┐
│                    Main Process                             │
│  Full Node.js + Electron APIs                              │
│  - File system, network, native modules                    │
│  - Window management, system dialogs                       │
│  - IPC message handling and validation                     │
│                                                            │
│  ┌──────────────────── IPC Boundary ────────────────────┐  │
│  │                  Preload Script                       │  │
│  │  contextBridge: defines exact API surface             │  │
│  │  - Translates IPC calls into typed functions          │  │
│  │  - No business logic, only plumbing                   │  │
│  │                                                       │  │
│  │  ┌──────────── Context Isolation ──────────────────┐  │  │
│  │  │            Renderer Process                     │  │  │
│  │  │  Pure web environment (Chromium)                │  │  │
│  │  │  - React UI, DOM, Web APIs                     │  │  │
│  │  │  - No Node.js, no require()                    │  │  │
│  │  │  - Access only window.electronAPI              │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

If an attacker achieves XSS in the renderer, they can only call functions on
`window.electronAPI`. They cannot access the file system, spawn processes, or
execute arbitrary Node.js code. The main process must validate all IPC arguments
because the renderer is an untrusted boundary.

## Task Assignment Decision Matrix

| Task                          | Process   | Reason                                          |
|-------------------------------|-----------|--------------------------------------------------|
| File system operations        | Main      | Requires Node.js `fs` module                    |
| Database access               | Main      | Requires native modules (better-sqlite3, etc.)  |
| Window management             | Main      | BrowserWindow is a main-process API              |
| HTTP requests (with secrets)  | Main      | Auth tokens must not be exposed to renderer      |
| HTTP requests (public APIs)   | Renderer  | Acceptable if no secrets involved                |
| UI rendering                  | Renderer  | React, DOM manipulation, CSS                     |
| User input handling           | Renderer  | DOM events, form state                           |
| IPC channel exposure          | Preload   | contextBridge is the only safe bridge            |
| System dialogs (open/save)    | Main      | `dialog` is a main-process API                   |
| Notifications                 | Main      | `Notification` is a main-process API             |
| Clipboard access              | Main (IPC)| `clipboard` API, exposed via IPC                 |
| App menu construction         | Main      | `Menu` is a main-process API                     |
| Tray icon management          | Main      | `Tray` is a main-process API                     |
| Auto-updates                  | Main      | `electron-updater` runs in main                  |
| Drag and drop (files)         | Renderer  | DOM drag events, send paths via IPC to main      |
| Keyboard shortcuts            | Both      | `globalShortcut` in main, DOM events in renderer |

## Complete Flow: Saving a File

This walkthrough traces a user action from UI click to disk write and back.

### Step 1: User Clicks "Save" in React UI

```typescript
// src/renderer/src/components/SaveButton.tsx
function SaveButton({ content }: { content: string }) {
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const result = await window.electronAPI.saveFile(content);
      if (result.success) {
        console.log('Saved to:', result.data);
      } else {
        console.error('Save failed:', result.error);
      }
    } finally {
      setSaving(false);
    }
  }

  return <button onClick={handleSave} disabled={saving}>Save</button>;
}
```

### Step 2: Preload Bridge Translates the Call

```typescript
// src/preload/index.ts
contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (content: string) => ipcRenderer.invoke('save-file', content),
});
```

The `ipcRenderer.invoke()` call sends an asynchronous message to the main process
over the `save-file` channel and returns a Promise that resolves when the main
process handler returns.

### Step 3: Main Process Handles the Request

```typescript
// src/main/ipc/file-handlers.ts
ipcMain.handle('save-file', async (_event, content: string) => {
  // Validate input from the untrusted renderer
  if (typeof content !== 'string') {
    return { success: false, error: 'Invalid content type' };
  }

  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: 'untitled.txt',
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
  });

  if (canceled || !filePath) {
    return { success: false, error: 'User cancelled' };
  }

  try {
    await writeFile(filePath, content, 'utf-8');
    return { success: true, data: filePath };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});
```

### Step 4: Result Flows Back Through the Promise Chain

The return value from `ipcMain.handle` is serialized (using the structured clone
algorithm), sent back to the renderer, and resolves the Promise returned by
`ipcRenderer.invoke()`. The React component receives the result and updates UI.

```
User clicks Save
  → SaveButton.handleSave()
    → window.electronAPI.saveFile(content)      [renderer]
      → ipcRenderer.invoke('save-file', content) [preload → main]
        → ipcMain.handle('save-file', handler)   [main process]
          → dialog.showSaveDialog()
          → fs.writeFile()
          → return { success: true, data: filePath }
        ← Promise resolves with result           [main → renderer]
      ← result available in component
    → Update UI based on result
```

## Common Mistakes

### Mistake 1: Business Logic in the Preload Script

The preload script should be a thin translation layer, not a place for logic.

```typescript
// WRONG: Logic in preload
contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: async (content: string) => {
    // Do NOT put validation or transformation here
    const sanitized = content.replace(/<script>/g, '');
    return ipcRenderer.invoke('save-file', sanitized);
  },
});

// CORRECT: Preload is a passthrough, logic lives in main
contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (content: string) => ipcRenderer.invoke('save-file', content),
});
```

### Mistake 2: Accessing Node.js APIs from the Renderer

```typescript
// WRONG: This will throw -- fs is not available in the renderer
import { readFile } from 'fs/promises';

function FileViewer() {
  useEffect(() => {
    readFile('/path/to/file').then(setContent); // ReferenceError
  }, []);
}

// CORRECT: Use the preload bridge
function FileViewer() {
  useEffect(() => {
    window.electronAPI.readFile('/path/to/file').then((result) => {
      if (result.success) setContent(result.data);
    });
  }, []);
}
```

### Mistake 3: Exposing Raw ipcRenderer

```typescript
// WRONG: Gives renderer full IPC access
contextBridge.exposeInMainWorld('ipc', ipcRenderer);

// CORRECT: Expose only specific, typed functions
contextBridge.exposeInMainWorld('electronAPI', {
  readFile: (path: string) => ipcRenderer.invoke('read-file', path),
});
```

## Process Lifecycle

### Startup Sequence

1. Main process starts (`src/main/index.ts`)
2. `app.whenReady()` fires
3. Main creates BrowserWindow with preload path
4. Preload script executes, calls `contextBridge.exposeInMainWorld()`
5. Renderer loads HTML, then JavaScript (React app mounts)
6. Renderer can now call `window.electronAPI` methods

### Shutdown Sequence

1. User closes window or calls `app.quit()`
2. `window-all-closed` event fires on app
3. `before-quit` event fires (chance to save state)
4. Each BrowserWindow emits `close` event
5. Renderer processes are destroyed
6. Main process exits

```typescript
// Graceful shutdown with state persistence
app.on('before-quit', () => {
  store.set('windowBounds', mainWindow.getBounds());
});

mainWindow.on('close', (event) => {
  if (hasUnsavedChanges) {
    event.preventDefault();
    mainWindow.webContents.send('confirm-close');
  }
});
```

### Renderer Crash Recovery

If a renderer process crashes, the main process continues running. You can
detect and recover from crashes:

```typescript
mainWindow.webContents.on('render-process-gone', (_event, details) => {
  console.error('Renderer crashed:', details.reason);

  if (details.reason === 'crashed') {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'error',
      buttons: ['Reload', 'Quit'],
      message: 'The application encountered an error. Reload?',
    });

    if (choice === 0) {
      mainWindow.reload();
    } else {
      app.quit();
    }
  }
});
```

## See Also

- [Project Structure](./project-structure.md) -- Directory layout and where
  each process's code lives
- [Context Isolation](../security/context-isolation.md) -- Deep dive into
  contextBridge security patterns and common pitfalls
- [Typed IPC](../ipc/typed-ipc.md) -- Type-safe channel definitions that
  enforce correct argument and return types across the IPC boundary
- [Multi-Window State](./multi-window-state.md) -- State synchronization
  patterns when multiple BrowserWindows share data
