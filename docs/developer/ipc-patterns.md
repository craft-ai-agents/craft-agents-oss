# IPC Communication Patterns

This guide covers Inter-Process Communication (IPC) patterns in Vesper's Electron architecture.

## Table of Contents

- [IPC Overview](#ipc-overview)
- [Security Model](#security-model)
- [Communication Patterns](#communication-patterns)
- [IPC Channels](#ipc-channels)
- [Best Practices](#best-practices)
- [Common Pitfalls](#common-pitfalls)

## IPC Overview

Electron applications run in multiple processes that must communicate securely:

```
┌──────────────────────────────────────────────────────────┐
│                    Main Process                           │
│                     (Node.js)                             │
│                                                           │
│  - File system access                                    │
│  - Native modules                                        │
│  - Session management                                    │
│  - Database operations                                   │
│                                                           │
│  ipcMain.handle('channel', handler)                      │
└───────────────────────┬──────────────────────────────────┘
                        │
                        │ IPC Bridge (secure)
                        │
┌───────────────────────┴──────────────────────────────────┐
│                  Preload Script                           │
│               (Context Bridge)                            │
│                                                           │
│  contextBridge.exposeInMainWorld('electron', {           │
│    invoke: (channel, ...args) => ipcRenderer.invoke(...) │
│  })                                                       │
└───────────────────────┬──────────────────────────────────┘
                        │
                        │ Exposed APIs
                        │
┌───────────────────────┴──────────────────────────────────┐
│                 Renderer Process                          │
│                   (Chromium)                              │
│                                                           │
│  - React application                                     │
│  - UI rendering                                          │
│  - User interactions                                     │
│                                                           │
│  window.electron.invoke('channel', args)                 │
└──────────────────────────────────────────────────────────┘
```

## Security Model

Vesper follows Electron security best practices:

### 1. Context Isolation

Renderer processes cannot directly access Node.js APIs:

```typescript
// apps/electron/src/preload/index.ts

import { contextBridge, ipcRenderer } from 'electron';

// ✓ Good - Explicit API exposure
contextBridge.exposeInMainWorld('electron', {
  // Request-response pattern
  invoke: (channel: string, ...args: any[]) => {
    return ipcRenderer.invoke(channel, ...args);
  },

  // Event subscription pattern
  on: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_, ...args) => callback(...args));
    return () => {
      ipcRenderer.removeListener(channel, callback);
    };
  },
});

// ✗ Bad - Exposing entire ipcRenderer
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer  // Never do this!
});
```

### 2. Channel Validation

Validate IPC channels to prevent abuse:

```typescript
// apps/electron/src/preload/index.ts

const ALLOWED_CHANNELS = {
  // Session operations
  'session:get': true,
  'session:create': true,
  'session:update': true,
  'session:delete': true,

  // Workspace operations
  'workspace:get': true,
  'workspace:list': true,

  // ... more channels
} as const;

contextBridge.exposeInMainWorld('electron', {
  invoke: (channel: string, ...args: any[]) => {
    if (!(channel in ALLOWED_CHANNELS)) {
      throw new Error(`Unknown IPC channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
});
```

### 3. Input Sanitization

Always validate inputs in the main process:

```typescript
// apps/electron/src/main/ipc.ts

ipcMain.handle('session:create', async (_, workspaceId: unknown, name: unknown) => {
  // Validate inputs
  if (typeof workspaceId !== 'string' || !workspaceId) {
    throw new Error('Invalid workspace ID');
  }

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Session name is required');
  }

  if (name.length > 200) {
    throw new Error('Session name too long (max 200 chars)');
  }

  // Safe to proceed
  return await createSession(workspaceId, name.trim());
});
```

## Communication Patterns

### 1. Request-Response Pattern

The most common pattern for fetching data:

```typescript
// Renderer (React component)
async function loadSession(sessionId: string) {
  try {
    const session = await window.electron.invoke('session:get', sessionId);
    return session;
  } catch (error) {
    console.error('Failed to load session:', error);
    throw error;
  }
}

// Main process (IPC handler)
ipcMain.handle('session:get', async (_, sessionId: string) => {
  try {
    return await loadSession(sessionId);
  } catch (error) {
    console.error('[session:get] Error:', error);
    throw error;
  }
});
```

### 2. Event Broadcasting Pattern

Notify all renderer windows of changes:

```typescript
// Main process - Broadcast event
function broadcastSessionUpdate(sessionId: string) {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('session:updated', sessionId);
  });
}

// After updating a session
async function updateSession(id: string, updates: Partial<Session>) {
  const session = await storage.updateSession(id, updates);
  broadcastSessionUpdate(session.id);
  return session;
}

// Renderer - Subscribe to events
useEffect(() => {
  const unsubscribe = window.electron.on('session:updated', (sessionId) => {
    console.log('Session updated:', sessionId);
    // Refresh UI
    refetchSession(sessionId);
  });

  return unsubscribe;
}, []);
```

### 3. Stream Pattern

For long-running operations with progress updates:

```typescript
// Main process - Stream events
ipcMain.handle('agent:chat', async (event, sessionId: string, message: string) => {
  const agent = getAgent(sessionId);
  const generator = agent.chat(message);

  for await (const agentEvent of generator) {
    // Send each event to renderer
    event.sender.send('agent:event', {
      sessionId,
      event: agentEvent
    });
  }

  return { success: true };
});

// Renderer - Receive stream
async function sendMessage(sessionId: string, message: string) {
  // Subscribe to events first
  const events: AgentEvent[] = [];
  const unsubscribe = window.electron.on('agent:event', (data) => {
    if (data.sessionId === sessionId) {
      events.push(data.event);
      // Update UI with event
      processAgentEvent(data.event);
    }
  });

  try {
    await window.electron.invoke('agent:chat', sessionId, message);
  } finally {
    unsubscribe();
  }

  return events;
}
```

### 4. Bidirectional Communication

Request approval from renderer:

```typescript
// Main process - Request approval
async function executeCommand(command: string): Promise<void> {
  const mainWindow = BrowserWindow.getFocusedWindow();
  if (!mainWindow) {
    throw new Error('No focused window');
  }

  // Request approval
  const approved = await new Promise<boolean>((resolve) => {
    ipcMain.once('permission:response', (_, response: boolean) => {
      resolve(response);
    });

    mainWindow.webContents.send('permission:request', {
      command,
      type: 'bash'
    });

    // Timeout after 30 seconds
    setTimeout(() => resolve(false), 30000);
  });

  if (!approved) {
    throw new Error('Command not approved');
  }

  // Execute command
  await exec(command);
}

// Renderer - Respond to request
useEffect(() => {
  const unsubscribe = window.electron.on('permission:request', async (data) => {
    const approved = await showApprovalDialog(data.command);
    window.electron.send('permission:response', approved);
  });

  return unsubscribe;
}, []);
```

## IPC Channels

### Channel Naming Convention

```
<domain>:<action>
```

**Examples:**
```
session:get
session:create
session:update
session:delete
session:list

workspace:get
workspace:create

scheduler:create
scheduler:update

task-lists:create
task-lists:task-update
```

### Complete IPC Channel List

#### Session Operations
```typescript
'session:get'              // Get session by ID
'session:create'           // Create new session
'session:update'           // Update session
'session:delete'           // Delete session
'session:list'             // List all sessions
'session:chat'             // Send chat message
'session:abort'            // Abort current operation
```

#### Workspace Operations
```typescript
'workspace:get'            // Get workspace
'workspace:list'           // List workspaces
'workspace:create'         // Create workspace
'workspace:update'         // Update workspace
```

#### Scheduler Operations
```typescript
'scheduler:list'           // List scheduled tasks
'scheduler:create'         // Create scheduled task
'scheduler:update'         // Update scheduled task
'scheduler:delete'         // Delete scheduled task
'scheduler:run'            // Run task immediately
```

#### Task List Operations
```typescript
'task-lists:list'          // List task lists
'task-lists:create'        // Create task list
'task-lists:get'           // Get task list
'task-lists:delete'        // Delete task list
'task-lists:task-create'   // Create task
'task-lists:task-update'   // Update task
'task-lists:task-delete'   // Delete task
'task-lists:tasks-list'    // List tasks in task list
```

#### Source Operations
```typescript
'source:list'              // List sources
'source:create'            // Create source
'source:update'            // Update source
'source:delete'            // Delete source
'source:test'              // Test source connection
```

#### Configuration Operations
```typescript
'config:get'               // Get config
'config:update'            // Update config
'config:theme-get'         // Get theme
'config:theme-update'      // Update theme
```

#### Broadcast Events
```typescript
'session:updated'          // Session was updated
'session:deleted'          // Session was deleted
'workspace:updated'        // Workspace was updated
'config:changed'           // Config changed
'theme:changed'            // Theme changed
'source:connected'         // Source connected
'source:disconnected'      // Source disconnected
```

## Best Practices

### 1. Type Safety

Use TypeScript types for IPC calls:

```typescript
// Shared types
interface IpcInvokeMap {
  'session:get': {
    args: [sessionId: string];
    return: Session | null;
  };
  'session:create': {
    args: [workspaceId: string, name: string];
    return: Session;
  };
  'session:update': {
    args: [sessionId: string, updates: Partial<Session>];
    return: Session;
  };
}

// Preload - Typed invoke
contextBridge.exposeInMainWorld('electron', {
  invoke: <K extends keyof IpcInvokeMap>(
    channel: K,
    ...args: IpcInvokeMap[K]['args']
  ): Promise<IpcInvokeMap[K]['return']> => {
    return ipcRenderer.invoke(channel, ...args);
  },
});

// Renderer - Full type safety
const session = await window.electron.invoke('session:get', sessionId);
//    ^? Session | null (inferred)
```

### 2. Error Handling

Handle errors consistently:

```typescript
// Main process
ipcMain.handle('session:update', async (_, sessionId: string, updates: Partial<Session>) => {
  try {
    // Validate inputs
    if (!sessionId) {
      throw new Error('Session ID is required');
    }

    // Perform operation
    const session = await updateSession(sessionId, updates);

    // Broadcast success
    broadcastSessionUpdate(sessionId);

    return session;
  } catch (error) {
    // Log error
    console.error('[session:update] Error:', error);

    // Re-throw for renderer
    throw error;
  }
});

// Renderer
async function updateSessionName(sessionId: string, name: string) {
  try {
    const session = await window.electron.invoke('session:update', sessionId, { name });
    showSuccessNotification('Session updated');
    return session;
  } catch (error) {
    console.error('Failed to update session:', error);
    showErrorNotification('Failed to update session');
    throw error;
  }
}
```

### 3. Idempotent Operations

Make operations safe to retry:

```typescript
// ✓ Good - Idempotent delete
ipcMain.handle('session:delete', async (_, sessionId: string) => {
  try {
    await deleteSession(sessionId);
    broadcastSessionDeleted(sessionId);
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      // Already deleted, treat as success
      return;
    }
    throw error;
  }
});

// ✗ Bad - Throws on retry
ipcMain.handle('session:delete', async (_, sessionId: string) => {
  await deleteSession(sessionId);  // Throws if not found
  broadcastSessionDeleted(sessionId);
});
```

### 4. Event Cleanup

Always clean up event listeners:

```typescript
// ✓ Good - Cleanup on unmount
function useSessionEvents(sessionId: string) {
  useEffect(() => {
    const unsubscribe = window.electron.on('session:updated', (id) => {
      if (id === sessionId) {
        refetchSession();
      }
    });

    // Cleanup
    return () => {
      unsubscribe();
    };
  }, [sessionId]);
}

// ✗ Bad - Memory leak
function useSessionEvents(sessionId: string) {
  useEffect(() => {
    window.electron.on('session:updated', (id) => {
      if (id === sessionId) {
        refetchSession();
      }
    });
    // Missing cleanup!
  }, [sessionId]);
}
```

### 5. Batching Updates

Batch multiple updates to reduce IPC overhead:

```typescript
// ✗ Bad - Multiple IPC calls
async function updateMultipleTasks(tasks: Task[]) {
  for (const task of tasks) {
    await window.electron.invoke('task-lists:task-update', taskListId, task.id, {
      status: 'completed'
    });
  }
}

// ✓ Good - Single batch call
async function updateMultipleTasks(tasks: Task[]) {
  await window.electron.invoke('task-lists:batch-update', taskListId, tasks.map(t => ({
    id: t.id,
    updates: { status: 'completed' }
  })));
}

// Main process handler
ipcMain.handle('task-lists:batch-update', async (_, taskListId, updates) => {
  const updatedTasks = [];
  for (const { id, updates: taskUpdates } of updates) {
    const task = await updateTask(taskListId, id, taskUpdates);
    updatedTasks.push(task);
  }

  // Single broadcast after all updates
  broadcastTaskListUpdate(taskListId);

  return updatedTasks;
});
```

### 6. Progress Reporting

Report progress for long operations:

```typescript
// Main process
ipcMain.handle('import:sessions', async (event, filePath: string) => {
  const sessions = await readSessionsFromFile(filePath);
  const total = sessions.length;

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];

    // Import session
    await importSession(session);

    // Report progress
    event.sender.send('import:progress', {
      current: i + 1,
      total,
      percent: ((i + 1) / total) * 100
    });
  }

  return { imported: total };
});

// Renderer
async function importSessions(filePath: string) {
  // Subscribe to progress
  const unsubscribe = window.electron.on('import:progress', (progress) => {
    updateProgressBar(progress.percent);
  });

  try {
    const result = await window.electron.invoke('import:sessions', filePath);
    showSuccessNotification(`Imported ${result.imported} sessions`);
  } finally {
    unsubscribe();
  }
}
```

## Common Pitfalls

### 1. Forgetting to Broadcast Updates

```typescript
// ✗ Bad - No broadcast
ipcMain.handle('session:update', async (_, sessionId, updates) => {
  return await updateSession(sessionId, updates);
  // Other windows won't know about the update!
});

// ✓ Good - Broadcast to all windows
ipcMain.handle('session:update', async (_, sessionId, updates) => {
  const session = await updateSession(sessionId, updates);
  broadcastSessionUpdate(sessionId);
  return session;
});
```

### 2. Race Conditions

```typescript
// ✗ Bad - Race condition
let currentSession: Session | null = null;

ipcMain.handle('session:get', async (_, sessionId) => {
  currentSession = await loadSession(sessionId);
  return currentSession;
});

ipcMain.handle('session:update', async (_, updates) => {
  // What if currentSession changed?
  const updated = { ...currentSession, ...updates };
  await saveSession(updated);
  return updated;
});

// ✓ Good - Pass session ID explicitly
ipcMain.handle('session:update', async (_, sessionId, updates) => {
  const session = await loadSession(sessionId);
  const updated = { ...session, ...updates };
  await saveSession(updated);
  return updated;
});
```

### 3. Blocking the Main Process

```typescript
// ✗ Bad - Blocking operation
ipcMain.handle('process:large-file', async (_, filePath) => {
  const content = fs.readFileSync(filePath, 'utf-8');  // Blocks!
  const processed = processContent(content);  // Blocks!
  return processed;
});

// ✓ Good - Async operations
ipcMain.handle('process:large-file', async (_, filePath) => {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const processed = await processContentAsync(content);
  return processed;
});
```

### 4. Memory Leaks

```typescript
// ✗ Bad - Event listeners never removed
function setupBroadcast() {
  ipcMain.on('broadcast:message', (event, message) => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('message:received', message);
    });
  });
  // Never cleaned up!
}

// ✓ Good - Remove listeners when done
function setupBroadcast() {
  const handler = (event: IpcMainEvent, message: string) => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('message:received', message);
    });
  };

  ipcMain.on('broadcast:message', handler);

  return () => {
    ipcMain.removeListener('broadcast:message', handler);
  };
}

// Cleanup when app closes
app.on('will-quit', () => {
  cleanupBroadcast();
});
```

### 5. Exposing Too Much

```typescript
// ✗ Bad - Exposing dangerous APIs
contextBridge.exposeInMainWorld('electron', {
  executeCommand: (cmd: string) => exec(cmd),  // Dangerous!
  readFile: (path: string) => fs.readFileSync(path),  // Unrestricted access!
});

// ✓ Good - Controlled, validated APIs
contextBridge.exposeInMainWorld('electron', {
  invoke: (channel: string, ...args: any[]) => {
    if (!isAllowedChannel(channel)) {
      throw new Error('Unauthorized channel');
    }
    return ipcRenderer.invoke(channel, ...args);
  }
});

// Main process validates everything
ipcMain.handle('file:read', async (_, filePath: string) => {
  // Validate path is within allowed directories
  if (!isAllowedPath(filePath)) {
    throw new Error('Access denied');
  }
  return await fs.promises.readFile(filePath, 'utf-8');
});
```

## Testing IPC

### Unit Testing IPC Handlers

```typescript
import { describe, it, expect, mock } from 'bun:test';

describe('session:create IPC handler', () => {
  it('should create session with valid inputs', async () => {
    const handler = getIpcHandler('session:create');
    const mockEvent = { sender: { send: mock() } };

    const result = await handler(mockEvent, 'workspace-123', 'New Session');

    expect(result.id).toBeDefined();
    expect(result.name).toBe('New Session');
    expect(result.workspaceId).toBe('workspace-123');
  });

  it('should throw on invalid workspace ID', async () => {
    const handler = getIpcHandler('session:create');
    const mockEvent = { sender: { send: mock() } };

    await expect(
      handler(mockEvent, '', 'New Session')
    ).rejects.toThrow('Invalid workspace ID');
  });
});
```

### Integration Testing

See [Testing Guide](testing-guide.md) for E2E testing patterns.

## Related Documentation

- [Architecture Overview](architecture.md)
- [Development Setup](development-setup.md)
- [Testing Guide](testing-guide.md)
- [Code Organization](code-organization.md)

---

*Last Updated: 2026-01-26*
