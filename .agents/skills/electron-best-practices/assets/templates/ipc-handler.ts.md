# IPC Handler Module Template

This template provides a structured pattern for IPC handler modules in the main process. It uses a `Result` type for consistent error handling across all IPC channels, ensuring the renderer always receives a predictable response shape. Each handler module should cover a single domain (e.g., file operations, database access, system info).

```typescript
/**
 * IPC Handler Module: File Operations
 *
 * Handles file-related IPC channels.
 * Uses Result type for consistent error handling.
 *
 * TODO: Rename module for your domain
 * TODO: Add your handler implementations
 * TODO: Add input validation
 */

import { ipcMain, dialog } from 'electron';
import { readFile, writeFile } from 'fs/promises';

// Result type for consistent error handling across IPC
type Result<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string; code: string } };

function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

function err<T>(message: string, code: string): Result<T> {
  return { success: false, error: { message, code } };
}

export function registerFileHandlers(): void {
  ipcMain.handle('save-file', async (_event, content: string): Promise<Result<string>> => {
    try {
      // TODO: Add input validation
      const { canceled, filePath } = await dialog.showSaveDialog({
        filters: [{ name: 'Text Files', extensions: ['txt'] }],
      });

      if (canceled || !filePath) {
        return err('Save cancelled', 'USER_CANCELLED');
      }

      await writeFile(filePath, content, 'utf-8');
      return ok(filePath);
    } catch (e) {
      return err((e as Error).message, 'WRITE_ERROR');
    }
  });

  ipcMain.handle('open-file', async (): Promise<Result<{ content: string; path: string }>> => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Text Files', extensions: ['txt'] }],
      });

      if (canceled || filePaths.length === 0) {
        return err('Open cancelled', 'USER_CANCELLED');
      }

      const content = await readFile(filePaths[0], 'utf-8');
      return ok({ content, path: filePaths[0] });
    } catch (e) {
      return err((e as Error).message, 'READ_ERROR');
    }
  });

  ipcMain.handle('get-app-version', () => {
    const { app } = require('electron');
    return app.getVersion();
  });

  // TODO: Add more handlers for your domain
}
```

## Customization Notes

- **Module naming**: Rename the file and the `registerFileHandlers` function to match your domain (e.g., `registerDatabaseHandlers`, `registerAuthHandlers`). Each module should own a cohesive set of related channels.
- **Result type**: The `ok()` and `err()` helpers produce a discriminated union that the renderer can check with a simple `if (result.success)` guard. Consider extracting the `Result` type and helpers into a shared utility file if you have multiple handler modules.
- **Error codes**: Use uppercase, underscore-separated error codes (e.g., `USER_CANCELLED`, `WRITE_ERROR`). Define a consistent set of codes across your application so the renderer can handle specific error cases programmatically.
- **Input validation**: Always validate arguments received from the renderer before processing. The IPC boundary is a trust boundary. Check types, ranges, string lengths, and allowed values at the top of each handler.
- **Dialog options**: Customize the `filters` array in `showSaveDialog` and `showOpenDialog` to match the file types your application works with. Add `defaultPath` if your app has a preferred working directory.
- **Handler registration**: Call your registration function from the main process `registerHandlers()` function before creating any windows. Handlers must be registered before the renderer can invoke them.
- **Async vs. sync**: Use `ipcMain.handle` for async operations that return results. For fire-and-forget messages from the renderer, use `ipcMain.on` instead, but prefer `handle` for most cases since it provides a response path.
- **File system access**: When reading or writing files, always use the `fs/promises` API for non-blocking operations. Validate and sanitize file paths to prevent directory traversal attacks.
