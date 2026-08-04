# Using electron-trpc for Type-Safe IPC

## Overview

electron-trpc brings the tRPC framework to Electron, replacing manual IPC channel
management with a fully typed RPC layer. You define a tRPC router in the main
process and call procedures from the renderer with full type inference, runtime
input validation via Zod, and optional React Query integration.

Best suited for apps with many IPC endpoints, complex input validation, or teams
already familiar with tRPC from web projects.

---

## When to Use electron-trpc

**Good fit:** 15+ IPC channels, runtime input validation needed, React Query
caching desired, real-time subscriptions required, team knows tRPC.

**Not ideal:** Few IPC calls, bundle size constrained, team unfamiliar with tRPC,
need low-level control over IPC message timing.

---

## Installation

```bash
npm install @trpc/server @trpc/client electron-trpc zod
# For React integration (optional):
npm install @trpc/react-query @tanstack/react-query
```

---

## Setting Up the tRPC Router (Main Process)

```typescript
// main/trpc.ts
import { initTRPC } from '@trpc/server';

const t = initTRPC.create({ isServer: true });

export const router = t.router;
export const procedure = t.procedure;
```

```typescript
// main/router.ts
import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { router, procedure } from './trpc';
import { TRPCError } from '@trpc/server';
import * as fs from 'node:fs';

export const appRouter = router({
  // --- Queries (read operations) ---
  greeting: procedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => `Hello, ${input.name}!`),

  getUser: procedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const user = await db.users.findById(input.id);
      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `User ${input.id} not found`,
        });
      }
      return user;
    }),

  // --- Mutations (write operations) ---
  saveDocument: procedure
    .input(z.object({
      id: z.string(),
      title: z.string().min(1).max(255),
      content: z.string(),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const saved = await documentService.save(input);
      return { success: true, savedAt: saved.updatedAt };
    }),

  deleteDocument: procedure
    .input(z.object({ id: z.string(), permanent: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      await documentService.delete(input.id, { permanent: input.permanent });
      return { deleted: true };
    }),

  // --- Subscriptions (real-time events) ---
  onFileChanged: procedure
    .input(z.object({ directory: z.string() }))
    .subscription(({ input }) => {
      return observable<{ event: string; filename: string }>((emit) => {
        const watcher = fs.watch(input.directory, (event, filename) => {
          if (filename) emit.next({ event, filename });
        });
        return () => watcher.close();
      });
    }),
});

export type AppRouter = typeof appRouter;
```

---

## Attaching the Router to IPC (Main Process)

```typescript
// main/index.ts
import { app, BrowserWindow } from 'electron';
import { createIPCHandler } from 'electron-trpc/main';
import { appRouter } from './router';

app.whenReady().then(() => {
  const mainWindow = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  createIPCHandler({ router: appRouter, windows: [mainWindow] });
  mainWindow.loadURL('http://localhost:5173');
});
```

For multiple windows, pass all of them in the `windows` array.

---

## Preload Script

The preload for electron-trpc is minimal:

```typescript
// preload/index.ts
import { exposeElectronTRPC } from 'electron-trpc/preload';

exposeElectronTRPC();
```

No manual channel definitions needed.

---

## Renderer Client Setup (Vanilla)

```typescript
// renderer/trpc.ts
import { createTRPCProxyClient } from '@trpc/client';
import { ipcLink } from 'electron-trpc/renderer';
import type { AppRouter } from '../main/router';

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [ipcLink()],
});
```

Usage with full type inference:

```typescript
// renderer/app.ts
import { trpc } from './trpc';

// Queries
const greeting = await trpc.greeting.query({ name: 'World' });
const user = await trpc.getUser.query({ id: '550e8400-e29b-41d4-a716-446655440000' });

// Type error: invalid input
await trpc.getUser.query({ id: 123 });
// Error: Type 'number' is not assignable to type 'string'

// Mutations
const result = await trpc.saveDocument.mutate({
  id: 'doc-1',
  title: 'My Document',
  content: 'Hello world',
  tags: ['draft'],
});

// Subscriptions
const sub = trpc.onFileChanged.subscribe(
  { directory: '/home/user/documents' },
  {
    onData: ({ event, filename }) => console.log(`${filename}: ${event}`),
    onError: (err) => console.error('Subscription error:', err),
  }
);
sub.unsubscribe(); // cleanup
```

---

## React Query Integration

```typescript
// renderer/trpc-react.ts
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../main/router';
export const trpc = createTRPCReact<AppRouter>();
```

```tsx
// renderer/App.tsx
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ipcLink } from 'electron-trpc/renderer';
import { trpc } from './trpc-react';

export function App() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({ links: [ipcLink()] })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <MainContent />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
```

```tsx
// renderer/components/UserProfile.tsx
import { trpc } from '../trpc-react';

export function UserProfile({ userId }: { userId: string }) {
  const { data: user, isLoading, error } = trpc.getUser.useQuery({ id: userId });
  const saveMutation = trpc.saveDocument.useMutation();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!user) return <div>User not found</div>;

  return (
    <div>
      <h1>{user.name}</h1>
      <button
        onClick={() => saveMutation.mutate({ id: 'doc-1', title: 'New', content: '...' })}
        disabled={saveMutation.isPending}
      >
        {saveMutation.isPending ? 'Saving...' : 'Save'}
      </button>
    </div>
  );
}
```

---

## Error Handling with tRPC Error Codes

tRPC provides structured error codes that map well to IPC failure modes:

```typescript
// main/router.ts
import { TRPCError } from '@trpc/server';

export const appRouter = router({
  readFile: procedure
    .input(z.object({ path: z.string() }))
    .query(async ({ input }) => {
      try {
        return await fs.promises.readFile(input.path, 'utf-8');
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          throw new TRPCError({ code: 'NOT_FOUND', message: `File not found: ${input.path}`, cause: e });
        }
        if (code === 'EACCES') {
          throw new TRPCError({ code: 'FORBIDDEN', message: `Permission denied: ${input.path}`, cause: e });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: (e as Error).message, cause: e });
      }
    }),
});
```

Renderer-side errors arrive as typed `TRPCClientError` objects:

```typescript
import { TRPCClientError } from '@trpc/client';

try {
  await trpc.readFile.query({ path: '/nonexistent' });
} catch (e) {
  if (e instanceof TRPCClientError) {
    console.error(e.data?.code);  // 'NOT_FOUND'
    console.error(e.message);     // 'File not found: /nonexistent'
  }
}
```

---

## Comparison: electron-trpc vs Manual Typed IPC

| Consideration | Manual Typed IPC | electron-trpc |
|---------------|-----------------|---------------|
| Runtime validation | You implement it | Zod handles it |
| Channel count | < 15 channels | 15+ channels |
| React integration | Manual state mgmt | React Query hooks |
| Subscriptions | Manual event wiring | Built-in observables |
| Error handling | Custom Result type | TRPCError codes |
| Incremental adoption | One channel at a time | All-or-nothing router |
| Bundle overhead | Zero deps | tRPC + Zod (~30-50KB) |

You can also use a hybrid: electron-trpc for most IPC and manual typed channels
for performance-critical or low-level operations.

---

## See Also

- [Manual Typed IPC](./typed-ipc.md) -- Lightweight alternative using TypeScript mapped types
- [Error Serialization](./error-serialization.md) -- Deeper dive into error handling across IPC
