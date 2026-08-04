# Context Isolation and the Security Sandbox

Context isolation is the single most important security boundary in an Electron
application. It ensures that the renderer process's JavaScript world is
completely separated from the preload script's world, preventing untrusted web
content from accessing Node.js or Electron internals.

## Why Context Isolation Matters

Electron apps combine a Chromium renderer with Node.js capabilities. Without
context isolation, any JavaScript running in a renderer (including injected
scripts, XSS payloads, or compromised third-party libraries) can access
`require()`, `process`, and the full Node.js API. This effectively turns any
XSS vulnerability into a remote code execution vulnerability.

Context isolation was introduced as an option in Electron 5, became the default
in Electron 12, and is mandatory (cannot be disabled) since Electron 20.

## The Three Security Pillars

Every `BrowserWindow` must enforce all three settings. Omitting any one of them
weakens the security boundary:

```typescript
// main.ts - Secure BrowserWindow configuration
import { BrowserWindow } from 'electron';

const win = new BrowserWindow({
  webPreferences: {
    contextIsolation: true,   // Separate JS worlds (mandatory since Electron 20)
    sandbox: true,            // Restrict preload to limited polyfill environment
    nodeIntegration: false,   // Prevent renderer from accessing Node.js directly
    preload: path.join(__dirname, 'preload.js'),
  },
});
```

### What Each Pillar Does

| Setting            | Purpose                                                      |
|--------------------|--------------------------------------------------------------|
| `contextIsolation` | Creates separate JS worlds for preload and renderer content  |
| `sandbox`          | Runs preload in Chromium sandbox with limited Node polyfills |
| `nodeIntegration`  | When false, blocks `require()` and `process` in renderer     |

### Why All Three Are Required

- `contextIsolation` alone still allows the preload script full Node.js access.
- `nodeIntegration: false` alone does not prevent prototype pollution attacks
  from reaching the preload context if isolation is off.
- `sandbox: true` further limits what the preload script can do, restricting it
  to a polyfilled subset of Node.js APIs (no `child_process`, no `fs`, etc.).

## How contextBridge.exposeInMainWorld Works

The `contextBridge` module is the only safe way to pass functionality from the
preload script to the renderer. It creates a frozen, structured-clone copy of
the exposed object in the renderer's JavaScript world.

Key behaviors:
- Functions are wrapped as proxies; they cannot be inspected or modified.
- Primitive values are copied by value.
- Objects and arrays are deep-cloned using the structured clone algorithm.
- Promises returned by `ipcRenderer.invoke` are properly proxied.
- Callbacks passed from the renderer are wrapped for safety.

```typescript
// preload.ts - Basic API exposure
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  openFile: () => ipcRenderer.invoke('dialog-open-file'),
});
```

The renderer can then call `window.electronAPI.getVersion()` without any
knowledge of IPC, Node.js, or Electron internals.

## Secure Preload Script Pattern

A production preload script should wrap every IPC channel in a typed function,
validate arguments at the boundary, and provide cleanup mechanisms for event
listeners.

```typescript
// preload.ts - SECURE: Full typed preload with cleanup
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Invoke (request/response) ---
  loadPreferences: () => ipcRenderer.invoke('load-prefs'),
  saveFile: (content: string) => ipcRenderer.invoke('save-file', content),
  showOpenDialog: (options: { filters?: Array<{ name: string; extensions: string[] }> }) =>
    ipcRenderer.invoke('dialog-open-file', options),

  // --- Send (fire-and-forget) ---
  logAnalyticsEvent: (eventName: string, payload: Record<string, unknown>) =>
    ipcRenderer.send('analytics-event', eventName, payload),

  // --- On (main-to-renderer, with cleanup) ---
  onUpdateCounter: (callback: (value: number) => void) => {
    const handler = (_event: IpcRendererEvent, value: number) => callback(value);
    ipcRenderer.on('update-counter', handler);
    return () => ipcRenderer.removeListener('update-counter', handler);
  },

  onFileChanged: (callback: (filePath: string) => void) => {
    const handler = (_event: IpcRendererEvent, filePath: string) => callback(filePath);
    ipcRenderer.on('file-changed', handler);
    return () => ipcRenderer.removeListener('file-changed', handler);
  },
});
```

### Why Return Unsubscribe Functions

Event listeners registered through `ipcRenderer.on` persist until explicitly
removed. If a React component mounts, subscribes, and unmounts without cleanup,
the listener leaks. Returning an unsubscribe function integrates cleanly with
framework lifecycle hooks:

```typescript
// React component using the cleanup pattern
import { useEffect, useState } from 'react';

function CounterDisplay() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // Subscribe and capture the unsubscribe function
    const unsubscribe = window.electronAPI.onUpdateCounter((value) => {
      setCount(value);
    });

    // Cleanup on unmount
    return unsubscribe;
  }, []);

  return <div>Count: {count}</div>;
}
```

This pattern prevents memory leaks and ensures deterministic behavior when
components re-render or unmount.

## TypeScript Declarations for Exposed APIs

To get type safety across the preload boundary, declare the shape of
`window.electronAPI` in a `.d.ts` file that both the preload and renderer
projects reference:

```typescript
// preload.d.ts - Type declarations for the exposed API
interface DialogOpenOptions {
  filters?: Array<{ name: string; extensions: string[] }>;
}

interface DialogOpenResult {
  canceled: boolean;
  filePaths: string[];
}

interface UserPreferences {
  theme: 'light' | 'dark';
  fontSize: number;
  recentFiles: string[];
}

interface ElectronAPI {
  // Invoke channels
  loadPreferences: () => Promise<UserPreferences>;
  saveFile: (content: string) => Promise<{ success: boolean; path: string }>;
  showOpenDialog: (options: DialogOpenOptions) => Promise<DialogOpenResult>;

  // Send channels (fire-and-forget)
  logAnalyticsEvent: (eventName: string, payload: Record<string, unknown>) => void;

  // Listener channels (return unsubscribe function)
  onUpdateCounter: (callback: (value: number) => void) => () => void;
  onFileChanged: (callback: (filePath: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
```

Place this file where both your preload and renderer TypeScript configs can
resolve it (commonly `src/shared/preload.d.ts` or alongside your preload
entry point).

For advanced typed IPC patterns including channel name type safety and payload
validation, see [Typed IPC Patterns](../ipc/typed-ipc.md).

## How Sandbox Mode Restricts the Preload

When `sandbox: true` is set, the preload script runs in a restricted
environment with only polyfilled versions of certain Node.js modules:

| Available in Sandbox         | NOT Available in Sandbox     |
|------------------------------|------------------------------|
| `require` (limited subset)   | `child_process`              |
| `Buffer`                     | `fs`                         |
| `process` (limited)          | `path` (full)                |
| `setTimeout` / `setInterval` | `os`                         |
| `crypto` (limited)           | `net`, `http`, `https`       |
| `events` (EventEmitter)      | Native Node addons           |

This means the preload script cannot read files, spawn processes, or make
network requests directly. All such operations must go through IPC to the
main process, where they can be validated and authorized.

```typescript
// This FAILS in sandbox mode:
import fs from 'fs';
const data = fs.readFileSync('/etc/passwd'); // Error: fs is not available

// Instead, request it through IPC:
const data = await ipcRenderer.invoke('read-file', '/path/to/allowed/file');
// The main process handler validates the path before reading.
```

## Common Mistakes

### Mistake 1: Exposing ipcRenderer Directly

```typescript
// INSECURE - NEVER DO THIS
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: ipcRenderer  // Exposes ALL IPC channels!
});
```

This gives the renderer full access to every IPC channel in your application.
A single XSS vulnerability lets an attacker invoke any handler, including ones
that read files, execute commands, or modify system state.

### Mistake 2: Exposing ipcRenderer Methods Without Channel Restriction

```typescript
// INSECURE - Still dangerous
contextBridge.exposeInMainWorld('electron', {
  invoke: (channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),
});
```

Even though this wraps `invoke`, it accepts any channel name. The renderer can
call `window.electron.invoke('delete-all-data')` or any other channel. Always
expose named functions for specific channels.

### Mistake 3: Using nodeIntegration in Production

```typescript
// INSECURE - Never use in production
new BrowserWindow({
  webPreferences: {
    nodeIntegration: true,     // Gives renderer full Node.js access
    contextIsolation: false,   // Removes the security boundary
  },
});
```

This disables all security boundaries. While it simplifies development, it
means any content loaded in the renderer (including remote URLs, iframes, or
injected scripts) has full system access.

### Mistake 4: Forgetting Listener Cleanup

```typescript
// LEAKY - No way to unsubscribe
contextBridge.exposeInMainWorld('electronAPI', {
  onProgress: (callback: (pct: number) => void) => {
    ipcRenderer.on('download-progress', (_e, pct) => callback(pct));
    // No return value = no way to clean up
  },
});
```

Always return a function that removes the listener, as shown in the secure
pattern above.

## Verifying Context Isolation at Runtime

You can verify that isolation is active by checking for the absence of Node
globals in the renderer console:

```javascript
// In the renderer's DevTools console:
console.log(typeof require);   // Should be "undefined"
console.log(typeof process);   // Should be "undefined"
console.log(typeof Buffer);    // Should be "undefined"

// The exposed API should be present:
console.log(typeof window.electronAPI); // Should be "object"
```

If `require` or `process` are accessible in the renderer, context isolation
is not working correctly.

## Migration Guide: nodeIntegration to contextBridge

If you are migrating an existing app that uses `nodeIntegration: true`:

1. Create a preload script that exposes only the channels your renderer uses.
2. In the renderer, replace all `require('electron')` calls with
   `window.electronAPI.*` calls.
3. Replace all `ipcRenderer.send/invoke` calls with the named wrapper
   functions.
4. Set `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
5. Test every IPC interaction to confirm the bridge works.
6. Run the security checklist (see [Security Checklist](./security-checklist.md)).

## See Also

- [Typed IPC Patterns](../ipc/typed-ipc.md) - Channel-level type safety and
  payload validation for IPC communication.
- [CSP and Permissions](./csp-and-permissions.md) - Content Security Policy
  and permission handling to complement context isolation.
- [Security Checklist](./security-checklist.md) - Pre-deployment audit
  checklist covering all security settings.
