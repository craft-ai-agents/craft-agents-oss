# Error Handling Across the IPC Boundary

## Overview

Electron's IPC layer serializes data using the Structured Clone Algorithm. While
this handles most JavaScript values correctly, `Error` objects lose their custom
properties, prototype chain, and stack traces during serialization. An error thrown
in `ipcMain.handle` arrives in the renderer as a generic `Error` with only the
`message` property preserved.

This reference covers patterns for reliable, typed error handling across IPC.

---

## The Core Problem

```typescript
// main process
class FileNotFoundError extends Error {
  code = 'FILE_NOT_FOUND';
  filePath: string;
  constructor(filePath: string) {
    super(`File not found: ${filePath}`);
    this.filePath = filePath;
  }
}

ipcMain.handle('read-file', async (_event, path: string) => {
  throw new FileNotFoundError(path);
});
```

```typescript
// renderer process
try {
  await window.electronAPI.readFile('/missing.txt');
} catch (error) {
  console.log(error instanceof FileNotFoundError); // false
  console.log(error.message);   // "File not found: /missing.txt"
  console.log(error.code);      // undefined -- LOST
  console.log(error.filePath);  // undefined -- LOST
  console.log(error.stack);     // points to renderer, not main -- MISLEADING
}
```

Custom error classes lose their identity, error codes and metadata are stripped,
and the renderer cannot distinguish error types programmatically.

---

## The Result Type Pattern

Instead of throwing errors across IPC, return a discriminated union:

```typescript
// shared/result.ts

export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: SerializedError };

export interface SerializedError {
  message: string;
  code: string;
  details?: unknown;
}

export function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

export function err<T = never>(
  message: string,
  code: string,
  details?: unknown
): Result<T> {
  return { success: false, error: { message, code, details } };
}
```

Both `ok` and `err` return plain objects that serialize perfectly across IPC.

---

## Error Codes

Define known error codes so the renderer can handle specific failures:

```typescript
// shared/error-codes.ts

export const ErrorCode = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  DISK_FULL: 'DISK_FULL',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
```

---

## Wrapping Main Process Handlers

Catch errors in handlers and convert them to Result values automatically:

```typescript
// main/ipc-handler.ts
import { ipcMain } from 'electron';
import { ok, err, type Result } from '../shared/result';
import { ErrorCode } from '../shared/error-codes';

export function handleWithResult<TArgs extends unknown[], TData>(
  channel: string,
  handler: (...args: TArgs) => Promise<TData> | TData
): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<Result<TData>> => {
    try {
      const data = await handler(...(args as TArgs));
      return ok(data);
    } catch (e) {
      return classifyError(e);
    }
  });
}

function classifyError<T>(e: unknown): Result<T> {
  if (e instanceof Error && 'code' in e) {
    const nodeErr = e as NodeJS.ErrnoException;
    switch (nodeErr.code) {
      case 'ENOENT':
        return err(e.message, ErrorCode.FILE_NOT_FOUND, { path: nodeErr.path });
      case 'EACCES':
      case 'EPERM':
        return err(e.message, ErrorCode.PERMISSION_DENIED, { path: nodeErr.path });
      case 'ENOSPC':
        return err(e.message, ErrorCode.DISK_FULL);
      case 'ETIMEDOUT':
        return err(e.message, ErrorCode.TIMEOUT);
    }
  }

  if (e instanceof Error) {
    return err(e.message, ErrorCode.UNKNOWN_ERROR);
  }
  return err(String(e), ErrorCode.UNKNOWN_ERROR);
}
```

Usage:

```typescript
// main/handlers/file-handlers.ts
import { handleWithResult } from '../ipc-handler';
import * as fs from 'node:fs/promises';

handleWithResult('save-file', async (content: string, filePath: string) => {
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
});

handleWithResult('read-file', async (filePath: string) => {
  const stat = await fs.stat(filePath);
  if (stat.size > 50 * 1024 * 1024) {
    throw Object.assign(new Error('File exceeds 50MB limit'), {
      code: 'FILE_TOO_LARGE', size: stat.size,
    });
  }
  return fs.readFile(filePath, 'utf-8');
});
```

---

## Renderer-Side Error Handling

Unwrap Result values and handle specific error codes:

```typescript
// renderer/lib/errors.ts
import type { SerializedError } from '../../shared/result';

export class AppError extends Error {
  code: string;
  details?: unknown;

  constructor(serialized: SerializedError) {
    super(serialized.message);
    this.name = 'AppError';
    this.code = serialized.code;
    this.details = serialized.details;
  }

  is(code: string): boolean {
    return this.code === code;
  }
}
```

```typescript
// renderer/lib/ipc-client.ts
import type { Result } from '../../shared/result';
import { AppError } from './errors';

export function unwrapResult<T>(result: Result<T>): T {
  if (result.success) return result.data;
  throw new AppError(result.error);
}
```

```typescript
// renderer/services/file-service.ts
import { unwrapResult } from '../lib/ipc-client';
import { AppError } from '../lib/errors';
import { ErrorCode } from '../../shared/error-codes';

async function handleSave(content: string) {
  try {
    const result = await window.electronAPI.saveFile(content);
    const path = unwrapResult(result);
    showNotification(`Saved to ${path}`);
  } catch (e) {
    if (e instanceof AppError) {
      if (e.is(ErrorCode.PERMISSION_DENIED)) {
        showDialog('Cannot save: permission denied. Try a different location.');
        return;
      }
      if (e.is(ErrorCode.DISK_FULL)) {
        showDialog('Cannot save: disk is full.');
        return;
      }
    }
    showDialog(`Save failed: ${(e as Error).message}`);
  }
}
```

---

## Integration with Typed IPC Channels

The Result pattern composes with the typed IPC approach from
[typed-ipc.md](./typed-ipc.md). Wrap channel return types in Result:

```typescript
// shared/ipc-types.ts
import type { Result } from './result';

export type IpcChannelMap = {
  'save-file': { args: [content: string, filePath: string]; return: Result<string> };
  'read-file': { args: [filePath: string]; return: Result<string> };
  'get-user': { args: [id: string]; return: Result<User | null> };
};
```

Every channel explicitly communicates that it can fail, and the renderer is
forced to handle both cases.

---

## Integration with electron-trpc

When using [electron-trpc](./electron-trpc.md), error handling is built into the
framework via `TRPCError`. You typically do not need the Result pattern:

```typescript
throw new TRPCError({
  code: 'FORBIDDEN',
  message: 'Permission denied',
  cause: originalError,
});
```

For richer metadata than tRPC codes allow, embed structured data in the message:

```typescript
throw new TRPCError({
  code: 'BAD_REQUEST',
  message: JSON.stringify({
    code: ErrorCode.FILE_TOO_LARGE,
    message: 'File exceeds 50MB limit',
    details: { size: stat.size, limit: 50 * 1024 * 1024 },
  }),
});
```

---

## Anti-Patterns to Avoid

**Swallowing errors:** Returning `null` on failure gives the renderer no way to
distinguish "not found" from "permission denied" from "network error."

**Relying on Error serialization:** Custom properties on Error subclasses are
silently dropped by Electron's structured clone.

**Inconsistent shapes:** Mixing Result returns, thrown errors, and null returns
across handlers makes renderer code fragile and unpredictable.

Pick one pattern and use it consistently across all handlers.

---

## Summary

IPC is a serialization boundary. Anything relying on `instanceof`, prototype
chains, or non-enumerable properties will not survive. Rules of thumb:

1. Never throw across IPC -- return Result types instead
2. Define error codes as a shared constant
3. Classify errors in the main process handler, close to where they occur
4. Unwrap results in the renderer with a consistent utility
5. Use the same pattern for every handler

---

## See Also

- [Manual Typed IPC](./typed-ipc.md) -- Integrating Result types with the typed channel map
- [electron-trpc](./electron-trpc.md) -- Framework-level error handling with TRPCError codes
