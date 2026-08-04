# Preload Script Template

This template provides a type-safe preload script that bridges the main and renderer processes using Electron's `contextBridge`. It exposes a structured API object on `window.electronAPI` with invoke wrappers for request/response calls and event listeners that return cleanup functions to prevent memory leaks.

```typescript
/**
 * Preload Script
 *
 * Secure bridge between main and renderer processes.
 * Uses contextBridge to expose typed API functions.
 *
 * TODO: Add your IPC channel wrappers
 * TODO: Update type declarations in preload.d.ts
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Type-safe invoke wrapper
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args);
}

// Type-safe event listener with cleanup
function on<T>(channel: string, callback: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Expose API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // === File Operations ===
  // TODO: Add your file operation wrappers
  saveFile: (content: string) => invoke<{ success: boolean; path: string }>('save-file', content),
  openFile: () => invoke<{ success: boolean; content: string; path: string }>('open-file'),

  // === App Info ===
  getVersion: () => invoke<string>('get-app-version'),

  // === Events ===
  // TODO: Add your event listeners (always return cleanup function!)
  onFileChanged: (callback: (path: string) => void) => on('file-changed', callback),
  onUpdateAvailable: (callback: (version: string) => void) => on('update-available', callback),
});
```

The following type declaration file should be placed alongside your preload script so the renderer process gets full type safety when accessing `window.electronAPI`.

```typescript
// preload.d.ts
interface ElectronAPI {
  // File Operations
  saveFile: (content: string) => Promise<{ success: boolean; path: string }>;
  openFile: () => Promise<{ success: boolean; content: string; path: string }>;

  // App Info
  getVersion: () => Promise<string>;

  // Events (return cleanup function)
  onFileChanged: (callback: (path: string) => void) => () => void;
  onUpdateAvailable: (callback: (version: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
```

## Customization Notes

- **Adding new IPC channels**: For each new channel, add a wrapper function in the `contextBridge.exposeInMainWorld` call and a matching entry in the `ElectronAPI` interface in `preload.d.ts`. Keep both files in sync.
- **Invoke vs. event patterns**: Use `invoke` for request/response operations where the renderer needs a result back from main. Use `on` for push-style events where the main process notifies the renderer asynchronously.
- **Cleanup functions**: Every event listener returns an unsubscribe function. In React components, call this in `useEffect` cleanup to prevent memory leaks. Never register listeners without a corresponding cleanup path.
- **Channel naming**: Use descriptive, kebab-case channel names (e.g., `save-file`, `file-changed`). Group related channels with a common prefix for clarity.
- **Type safety**: The generic type parameters on `invoke<T>` and `on<T>` flow through to the API surface. Keep the generics accurate so renderer code gets correct type checking.
- **Security boundary**: The preload script is the only place where `ipcRenderer` should be used. Never expose `ipcRenderer` directly to the renderer. The `contextBridge` ensures only the explicitly listed functions are accessible.
- **Allowed channels pattern**: For additional security, you can maintain an allowlist of channel names and validate against it in the `invoke` and `on` wrappers before forwarding to `ipcRenderer`.
