# Manual Typed IPC with Mapped Types

## Overview

Electron's IPC system uses string channel names and untyped arguments by default.
This creates a class of bugs that only surface at runtime: misspelled channel names,
wrong argument types, mismatched return types between main and renderer. TypeScript
mapped types let you define a single source of truth for every IPC channel, then
enforce those contracts at compile time across main, preload, and renderer code.

This reference covers the manual approach using TypeScript's type system directly,
without third-party libraries.

---

## Why Type-Safe IPC Matters

Without type safety, IPC channels are just strings:

```typescript
// renderer - sends a number
window.electronAPI.invoke('get-user', 42);

// main - expects a string
ipcMain.handle('get-user', (_event, id: string) => {
  return db.findUser(id); // id is actually 42, not "42"
});
```

Common failure modes in untyped IPC:

- **Channel name typos**: `'save-docment'` vs `'save-document'` -- silent failure
- **Wrong argument types**: sending `number` where `string` is expected
- **Wrong argument count**: forgetting a required parameter
- **Mismatched return types**: renderer expects `User`, main returns `User | null`
- **Stale channels**: renaming a channel in main but not in preload

All of these are caught at compile time with the pattern below.

---

## The IpcChannelMap Pattern

Define a single type that maps every channel name to its argument tuple and
return type. This lives in a shared module imported by both main and renderer code.

```typescript
// shared/ipc-types.ts

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Document {
  id: string;
  title: string;
  content: string;
}

/**
 * Maps invoke/handle channel names to their argument and return types.
 * Each key is a channel name. Each value defines the args tuple and return type.
 */
export type IpcChannelMap = {
  'get-user': {
    args: [id: string];
    return: User | null;
  };
  'save-document': {
    args: [doc: Document];
    return: { success: boolean; path: string };
  };
  'get-app-version': {
    args: [];
    return: string;
  };
  'read-file': {
    args: [filePath: string, encoding: BufferEncoding];
    return: string;
  };
  'list-recent-files': {
    args: [];
    return: Array<{ name: string; path: string; modified: number }>;
  };
};
```

This type serves as the contract. Every layer of the application references it.

---

## One-Way Event Channels

For fire-and-forget messages (main-to-renderer or renderer-to-main), define a
separate map without return types:

```typescript
// shared/ipc-types.ts (continued)

/**
 * Maps one-way event channel names to their argument types.
 * Used for send/on patterns where no response is expected.
 */
export type IpcEventMap = {
  'download-progress': { args: [percent: number] };
  'state-changed': { args: [key: string, value: unknown] };
  'notification': { args: [title: string, body: string] };
  'window-focus-changed': { args: [focused: boolean] };
};
```

---

## Typed Main Process Handlers

Wrap `ipcMain.handle` to enforce that the handler signature matches the channel map:

```typescript
// main/ipc-handler.ts
import { ipcMain, type BrowserWindow } from 'electron';
import type { IpcChannelMap, IpcEventMap } from '../shared/ipc-types';

/**
 * Register a typed invoke/handle pair.
 * The handler's arguments and return type are inferred from IpcChannelMap.
 */
export function handleIpc<K extends keyof IpcChannelMap>(
  channel: K,
  handler: (
    ...args: IpcChannelMap[K]['args']
  ) => Promise<IpcChannelMap[K]['return']> | IpcChannelMap[K]['return']
): void {
  ipcMain.handle(channel, (_event, ...args) => {
    return handler(...(args as IpcChannelMap[K]['args']));
  });
}

/**
 * Remove a typed handler.
 */
export function removeHandler<K extends keyof IpcChannelMap>(channel: K): void {
  ipcMain.removeHandler(channel);
}

/**
 * Send a typed one-way event from main to a renderer window.
 */
export function sendToRenderer<K extends keyof IpcEventMap>(
  window: BrowserWindow,
  channel: K,
  ...args: IpcEventMap[K]['args']
): void {
  window.webContents.send(channel, ...args);
}
```

Usage in the main process:

```typescript
// main/handlers/user-handlers.ts
import { handleIpc } from '../ipc-handler';
import { getUserById } from '../services/user-service';

handleIpc('get-user', async (id) => {
  // id is inferred as string
  // return type must be User | null
  return getUserById(id);
});

handleIpc('get-app-version', () => {
  // no args, must return string
  return app.getVersion();
});

// Type error: argument type mismatch
handleIpc('get-user', async (id: number) => {
  //                          ^^^^^^^^^^
  // Error: Type 'number' is not assignable to type 'string'
  return null;
});
```

---

## Typed Preload Bridge

The preload script creates the bridge between main and renderer. Typed wrappers
ensure the exposed API matches the channel contracts:

```typescript
// preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcChannelMap, IpcEventMap } from '../shared/ipc-types';

/**
 * Type-safe invoke wrapper.
 */
function typedInvoke<K extends keyof IpcChannelMap>(
  channel: K,
  ...args: IpcChannelMap[K]['args']
): Promise<IpcChannelMap[K]['return']> {
  return ipcRenderer.invoke(channel, ...args);
}

/**
 * Type-safe event listener for main-to-renderer events.
 */
function typedOn<K extends keyof IpcEventMap>(
  channel: K,
  callback: (...args: IpcEventMap[K]['args']) => void
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
    callback(...(args as IpcEventMap[K]['args']));
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Expose typed API to renderer
const electronAPI = {
  getUser: (id: string) => typedInvoke('get-user', id),
  saveDocument: (doc: Parameters<typeof typedInvoke<'save-document'>>[1]) =>
    typedInvoke('save-document', doc),
  getAppVersion: () => typedInvoke('get-app-version'),
  readFile: (path: string, encoding: BufferEncoding) =>
    typedInvoke('read-file', path, encoding),
  listRecentFiles: () => typedInvoke('list-recent-files'),

  onDownloadProgress: (cb: (percent: number) => void) =>
    typedOn('download-progress', cb),
  onStateChanged: (cb: (key: string, value: unknown) => void) =>
    typedOn('state-changed', cb),
};

export type ElectronAPI = typeof electronAPI;

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
```

---

## Renderer-Side Type Declarations

Declare the global type so the renderer can use `window.electronAPI` with
full type information:

```typescript
// renderer/global.d.ts
import type { ElectronAPI } from '../preload/index';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
```

Usage in the renderer:

```typescript
// renderer/components/UserProfile.tsx
async function loadUser(id: string) {
  const user = await window.electronAPI.getUser(id);
  // user is typed as User | null
  if (user) {
    setName(user.name);
  }
}

// Type error: wrong argument type
await window.electronAPI.getUser(42);
//                                ^^
// Error: Argument of type 'number' is not assignable to type 'string'

// Type error: missing argument
await window.electronAPI.readFile('/path/to/file');
// Error: Expected 2 arguments, but got 1
```

---

## End-to-End Example: Adding a New Channel

To add a new `delete-document` channel, you touch exactly three places:

**Step 1** -- Add to the channel map:

```typescript
// shared/ipc-types.ts
export type IpcChannelMap = {
  // ...existing channels...
  'delete-document': {
    args: [documentId: string, permanent: boolean];
    return: { deleted: boolean };
  };
};
```

**Step 2** -- Register the handler:

```typescript
// main/handlers/document-handlers.ts
handleIpc('delete-document', async (documentId, permanent) => {
  // documentId: string, permanent: boolean -- inferred from map
  const deleted = await documentService.delete(documentId, { permanent });
  return { deleted };
});
```

**Step 3** -- Expose in preload:

```typescript
// preload/index.ts (add to electronAPI object)
deleteDocument: (id: string, permanent: boolean) =>
  typedInvoke('delete-document', id, permanent),
```

If any layer has a type mismatch, the compiler catches it immediately.

---

## Tradeoffs vs electron-trpc

| Aspect | Manual Typed IPC | electron-trpc |
|--------|-----------------|---------------|
| Setup complexity | Low -- just TypeScript types | Medium -- tRPC + Zod + link setup |
| Runtime validation | None (compile-time only) | Full Zod validation at runtime |
| Bundle size | Zero additional deps | tRPC + Zod (~30-50KB) |
| Boilerplate | More manual wiring | Less -- auto-generated client |
| Subscriptions | Manual event wiring | Built-in observable support |
| React integration | Manual state management | React Query hooks out of the box |
| Refactoring safety | Good (compile-time) | Better (runtime + compile-time) |
| Learning curve | Low (just TypeScript) | Medium (tRPC concepts) |

Use manual typed IPC when you want zero dependencies and full control over the
IPC layer. Use electron-trpc when your app has many channels and you want
runtime validation, automatic client generation, and React Query integration.

---

## See Also

- [electron-trpc](./electron-trpc.md) -- Full tRPC-based approach for complex apps
- [Error Serialization](./error-serialization.md) -- Handling errors across the IPC boundary
- [Context Isolation](../security/context-isolation.md) -- Security foundation that typed IPC builds on
