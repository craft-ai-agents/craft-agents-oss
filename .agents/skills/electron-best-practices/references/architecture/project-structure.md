# Project Structure: Directory Layout and electron-vite Configuration

This reference covers the recommended directory organization for Electron applications
built with electron-vite and React, including configuration patterns, build tooling
setup, and the rationale behind each structural decision.

## Scaffolding a New Project

The fastest way to start is with the official electron-vite template:

```bash
npm create @quick-start/electron@latest my-app -- --template react-ts
```

This generates a fully configured project with TypeScript, React, and secure defaults.
The template includes separate TypeScript configurations per process, a working
electron-vite config, and a preload script with contextBridge already wired up.

## Recommended Directory Layout

```
my-electron-app/
├── electron.vite.config.ts    # Unified build config for all three processes
├── package.json               # Scripts, dependencies, Electron Forge config
├── tsconfig.json              # Base TypeScript config (shared settings)
├── tsconfig.node.json         # Main + preload process config (extends base)
├── tsconfig.web.json          # Renderer process config (extends base)
├── src/
│   ├── main/                  # Main process (Node.js environment)
│   │   ├── index.ts           # App entry point, BrowserWindow creation
│   │   └── ipc/               # IPC handler modules
│   │       ├── file-handlers.ts
│   │       └── app-handlers.ts
│   ├── preload/               # Secure bridge between main and renderer
│   │   ├── index.ts           # contextBridge API exposure
│   │   └── index.d.ts         # TypeScript declarations for renderer
│   ├── renderer/              # React application (pure web environment)
│   │   ├── index.html         # HTML entry point (Vite uses this)
│   │   └── src/
│   │       ├── App.tsx        # Root React component
│   │       ├── main.tsx       # React DOM root creation
│   │       ├── components/    # Reusable UI components
│   │       ├── hooks/         # Custom React hooks (including IPC hooks)
│   │       ├── pages/         # Route-level components (if using routing)
│   │       └── assets/        # Static assets (images, fonts, CSS)
│   └── shared/                # Shared type definitions (no runtime code)
│       └── ipc-types.ts       # IPC channel type map
├── resources/                 # App icons, build assets, platform resources
├── out/                       # Build output (gitignored)
└── dev-app-update.yml         # Auto-update config for development
```

## Directory Responsibilities

### `src/main/` -- Main Process

The main process runs in a full Node.js environment. It manages application
lifecycle, creates and controls BrowserWindows, handles IPC from renderers,
and accesses system APIs (file system, native dialogs, notifications).

```typescript
// src/main/index.ts
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { registerFileHandlers } from './ipc/file-handlers';
import { registerAppHandlers } from './ipc/app-handlers';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // electron-vite handles dev server vs production file loading
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  registerFileHandlers();
  registerAppHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

Organize IPC handlers into separate modules under `src/main/ipc/` by domain.
This keeps the main entry file focused on lifecycle and window management.

```typescript
// src/main/ipc/file-handlers.ts
import { ipcMain, dialog } from 'electron';
import { readFile, writeFile } from 'fs/promises';

export function registerFileHandlers(): void {
  ipcMain.handle('save-file', async (_event, content: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });

    if (canceled || !filePath) {
      return { success: false, error: 'Save cancelled' };
    }

    try {
      await writeFile(filePath, content, 'utf-8');
      return { success: true, data: filePath };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('open-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Text', extensions: ['txt', 'md'] }],
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, error: 'Open cancelled' };
    }

    try {
      const content = await readFile(filePaths[0], 'utf-8');
      return { success: true, data: { path: filePaths[0], content } };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
```

### `src/preload/` -- Secure Bridge

The preload script runs in a restricted context with access to contextBridge.
It defines the exact API surface available to the renderer. Keep preload scripts
thin -- they should only translate between IPC calls and the exposed API.

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Request-response (invoke/handle)
  saveFile: (content: string) => ipcRenderer.invoke('save-file', content),
  openFile: () => ipcRenderer.invoke('open-file'),

  // Event subscriptions (returns cleanup function)
  onFileChanged: (callback: (path: string) => void) => {
    const handler = (_event: IpcRendererEvent, path: string) => callback(path);
    ipcRenderer.on('file-changed', handler);
    return () => ipcRenderer.removeListener('file-changed', handler);
  },
});
```

```typescript
// src/preload/index.d.ts
export interface ElectronAPI {
  saveFile: (content: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  openFile: () => Promise<{ success: boolean; data?: { path: string; content: string }; error?: string }>;
  onFileChanged: (callback: (path: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
```

### `src/renderer/` -- React Application

The renderer is a standard React application with no Node.js access. It
communicates with the main process exclusively through `window.electronAPI`.
Organize it as you would any React project -- components, hooks, pages, assets.

```typescript
// src/renderer/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './assets/main.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

### `src/shared/` -- Shared Types

This directory holds TypeScript type definitions shared across processes.
It must contain only types and interfaces -- no runtime code. This is the
single source of truth for IPC channel definitions.

```typescript
// src/shared/ipc-types.ts
export type IpcChannelMap = {
  'save-file': { args: [content: string]; return: IpcResult<string> };
  'open-file': { args: []; return: IpcResult<{ path: string; content: string }> };
};

export type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

// Event channels (main -> renderer)
export type IpcEventMap = {
  'file-changed': [path: string];
};
```

## Configuration Files

### electron-vite Unified Config

electron-vite manages three separate Vite build pipelines through a single
configuration file. Each key (`main`, `preload`, `renderer`) configures one
process with independent plugins, aliases, and build targets.

```typescript
// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
  },
});
```

The `externalizeDepsPlugin()` is critical for main and preload -- it prevents
bundling Node.js built-in modules and Electron APIs, which must be resolved
at runtime rather than at build time.

### TypeScript Configuration

Use three TypeScript configs to enforce process boundaries at the type level.

```jsonc
// tsconfig.json (base, shared settings)
{
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "paths": {
      "@shared/*": ["./src/shared/*"]
    }
  }
}
```

```jsonc
// tsconfig.node.json (main + preload)
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ESNext",
    "types": ["node"]
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*"]
}
```

```jsonc
// tsconfig.web.json (renderer)
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ESNext",
    "jsx": "react-jsx",
    "lib": ["DOM", "DOM.Iterable", "ESNext"],
    "types": ["vite/client"]
  },
  "include": ["src/renderer/**/*", "src/shared/**/*", "src/preload/index.d.ts"]
}
```

Note that `tsconfig.web.json` includes `src/preload/index.d.ts` so the renderer
knows the shape of `window.electronAPI` at compile time.

### package.json Key Scripts

```jsonc
{
  "name": "my-electron-app",
  "version": "1.0.0",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "start": "electron-vite preview",
    "lint": "eslint . --ext .ts,.tsx",
    "typecheck:node": "tsc --noEmit -p tsconfig.node.json",
    "typecheck:web": "tsc --noEmit -p tsconfig.web.json",
    "typecheck": "npm run typecheck:node && npm run typecheck:web",
    "package": "electron-forge package",
    "make": "electron-forge make",
    "publish": "electron-forge publish"
  }
}
```

The `main` field points to the built output, not the source. electron-vite's
`dev` command starts the Vite dev server for the renderer with HMR and watches
main/preload sources for changes, restarting Electron on rebuild.

## Build Output Structure

After running `electron-vite build`, the `out/` directory mirrors the `src/`
structure with compiled JavaScript:

```
out/
├── main/
│   └── index.js           # Bundled main process
├── preload/
│   └── index.js           # Bundled preload script
└── renderer/
    ├── index.html         # Processed HTML
    └── assets/            # Bundled CSS, JS, images
```

This clean separation ensures each process loads only its own bundle. The
preload path in BrowserWindow configuration points to `out/preload/index.js`.

## See Also

- [Process Separation](./process-separation.md) -- Detailed guide on what code
  belongs in each process and the security boundaries between them
- [electron-vite Configuration](../tooling/electron-vite.md) -- Advanced
  electron-vite configuration including environment variables and custom plugins
- [Electron Forge](../tooling/electron-forge.md) -- Packaging, code signing,
  and distribution configuration
- [Typed IPC](../ipc/typed-ipc.md) -- Full type-safe IPC channel patterns
  using the shared types directory
