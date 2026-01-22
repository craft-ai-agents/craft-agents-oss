# feat: Cron Scheduler for Automated Agent Tasks (v1 - Simplified)

## Overview

A minimal scheduling system for Vesper that runs prompts on a schedule. Tasks execute when the app is open with native notifications on completion.

**v1 Scope:**
- Schedule prompts to run at specific times (cron or one-time)
- JSON file storage (no SQLite complexity)
- Runs only when app is open (no background service)
- Native macOS notifications
- Simple UI with preset schedules

**Explicitly NOT in v1:**
- Background execution (launchd) - add if users request it
- Skill execution - users can invoke skills via prompt text
- Chat commands - UI only
- Priority queues - sequential execution
- Persistent sessions - always fresh
- Complex execution history - last 10 runs inline

---

## Problem Statement

Users want to automate recurring agent tasks like morning briefings or daily summaries without manually starting each conversation.

---

## Proposed Solution

### Architecture (Simplified)

```
┌─────────────────────────────────────────────────────┐
│                    Vesper App                        │
├─────────────────────────────────────────────────────┤
│  Renderer (React)                                    │
│  ┌─────────────────┐  ┌─────────────────┐           │
│  │ Schedule List   │  │ Schedule Modal  │           │
│  └────────┬────────┘  └────────┬────────┘           │
│           └───────────┬────────┘                    │
│                       │ IPC                         │
├───────────────────────┼─────────────────────────────┤
│  Main Process         │                             │
│  ┌────────────────────▼────────────────────┐        │
│  │         SchedulerService (~200 lines)    │        │
│  │  - Croner for scheduling                 │        │
│  │  - JSON file for persistence             │        │
│  │  - HeadlessRunner for execution          │        │
│  └──────────────────────────────────────────┘        │
│                       │                              │
│  ~/.craft-agent/schedules.json                       │
└─────────────────────────────────────────────────────┘
```

**Note:** Tasks only run when the app is open. A small indicator shows "Schedules active" in the UI.

---

## Data Model

### Schedule (JSON)

**File:** `~/.craft-agent/workspaces/{workspaceId}/schedules.json`

```typescript
interface Schedule {
  id: string;
  name: string;
  prompt: string;
  cron: string | null;        // null = one-time
  scheduledFor: number | null; // Unix timestamp for one-time
  timezone: string;
  enabled: boolean;
  lastRunAt: number | null;
  lastRunStatus: 'success' | 'failed' | null;
  lastRunError: string | null;
  createdAt: number;
}

// Example schedules.json
{
  "schedules": [
    {
      "id": "abc123",
      "name": "Morning Standup",
      "prompt": "Summarize my calendar for today and list my priorities",
      "cron": "0 9 * * 1-5",
      "scheduledFor": null,
      "timezone": "America/Los_Angeles",
      "enabled": true,
      "lastRunAt": 1737500400,
      "lastRunStatus": "success",
      "lastRunError": null,
      "createdAt": 1737414000
    }
  ]
}
```

**Why JSON over SQLite:**
- Zero setup - just read/write a file
- Human-readable - users can inspect/edit
- Sufficient for <100 schedules
- No native module compilation issues

---

## Implementation

### 1. Scheduler Service

**File:** `apps/electron/src/main/scheduler.ts` (~200 lines)

```typescript
import { Cron } from 'croner';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

interface Schedule {
  id: string;
  name: string;
  prompt: string;
  cron: string | null;
  scheduledFor: number | null;
  timezone: string;
  enabled: boolean;
  lastRunAt: number | null;
  lastRunStatus: 'success' | 'failed' | null;
  lastRunError: string | null;
  createdAt: number;
}

export class SchedulerService {
  private jobs: Map<string, Cron> = new Map();
  private schedules: Schedule[] = [];
  private filePath: string;
  private isExecuting = false;
  private queue: Schedule[] = [];

  constructor(workspacePath: string) {
    this.filePath = path.join(workspacePath, 'schedules.json');
  }

  async start(): Promise<void> {
    await this.load();
    for (const schedule of this.schedules) {
      if (schedule.enabled) {
        this.startJob(schedule);
      }
    }
  }

  async stop(): Promise<void> {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }

  private async load(): Promise<void> {
    try {
      const data = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.schedules = parsed.schedules || [];
    } catch {
      this.schedules = [];
    }
  }

  private async save(): Promise<void> {
    await writeFile(
      this.filePath,
      JSON.stringify({ schedules: this.schedules }, null, 2)
    );
  }

  private startJob(schedule: Schedule): void {
    if (this.jobs.has(schedule.id)) return;

    if (schedule.cron) {
      const job = new Cron(schedule.cron, { timezone: schedule.timezone }, () => {
        this.enqueue(schedule);
      });
      this.jobs.set(schedule.id, job);
    } else if (schedule.scheduledFor) {
      const runAt = new Date(schedule.scheduledFor * 1000);
      if (runAt > new Date()) {
        const job = new Cron(runAt, () => {
          this.enqueue(schedule);
          this.jobs.delete(schedule.id);
        });
        this.jobs.set(schedule.id, job);
      }
    }
  }

  private stopJob(scheduleId: string): void {
    const job = this.jobs.get(scheduleId);
    if (job) {
      job.stop();
      this.jobs.delete(scheduleId);
    }
  }

  private enqueue(schedule: Schedule): void {
    this.queue.push(schedule);
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isExecuting || this.queue.length === 0) return;

    this.isExecuting = true;
    while (this.queue.length > 0) {
      const schedule = this.queue.shift()!;
      await this.execute(schedule);
    }
    this.isExecuting = false;
  }

  private async execute(schedule: Schedule): Promise<void> {
    const startTime = Date.now();

    try {
      // Use existing HeadlessRunner
      const result = await runHeadlessPrompt({
        workspaceId: this.workspaceId,
        prompt: schedule.prompt,
        permissionMode: 'safe',
        timeout: 600_000, // 10 minutes
      });

      // Update schedule
      schedule.lastRunAt = Math.floor(startTime / 1000);
      schedule.lastRunStatus = 'success';
      schedule.lastRunError = null;
      await this.save();

      // Show notification
      this.showNotification(schedule.name, 'Completed successfully', result.sessionId);
    } catch (error) {
      schedule.lastRunAt = Math.floor(startTime / 1000);
      schedule.lastRunStatus = 'failed';
      schedule.lastRunError = error.message;
      await this.save();

      this.showNotification(schedule.name, `Failed: ${error.message}`, null);
    }

    // Disable one-time schedules after execution
    if (!schedule.cron) {
      schedule.enabled = false;
      await this.save();
    }
  }

  private showNotification(title: string, body: string, sessionId: string | null): void {
    const notification = new Notification({ title: `Schedule: ${title}`, body });
    if (sessionId) {
      notification.on('click', () => {
        // Navigate to session
        this.windowManager.focusAndNavigate(sessionId);
      });
    }
    notification.show();
  }

  // CRUD operations
  async create(data: Omit<Schedule, 'id' | 'createdAt' | 'lastRunAt' | 'lastRunStatus' | 'lastRunError'>): Promise<Schedule> {
    const schedule: Schedule = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: Math.floor(Date.now() / 1000),
      lastRunAt: null,
      lastRunStatus: null,
      lastRunError: null,
    };
    this.schedules.push(schedule);
    await this.save();
    if (schedule.enabled) {
      this.startJob(schedule);
    }
    return schedule;
  }

  async update(id: string, updates: Partial<Schedule>): Promise<Schedule | null> {
    const index = this.schedules.findIndex(s => s.id === id);
    if (index === -1) return null;

    const schedule = { ...this.schedules[index], ...updates };
    this.schedules[index] = schedule;
    await this.save();

    // Restart job if timing changed
    this.stopJob(id);
    if (schedule.enabled) {
      this.startJob(schedule);
    }

    return schedule;
  }

  async delete(id: string): Promise<void> {
    this.stopJob(id);
    this.schedules = this.schedules.filter(s => s.id !== id);
    await this.save();
  }

  async toggle(id: string): Promise<Schedule | null> {
    const schedule = this.schedules.find(s => s.id === id);
    if (!schedule) return null;

    schedule.enabled = !schedule.enabled;
    await this.save();

    if (schedule.enabled) {
      this.startJob(schedule);
    } else {
      this.stopJob(schedule.id);
    }

    return schedule;
  }

  list(): Schedule[] {
    return this.schedules;
  }

  getNextRun(schedule: Schedule): Date | null {
    if (!schedule.cron || !schedule.enabled) return null;
    try {
      const cron = new Cron(schedule.cron, { timezone: schedule.timezone });
      return cron.nextRun();
    } catch {
      return null;
    }
  }
}
```

### 2. IPC Handlers

**File:** `apps/electron/src/main/ipc.ts` (add to existing)

```typescript
// Add to IPC_CHANNELS
SCHEDULE_LIST: 'schedule:list',
SCHEDULE_CREATE: 'schedule:create',
SCHEDULE_UPDATE: 'schedule:update',
SCHEDULE_DELETE: 'schedule:delete',
SCHEDULE_TOGGLE: 'schedule:toggle',
SCHEDULE_RUN_NOW: 'schedule:run-now',

// Add handlers
ipcMain.handle('schedule:list', () => scheduler.list());
ipcMain.handle('schedule:create', (_, data) => scheduler.create(data));
ipcMain.handle('schedule:update', (_, id, updates) => scheduler.update(id, updates));
ipcMain.handle('schedule:delete', (_, id) => scheduler.delete(id));
ipcMain.handle('schedule:toggle', (_, id) => scheduler.toggle(id));
ipcMain.handle('schedule:run-now', (_, id) => scheduler.runNow(id));
```

### 3. UI Components

**File:** `apps/electron/src/renderer/components/scheduler/ScheduleModal.tsx` (~150 lines)

```tsx
import { useState } from 'react';
import { Cron } from 'croner';

const PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Daily at 9am', cron: '0 9 * * *' },
  { label: 'Weekdays at 9am', cron: '0 9 * * 1-5' },
  { label: 'Weekly on Monday', cron: '0 9 * * 1' },
  { label: 'Monthly on 1st', cron: '0 9 1 * *' },
];

interface ScheduleModalProps {
  schedule?: Schedule;
  onSave: (data: ScheduleFormData) => void;
  onClose: () => void;
}

export function ScheduleModal({ schedule, onSave, onClose }: ScheduleModalProps) {
  const [name, setName] = useState(schedule?.name || '');
  const [prompt, setPrompt] = useState(schedule?.prompt || '');
  const [scheduleType, setScheduleType] = useState<'recurring' | 'once'>(
    schedule?.cron ? 'recurring' : 'once'
  );
  const [selectedPreset, setSelectedPreset] = useState<string | 'custom'>(
    schedule?.cron && !PRESETS.find(p => p.cron === schedule.cron) ? 'custom' :
    schedule?.cron || PRESETS[1].cron
  );
  const [customCron, setCustomCron] = useState(schedule?.cron || '');
  const [scheduledFor, setScheduledFor] = useState<string>(
    schedule?.scheduledFor
      ? new Date(schedule.scheduledFor * 1000).toISOString().slice(0, 16)
      : ''
  );

  const cronExpression = selectedPreset === 'custom' ? customCron : selectedPreset;
  const cronError = validateCron(cronExpression);
  const nextRuns = cronError ? [] : getNextRuns(cronExpression, 3);

  function validateCron(expr: string): string | null {
    if (!expr) return 'Cron expression required';
    try {
      new Cron(expr);
      return null;
    } catch (e) {
      return e.message;
    }
  }

  function getNextRuns(expr: string, count: number): Date[] {
    try {
      const cron = new Cron(expr);
      return cron.nextRuns(count);
    } catch {
      return [];
    }
  }

  function handleSubmit() {
    if (scheduleType === 'recurring' && cronError) return;

    onSave({
      name,
      prompt,
      cron: scheduleType === 'recurring' ? cronExpression : null,
      scheduledFor: scheduleType === 'once' ? Math.floor(new Date(scheduledFor).getTime() / 1000) : null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      enabled: true,
    });
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{schedule ? 'Edit Schedule' : 'New Schedule'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Morning Standup"
            />
          </div>

          {/* Prompt */}
          <div>
            <Label>Prompt</Label>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Summarize my calendar for today..."
              rows={3}
            />
          </div>

          {/* Schedule Type */}
          <div>
            <Label>When to run</Label>
            <RadioGroup value={scheduleType} onValueChange={setScheduleType}>
              <RadioGroupItem value="recurring" label="Recurring" />
              <RadioGroupItem value="once" label="One-time" />
            </RadioGroup>
          </div>

          {/* Recurring Options */}
          {scheduleType === 'recurring' && (
            <div className="space-y-3">
              <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                {PRESETS.map(p => (
                  <SelectItem key={p.cron} value={p.cron}>{p.label}</SelectItem>
                ))}
                <SelectItem value="custom">Custom cron...</SelectItem>
              </Select>

              {selectedPreset === 'custom' && (
                <Input
                  value={customCron}
                  onChange={e => setCustomCron(e.target.value)}
                  placeholder="0 9 * * *"
                  className={cronError ? 'border-destructive' : ''}
                />
              )}

              {cronError && (
                <p className="text-xs text-destructive">{cronError}</p>
              )}

              {nextRuns.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <p className="font-medium">Next runs:</p>
                  {nextRuns.map((date, i) => (
                    <p key={i}>{date.toLocaleString()}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* One-time Options */}
          {scheduleType === 'once' && (
            <Input
              type="datetime-local"
              value={scheduledFor}
              onChange={e => setScheduledFor(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!name || !prompt || (scheduleType === 'recurring' && !!cronError)}
          >
            {schedule ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**File:** `apps/electron/src/renderer/components/scheduler/ScheduleList.tsx` (~100 lines)

```tsx
export function ScheduleList() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    window.electronAPI.scheduleList().then(setSchedules);
  }, []);

  async function handleCreate(data: ScheduleFormData) {
    const created = await window.electronAPI.scheduleCreate(data);
    setSchedules(prev => [...prev, created]);
    setShowNew(false);
  }

  async function handleUpdate(data: ScheduleFormData) {
    if (!editingSchedule) return;
    const updated = await window.electronAPI.scheduleUpdate(editingSchedule.id, data);
    setSchedules(prev => prev.map(s => s.id === updated.id ? updated : s));
    setEditingSchedule(null);
  }

  async function handleDelete(id: string) {
    await window.electronAPI.scheduleDelete(id);
    setSchedules(prev => prev.filter(s => s.id !== id));
  }

  async function handleToggle(id: string) {
    const updated = await window.electronAPI.scheduleToggle(id);
    setSchedules(prev => prev.map(s => s.id === updated.id ? updated : s));
  }

  async function handleRunNow(id: string) {
    await window.electronAPI.scheduleRunNow(id);
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Schedules</h2>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Schedule
        </Button>
      </div>

      {schedules.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No schedules yet</p>
          <p className="text-sm">Create a schedule to run prompts automatically</p>
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map(schedule => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              onEdit={() => setEditingSchedule(schedule)}
              onDelete={() => handleDelete(schedule.id)}
              onToggle={() => handleToggle(schedule.id)}
              onRunNow={() => handleRunNow(schedule.id)}
            />
          ))}
        </div>
      )}

      {/* App must be open notice */}
      <p className="text-xs text-muted-foreground mt-4 text-center">
        Schedules run when Vesper is open
      </p>

      {showNew && (
        <ScheduleModal onSave={handleCreate} onClose={() => setShowNew(false)} />
      )}

      {editingSchedule && (
        <ScheduleModal
          schedule={editingSchedule}
          onSave={handleUpdate}
          onClose={() => setEditingSchedule(null)}
        />
      )}
    </div>
  );
}

function ScheduleCard({ schedule, onEdit, onDelete, onToggle, onRunNow }) {
  const nextRun = schedule.enabled && schedule.cron
    ? new Cron(schedule.cron, { timezone: schedule.timezone }).nextRun()
    : null;

  return (
    <div className="p-3 rounded-lg border bg-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Switch checked={schedule.enabled} onCheckedChange={onToggle} />
          <div>
            <p className="font-medium">{schedule.name}</p>
            <p className="text-xs text-muted-foreground truncate max-w-[200px]">
              {schedule.prompt}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {schedule.lastRunStatus === 'failed' && (
            <Tooltip content={schedule.lastRunError}>
              <AlertCircle className="w-4 h-4 text-destructive" />
            </Tooltip>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={onRunNow}>Run Now</DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        {schedule.cron ? (
          nextRun ? `Next: ${nextRun.toLocaleString()}` : 'Invalid schedule'
        ) : (
          schedule.scheduledFor
            ? `Scheduled for: ${new Date(schedule.scheduledFor * 1000).toLocaleString()}`
            : 'Completed'
        )}
      </div>
    </div>
  );
}
```

---

## File Structure (Minimal)

```
apps/electron/src/
├── main/
│   ├── scheduler.ts          # ~200 lines - all scheduling logic
│   └── ipc.ts                # Add 6 handlers
└── renderer/
    └── components/
        └── scheduler/
            ├── ScheduleList.tsx   # ~100 lines
            └── ScheduleModal.tsx  # ~150 lines
```

**Total: ~450 lines of code, 3 new files, 1 npm package**

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `croner` | Cron scheduling + validation (zero deps, includes `nextRuns()`) |

**No additional packages needed.** Croner handles scheduling, validation, and next-run calculation.

---

## Acceptance Criteria

### v1 Requirements

- [x] User can create recurring schedules from presets (hourly, daily, weekly, monthly)
- [x] User can enter custom cron expressions
- [x] User can create one-time scheduled tasks
- [x] User can enable/disable schedules
- [x] User can edit and delete schedules
- [x] User can manually trigger "Run Now"
- [x] Schedules persist across app restarts (JSON file)
- [x] Tasks execute at scheduled times when app is open
- [x] Native notification shown on task completion/failure
- [x] UI shows next run time for each schedule
- [x] UI shows last run status (success/failed)

### Out of Scope for v1

- Background execution when app is closed
- Skill-specific scheduling (use prompts instead)
- Chat commands for scheduling
- Detailed execution history
- Priority/queue ordering
- Retry logic

---

## Limitations & Future Improvements

### v1 Limitations

1. **App must be open** - Schedules only run when Vesper is running
   - Show clear indicator in UI
   - If users request background execution, add launchd in v2

2. **No execution history** - Only last run status stored
   - Sessions are created and can be viewed
   - Add history table in v2 if needed

3. **No Skills support** - Prompts only
   - Users can invoke skills via prompt: "Run the /commit skill"
   - Add native Skill scheduling in v2 if needed

### v2 Candidates (if users request)

1. Background execution via launchd (macOS)
2. Execution history with session links
3. Native Skill scheduling
4. Chat commands (`/schedule`)
5. Schedule templates
6. Retry on failure

---

## Testing Strategy

### Critical Tests

1. **Schedule creation** - Verify JSON file updates correctly
2. **Cron validation** - Invalid expressions rejected
3. **Execution flow** - Prompt runs, notification shown, status updated
4. **One-time schedules** - Execute once, then disable
5. **App restart** - Schedules reload and resume correctly

### Manual Testing

1. Create schedule, wait for execution, verify notification
2. Create one-time schedule, verify it runs and disables
3. Disable schedule, verify it doesn't run
4. Close and reopen app, verify schedules persist

---

## Rollout Plan

1. **Internal testing** (1 week)
   - Team uses feature
   - Monitor for issues

2. **Ship to all users**
   - Feature visible in sidebar/menu
   - "Schedules run when app is open" note visible

3. **Gather feedback**
   - If >10 users request background execution, plan v2 with launchd
   - If >10 users request Skills, plan v2 with Skill support

---

## References

### Internal
- HeadlessRunner: `packages/shared/src/headless/runner.ts`
- Notifications: `apps/electron/src/main/notifications.ts`
- IPC patterns: `apps/electron/src/main/ipc.ts`

### External
- [Croner Documentation](https://croner.56k.guru) - Scheduling, validation, next runs

---

🤖 Generated with [Claude Code](https://claude.ai/claude-code)
