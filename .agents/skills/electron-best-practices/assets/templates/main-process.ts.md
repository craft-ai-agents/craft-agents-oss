# Main Process Entry Point Template

This template provides a secure Electron main process entry point with sensible defaults. It includes a `BrowserWindow` configured with all recommended security settings, app lifecycle management for both macOS and other platforms, and a pattern for registering IPC handlers from separate modules.

```typescript
/**
 * Main Process Entry Point
 *
 * Secure Electron main process with:
 * - BrowserWindow with security defaults
 * - IPC handler registration
 * - App lifecycle management
 *
 * TODO: Customize window dimensions, title, and icon
 * TODO: Register your IPC handlers
 * TODO: Add app menu if needed
 */

import { app, BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { registerFileHandlers } from './ipc/file-handlers';
// TODO: Import additional IPC handler modules

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,                    // TODO: Set desired width
    height: 800,                    // TODO: Set desired height
    minWidth: 600,
    minHeight: 400,
    title: 'My Electron App',      // TODO: Set app title
    icon: join(__dirname, '../../resources/icon.png'),  // TODO: Set icon path
    show: false,                    // Show when ready to prevent flash
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,       // SECURITY: Never disable
      sandbox: true,                // SECURITY: Never disable
      nodeIntegration: false,       // SECURITY: Never enable
      webviewTag: false,            // SECURITY: Disable unless needed
    },
  });

  // Show window when ready
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Prevent navigation to external URLs
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Register IPC handlers
function registerHandlers(): void {
  registerFileHandlers();
  // TODO: Register additional handlers
}

// App lifecycle
app.whenReady().then(() => {
  registerHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

## Customization Notes

- **Window dimensions**: Adjust `width`, `height`, `minWidth`, and `minHeight` to match your application's layout requirements.
- **Title and icon**: Update `title` with your app name and point `icon` to your application icon file.
- **Preload path**: Ensure the `preload` path in `webPreferences` resolves to your compiled preload script.
- **Security settings**: The four security flags (`contextIsolation`, `sandbox`, `nodeIntegration`, `webviewTag`) are set to their most secure values. Do not change these unless you fully understand the security implications.
- **External URL handling**: The `setWindowOpenHandler` callback currently allows only `https:` URLs to open in the system browser. Adjust the protocol check if your app needs to handle other schemes.
- **IPC handler registration**: Import and call your handler registration functions inside `registerHandlers()`. Keep handler logic in separate modules organized by domain.
- **Dev server support**: The template checks `ELECTRON_RENDERER_URL` for hot-reload during development. Set this environment variable in your dev tooling configuration.
- **macOS behavior**: The `activate` and `window-all-closed` handlers follow platform conventions. On macOS the app stays running when all windows are closed; on other platforms it quits.
