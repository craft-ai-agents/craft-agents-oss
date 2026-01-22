---
module: Vesper Electron
date: 2026-01-22
problem_type: best_practice
component: tooling
symptoms:
  - "Need to schedule automated agent tasks"
  - "Recurring prompts for daily briefings or summaries"
root_cause: missing_tooling
resolution_type: code_fix
severity: medium
tags: [electron, scheduler, cron, ipc, navigation, croner]
---

# Implementation Pattern: Electron Cron Scheduler Feature

## Overview

Complete implementation of a scheduling system for an Electron app that runs prompts automatically at specified times. This documents the full-stack pattern from main process to renderer.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Vesper App                        │
├─────────────────────────────────────────────────────┤
│  Renderer (React)                                    │
│  ┌─────────────────┐  ┌─────────────────┐           │
│  │ ScheduleList    │  │ ScheduleModal   │           │
│  └────────┬────────┘  └────────┬────────┘           │
│           └───────────┬────────┘                    │
│                       │ IPC                         │
├───────────────────────┼─────────────────────────────┤
│  Main Process         │                             │
│  ┌────────────────────▼────────────────────┐        │
│  │         SchedulerService                 │        │
│  │  - Croner for cron scheduling           │        │
│  │  - JSON file for persistence            │        │
│  │  - SessionManager for execution         │        │
│  └──────────────────────────────────────────┘        │
│                       │                              │
│  ~/.craft-agent/workspaces/{id}/schedules.json      │
└─────────────────────────────────────────────────────┘
```

## Key Implementation Files

### 1. Types and IPC Channels (`shared/types.ts`)

```typescript
// Data model
export interface Schedule {
  id: string
  name: string
  prompt: string
  cron: string | null        // null = one-time
  scheduledFor: number | null // Unix timestamp for one-time
  timezone: string
  enabled: boolean
  lastRunAt: number | null
  lastRunStatus: 'success' | 'failed' | null
  lastRunError: string | null
  createdAt: number
}

// Form data (subset for create/update)
export interface ScheduleFormData {
  name: string
  prompt: string
  cron: string | null
  scheduledFor: number | null
  timezone: string
  enabled: boolean
}

// IPC channels
export const IPC_CHANNELS = {
  // ... existing channels
  SCHEDULE_LIST: 'schedule:list',
  SCHEDULE_CREATE: 'schedule:create',
  SCHEDULE_UPDATE: 'schedule:update',
  SCHEDULE_DELETE: 'schedule:delete',
  SCHEDULE_TOGGLE: 'schedule:toggle',
  SCHEDULE_RUN_NOW: 'schedule:runNow',
  SCHEDULE_EVENT: 'schedule:event',
}

// Navigation state for schedules panel
export interface SchedulesNavigationState {
  navigator: 'schedules'
  rightSidebar?: RightSidebarPanel
}

// Type guard
export const isSchedulesNavigation = (
  state: NavigationState
): state is SchedulesNavigationState => state.navigator === 'schedules'
```

### 2. Main Process Service (`main/scheduler.ts`)

Key patterns:
- **Croner library** for cron scheduling (lightweight, no native deps)
- **JSON file persistence** per workspace
- **Queue-based execution** to prevent concurrent task execution
- **Event broadcasting** to all windows via IPC

```typescript
export class SchedulerService {
  private jobs: Map<string, Cron> = new Map()
  private schedules: Schedule[] = []
  private isExecuting = false
  private queue: Schedule[] = []

  // Sequential execution prevents overlapping tasks
  private async processQueue(): Promise<void> {
    if (this.isExecuting || this.queue.length === 0) return
    this.isExecuting = true
    while (this.queue.length > 0) {
      const schedule = this.queue.shift()!
      await this.execute(schedule)
    }
    this.isExecuting = false
  }

  // Broadcast events to renderer for UI updates
  private broadcastEvent(event: ScheduleEvent): void {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.SCHEDULE_EVENT, event)
      }
    }
  }
}
```

### 3. IPC Handlers (`main/ipc.ts`)

Pattern: Each handler gets the scheduler for the workspace, ensuring workspace isolation.

```typescript
ipcMain.handle(IPC_CHANNELS.SCHEDULE_CREATE, async (_event, workspaceId, data) => {
  const workspace = getWorkspaceOrThrow(workspaceId)
  const scheduler = getScheduler(workspaceId, workspace.rootPath)
  scheduler.setWindowManager(windowManager)
  scheduler.setSessionManager(sessionManager)
  return await scheduler.create(data)
})
```

### 4. Preload Bridge (`preload/index.ts`)

```typescript
// Expose scheduler API to renderer
scheduleList: (workspaceId: string) =>
  ipcRenderer.invoke(IPC_CHANNELS.SCHEDULE_LIST, workspaceId),

// Event listener with cleanup function
onScheduleEvent: (callback: (event: ScheduleEvent) => void) => {
  const handler = (_event, scheduleEvent) => callback(scheduleEvent)
  ipcRenderer.on(IPC_CHANNELS.SCHEDULE_EVENT, handler)
  return () => ipcRenderer.removeListener(IPC_CHANNELS.SCHEDULE_EVENT, handler)
}
```

### 5. React Components

**ScheduleModal.tsx** - Form with cron validation:
```typescript
// Validate cron expression and show next runs
const cronError = useMemo(() => {
  if (!cronExpression) return 'Cron expression required'
  try {
    new Cron(cronExpression)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid cron expression'
  }
}, [cronExpression])

const nextRuns = useMemo(() => {
  if (cronError) return []
  const cron = new Cron(cronExpression)
  return cron.nextRuns(3)  // Show next 3 scheduled times
}, [cronExpression, cronError])
```

**ScheduleList.tsx** - List with event subscription:
```typescript
// Subscribe to schedule events for live updates
useEffect(() => {
  const cleanup = window.electronAPI.onScheduleEvent((event) => {
    if (event.type === 'completed' || event.type === 'failed') {
      window.electronAPI.scheduleList(workspaceId).then(setSchedules)
    }
  })
  return cleanup
}, [workspaceId])
```

### 6. Navigation Integration

**route-parser.ts**:
```typescript
const COMPOUND_ROUTE_PREFIXES = [
  'allChats', 'flagged', 'state', 'sources', 'skills',
  'settings', 'vectorSearch', 'schedules'  // Added
]

if (first === 'schedules') {
  return { navigator: 'schedules', details: null }
}
```

**routes.ts**:
```typescript
schedules: () => 'schedules' as const,
```

### 7. App Initialization (`main/index.ts`)

```typescript
// Start schedulers after session manager initialized
const workspacesForSchedulers = getWorkspaces().map(ws => ({
  id: ws.id,
  rootPath: ws.rootPath
}))
await startAllSchedulers(workspacesForSchedulers, windowManager, sessionManager)

// Stop schedulers on app quit
app.on('before-quit', async (event) => {
  await stopAllSchedulers()
  // ... rest of cleanup
})
```

## Key Decisions

1. **Croner over node-cron**: Smaller bundle, TypeScript native, better timezone support
2. **JSON over SQLite**: Zero setup, human-readable, sufficient for <100 schedules
3. **App must be open**: No background service complexity for v1
4. **Sequential execution**: Queue prevents concurrent task execution issues
5. **Per-workspace storage**: Each workspace has its own schedules.json

## Testing Checklist

- [ ] Create recurring schedule with preset
- [ ] Create one-time schedule
- [ ] Toggle enable/disable
- [ ] Edit schedule
- [ ] Delete schedule
- [ ] Run Now
- [ ] Verify notification on completion
- [ ] Verify notification on failure
- [ ] App restart preserves schedules
- [ ] Schedule executes at correct time

## Related Issues

No related issues documented yet.
