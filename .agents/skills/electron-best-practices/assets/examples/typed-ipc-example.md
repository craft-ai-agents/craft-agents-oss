# Complete Typed IPC Example

End-to-end example showing typed IPC from channel definitions through main process handlers, preload bridge, to renderer usage. This pattern ensures compile-time safety across the entire IPC boundary, catching mismatched arguments and return types before they become runtime bugs.

---

## Step 1: Shared Type Definitions

Define all IPC channels, their argument types, and return types in a single shared file. Both main and renderer code import from here, creating a single source of truth.

```typescript
// src/shared/ipc-types.ts

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Document {
  id: string;
  title: string;
  content: string;
  lastModified: Date;
}

// Channel map: defines args and return types for each channel
export type IpcChannelMap = {
  'user:get': { args: [id: string]; return: User | null };
  'user:list': { args: []; return: User[] };
  'document:save': { args: [doc: Document]; return: { success: boolean; path: string } };
  'document:open': { args: []; return: { success: boolean; content: string; path: string } | null };
  'app:version': { args: []; return: string };
};

// Event map: defines one-way events from main to renderer
export type IpcEventMap = {
  'document:changed': [path: string];
  'app:update-available': [version: string];
};
```

The `IpcChannelMap` type uses a mapped structure where each key is a channel name and each value defines the argument tuple and return type. The `IpcEventMap` covers one-way events pushed from main to renderer (no return value).

---

## Step 2: Type-Safe Handler Registration (Main)

Create a wrapper around `ipcMain.handle` that enforces the channel map types. This ensures every handler receives the correct arguments and returns the expected type.

```typescript
// src/main/ipc/typed-handler.ts

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import type { IpcChannelMap } from '../../shared/ipc-types';

type HandlerFn<K extends keyof IpcChannelMap> = (
  event: IpcMainInvokeEvent,
  ...args: IpcChannelMap[K]['args']
) => Promise<IpcChannelMap[K]['return']> | IpcChannelMap[K]['return'];

export function handleChannel<K extends keyof IpcChannelMap>(
  channel: K,
  handler: HandlerFn<K>
): void {
  ipcMain.handle(channel, (event, ...args) =>
    handler(event, ...(args as IpcChannelMap[K]['args']))
  );
}
```

The generic parameter `K` is constrained to keys of `IpcChannelMap`, so TypeScript will reject any channel name that is not defined in the map. The handler function signature is derived entirely from the map, so argument types and return types are enforced automatically.

---

## Step 3: Handler Implementations (Main)

Register concrete handlers for each channel. With the typed wrapper, the compiler verifies that each handler matches its channel signature.

```typescript
// src/main/ipc/user-handlers.ts

import { handleChannel } from './typed-handler';
import type { User } from '../../shared/ipc-types';

const users: User[] = [
  { id: '1', name: 'Alice', email: 'alice@example.com' },
  { id: '2', name: 'Bob', email: 'bob@example.com' },
];

export function registerUserHandlers(): void {
  handleChannel('user:get', async (_event, id) => {
    // TypeScript knows `id` is string
    return users.find(u => u.id === id) ?? null;
  });

  handleChannel('user:list', async () => {
    // Return type must be User[]
    return users;
  });
}
```

```typescript
// src/main/ipc/document-handlers.ts

import { dialog } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import { handleChannel } from './typed-handler';

export function registerDocumentHandlers(): void {
  handleChannel('document:save', async (_event, doc) => {
    // TypeScript knows `doc` is Document
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `${doc.title}.json`,
    });
    if (canceled || !filePath) {
      return { success: false, path: '' };
    }
    await writeFile(filePath, JSON.stringify(doc, null, 2));
    return { success: true, path: filePath };
  });

  handleChannel('document:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || filePaths.length === 0) return null;
    const content = await readFile(filePaths[0], 'utf-8');
    return { success: true, content, path: filePaths[0] };
  });

  handleChannel('app:version', () => {
    const { app } = require('electron');
    return app.getVersion();
  });
}
```

```typescript
// src/main/index.ts (registration entry point)

import { app, BrowserWindow } from 'electron';
import { registerUserHandlers } from './ipc/user-handlers';
import { registerDocumentHandlers } from './ipc/document-handlers';

app.whenReady().then(() => {
  registerUserHandlers();
  registerDocumentHandlers();

  const win = new BrowserWindow({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  // ... load renderer
});
```

---

## Step 4: Preload Script

The preload script bridges main and renderer. It uses `contextBridge.exposeInMainWorld` to expose a structured API object. The typed invoke and event helpers ensure the preload layer stays consistent with the channel map.

```typescript
// src/preload/index.ts

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { IpcChannelMap, IpcEventMap } from '../shared/ipc-types';

function typedInvoke<K extends keyof IpcChannelMap>(
  channel: K,
  ...args: IpcChannelMap[K]['args']
): Promise<IpcChannelMap[K]['return']> {
  return ipcRenderer.invoke(channel, ...args);
}

function typedOn<K extends keyof IpcEventMap>(
  channel: K,
  callback: (...args: IpcEventMap[K]) => void
): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) =>
    callback(...(args as IpcEventMap[K]));
  ipcRenderer.on(channel, handler);
  // Return cleanup function to prevent listener leaks
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('electronAPI', {
  user: {
    get: (id: string) => typedInvoke('user:get', id),
    list: () => typedInvoke('user:list'),
  },
  document: {
    save: (doc) => typedInvoke('document:save', doc),
    open: () => typedInvoke('document:open'),
    onChanged: (cb) => typedOn('document:changed', cb),
  },
  app: {
    getVersion: () => typedInvoke('app:version'),
    onUpdateAvailable: (cb) => typedOn('app:update-available', cb),
  },
});
```

The API is organized into domain namespaces (`user`, `document`, `app`) rather than exposing raw channel names. This gives renderer code a clean, discoverable interface. Each event listener returns a cleanup function to prevent memory leaks.

---

## Step 5: Type Declarations for the Renderer

Since `contextBridge.exposeInMainWorld` creates a runtime bridge, the renderer needs type declarations to know what `window.electronAPI` looks like.

```typescript
// src/preload/index.d.ts

import type { User, Document } from '../shared/ipc-types';

interface ElectronAPI {
  user: {
    get: (id: string) => Promise<User | null>;
    list: () => Promise<User[]>;
  };
  document: {
    save: (doc: Document) => Promise<{ success: boolean; path: string }>;
    open: () => Promise<{ success: boolean; content: string; path: string } | null>;
    onChanged: (callback: (path: string) => void) => () => void;
  };
  app: {
    getVersion: () => Promise<string>;
    onUpdateAvailable: (callback: (version: string) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
```

Include this file in your `tsconfig.json` under `"include"` or `"files"` so the renderer TypeScript compilation picks it up. The `declare global` block augments the `Window` interface so `window.electronAPI` is recognized everywhere in renderer code.

---

## Step 6: React Component Usage

With all the plumbing in place, renderer components get a fully typed, clean API with no awareness of IPC details.

```tsx
// src/renderer/src/components/UserList.tsx

import { useState, useEffect } from 'react';
import type { User } from '../../../shared/ipc-types';

export function UserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.user.list()
      .then(setUsers)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>
          {user.name} ({user.email})
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// src/renderer/src/components/DocumentEditor.tsx

import { useState, useEffect } from 'react';
import type { Document } from '../../../shared/ipc-types';

export function DocumentEditor() {
  const [doc, setDoc] = useState<Document | null>(null);

  useEffect(() => {
    // Listen for external file changes
    const cleanup = window.electronAPI.document.onChanged((path) => {
      console.log('Document changed externally:', path);
    });
    return cleanup;
  }, []);

  const handleOpen = async () => {
    const result = await window.electronAPI.document.open();
    if (result) {
      setDoc(JSON.parse(result.content));
    }
  };

  const handleSave = async () => {
    if (!doc) return;
    const result = await window.electronAPI.document.save(doc);
    if (result.success) {
      console.log('Saved to:', result.path);
    }
  };

  return (
    <div>
      <button onClick={handleOpen}>Open</button>
      <button onClick={handleSave} disabled={!doc}>Save</button>
      {doc && (
        <textarea
          value={doc.content}
          onChange={e => setDoc({ ...doc, content: e.target.value })}
        />
      )}
    </div>
  );
}
```

---

## Summary

**Key takeaways from this pattern:**

1. **Single source of truth.** `IpcChannelMap` and `IpcEventMap` in `src/shared/ipc-types.ts` define every channel, its arguments, and its return type. When you add or change a channel, the compiler forces updates everywhere that channel is used.

2. **Type safety at every boundary.** The `handleChannel` wrapper on the main side and `typedInvoke`/`typedOn` helpers on the preload side both derive their types from the shared map. Mismatched arguments or return types are caught at compile time.

3. **Clean renderer API.** The preload script organizes channels into domain namespaces (`user`, `document`, `app`). Renderer components never reference raw channel strings, making the API discoverable and refactor-safe.

4. **Event listener cleanup.** Every `typedOn` call returns an unsubscribe function. React components use this in `useEffect` cleanup to prevent listener leaks when components unmount.

5. **Separation of concerns.** Handler registration is split into focused modules (`user-handlers.ts`, `document-handlers.ts`) that can be tested independently. The preload script is a thin bridge, not a place for business logic.

6. **Adding a new channel** requires changes in exactly four places: the shared type map, the handler implementation, the preload bridge, and the type declaration file. The compiler guides you through each one.
