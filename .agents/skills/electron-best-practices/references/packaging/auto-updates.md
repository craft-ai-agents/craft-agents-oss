# Auto-Update Implementation

## Overview

Shipping an Electron app without auto-update is shipping a dead product. Users will
not manually download new versions. The `electron-updater` package (from the
electron-builder ecosystem but compatible with any packaging tool) is the most
widely used solution. It supports GitHub Releases, S3, generic HTTP servers, and
differential updates out of the box.

---

## Update Server Options

### update.electronjs.org (Free, Open Source Only)

```typescript
import { autoUpdater } from 'electron';
const server = 'https://update.electronjs.org';
const repo = 'your-org/your-app';
const url = `${server}/${repo}/${process.platform}-${process.arch}/${app.getVersion()}`;
autoUpdater.setFeedURL({ url });
```

Limitations: macOS and Windows only, no staged rollouts, no differential updates.

### GitHub Releases with electron-updater

```typescript
import { autoUpdater } from 'electron-updater';
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'your-org',
  repo: 'your-app',
  private: true,
  token: process.env.GH_TOKEN,
});
```

### S3 or Generic HTTP Server

```typescript
// S3 provider
autoUpdater.setFeedURL({
  provider: 's3',
  bucket: 'your-app-releases',
  region: 'us-east-1',
  path: '/releases',
});

// Generic server - host latest.yml and installer files at any URL
autoUpdater.setFeedURL({
  provider: 'generic',
  url: 'https://releases.yourapp.com/updates',
});
```

---

## Main Process Integration

```typescript
// main/updater.ts
import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log';

autoUpdater.logger = log;

export function setupAutoUpdater(mainWindow: BrowserWindow): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    mainWindow.webContents.send('update:available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('update:progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    mainWindow.webContents.send('update:ready', { version: info.version });
  });

  autoUpdater.on('error', (err: Error) => {
    log.error('Update error:', err);
    mainWindow.webContents.send('update:error', err.message);
  });

  // IPC handlers for renderer control
  ipcMain.handle('update:check', () => autoUpdater.checkForUpdates());
  ipcMain.handle('update:download', () => autoUpdater.downloadUpdate());
  ipcMain.handle('update:install', () => {
    setImmediate(() => autoUpdater.quitAndInstall());
  });

  // Check every 4 hours
  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  setInterval(() => autoUpdater.checkForUpdates().catch(log.error), FOUR_HOURS);
  setTimeout(() => autoUpdater.checkForUpdates().catch(log.error), 10_000);
}
```

### Preload Script Exposure

```typescript
// preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronUpdater', {
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onAvailable: (cb: (info: any) => void) =>
    ipcRenderer.on('update:available', (_e, info) => cb(info)),
  onProgress: (cb: (progress: any) => void) =>
    ipcRenderer.on('update:progress', (_e, progress) => cb(progress)),
  onReady: (cb: (info: any) => void) =>
    ipcRenderer.on('update:ready', (_e, info) => cb(info)),
  onError: (cb: (message: string) => void) =>
    ipcRenderer.on('update:error', (_e, message) => cb(message)),
});
```

---

## Renderer UI Patterns

### React Hook for Update State

```typescript
// renderer/hooks/useAutoUpdate.ts
import { useEffect, useState } from 'react';

interface UpdateState {
  status: 'idle' | 'available' | 'downloading' | 'ready' | 'error';
  version?: string;
  percent?: number;
}

export function useAutoUpdate(): UpdateState & { install: () => void } {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });

  useEffect(() => {
    window.electronUpdater.onAvailable((info) => {
      setState({ status: 'available', version: info.version });
      window.electronUpdater.downloadUpdate(); // Silent download
    });
    window.electronUpdater.onProgress((p) => {
      setState((prev) => ({ ...prev, status: 'downloading', percent: p.percent }));
    });
    window.electronUpdater.onReady((info) => {
      setState({ status: 'ready', version: info.version });
    });
    window.electronUpdater.onError(() => setState({ status: 'error' }));
  }, []);

  return { ...state, install: () => window.electronUpdater.installUpdate() };
}
```

### Update Banner Component

```tsx
function UpdateBanner() {
  const update = useAutoUpdate();

  if (update.status === 'downloading') {
    return (
      <div className="update-banner">
        <p>Downloading update... {update.percent?.toFixed(0)}%</p>
        <progress value={update.percent} max={100} />
      </div>
    );
  }
  if (update.status === 'ready') {
    return (
      <div className="update-banner">
        <p>Version {update.version} ready. Restart to apply.</p>
        <button onClick={update.install}>Restart Now</button>
      </div>
    );
  }
  return null;
}
```

---

## Staged Rollouts

Gradually roll out updates by setting `stagingPercentage` in `latest.yml`:

```yaml
# latest.yml - Staged rollout at 10%
version: 2.1.0
files:
  - url: YourApp-2.1.0.exe
    sha512: abc123...
    size: 58000000
stagingPercentage: 10
# Increase to 50% after 24 hours, then 100% after 48 hours
```

## Differential Updates

`electron-updater` supports blockmap-based differential updates. Only changed
blocks are downloaded. Blockmaps are generated automatically for NSIS and AppImage
targets. Typical savings: a 60 MB app with minor changes downloads only 5-10 MB.

---

## Security Considerations

- **Always use HTTPS** for the update feed URL
- **Sign all releases** -- `electron-updater` verifies signatures automatically
- **Never expose tokens to the renderer process**

```typescript
// BAD - Token accessible to renderer
contextBridge.exposeInMainWorld('config', {
  ghToken: process.env.GH_TOKEN, // NEVER do this
});

// GOOD - Token stays in main process
autoUpdater.setFeedURL({ provider: 'github', token: process.env.GH_TOKEN });
```

---

## Testing Updates in Development

```bash
# Serve local update files
npx http-server ./test-updates -p 8080
```

```typescript
// Override feed URL in development
if (!app.isPackaged) {
  autoUpdater.setFeedURL({ provider: 'generic', url: 'http://localhost:8080' });
  autoUpdater.forceDevUpdateConfig = true;
}
```

Or create `dev-app-update.yml` in the project root:

```yaml
provider: generic
url: http://localhost:8080
updaterCacheDirName: your-app-updater
```

---

## See Also

- [Code Signing](./code-signing.md) - Updates must be signed for security
- [CI/CD Patterns](./ci-cd-patterns.md) - Automating release publishing
- [Typed IPC](../ipc/typed-ipc.md) - Type-safe IPC for update event channels
