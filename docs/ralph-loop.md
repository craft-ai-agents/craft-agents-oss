# Ralph Loop - Autonomous Coding System

## Overview

Ralph Loop is an autonomous coding system integrated into the Vesper/Electron application. It enables users to execute iterative, goal-driven coding loops directly from the chat interface. Ralph Loop processes a PRD (Product Requirements Document) with checkbox-formatted user stories, working through each story autonomously until completion or iteration limits are reached.

### Key Capabilities

- **Autonomy**: Process multiple stories without constant user intervention
- **Structured Progress**: Track completion via checkbox-based PRDs
- **Resilience**: Continue working even when individual stories fail
- **Accountability**: Auto-commit changes with proper attribution
- **Control**: Pause, resume, or cancel at any time

---

## Architecture

### High-Level Design

```
+---------------------------------------------------------------------+
|                     Vesper Main Process                              |
+---------------------------------------------------------------------+
|  +------------------+    +----------------------------------------+  |
|  |  SessionManager  |<-->|         RalphLoopRunner                |  |
|  |  (existing)      |    |  - Story selection & parsing           |  |
|  +--------+---------+    |  - Iteration control                   |  |
|           |              |  - Progress event emission             |  |
|           |              |  - Git commit verification             |  |
|  +--------v---------+    +----------------+-----------------------+  |
|  |   CraftAgent     |<------------------>|                        |  |
|  |   (per story)    |    Reuses existing agent infrastructure    |  |
|  +------------------+                                              |  |
+---------------------------------------------------------------------+
                              ^
                              | IPC Events (loop_progress, loop_complete, etc.)
                              v
+---------------------------------------------------------------------+
|                    Renderer Process                                  |
|  +---------------------------------------------------------------+  |
|  |  Event Processor (extended for loop events)                   |  |
|  |  processEvent(state, LoopProgressEvent) => new state          |  |
|  +----------------------------+----------------------------------+  |
|                               |                                      |
|  +----------------------------v----------------------------------+  |
|  |  LoopProgressIndicator (chat integration)                     |  |
|  |  - Story progress (3/5)                                       |  |
|  |  - Current iteration (2/5)                                    |  |
|  |  - Elapsed time                                               |  |
|  |  - Pause/Cancel controls                                      |  |
|  +---------------------------------------------------------------+  |
+---------------------------------------------------------------------+
```

### Core Components

#### 1. RalphLoopRunner (`packages/shared/src/ralph-loop/loop-runner.ts`)

The central orchestrator for loop execution. Key responsibilities:

- Manages loop lifecycle (start, pause, resume, cancel)
- Processes stories sequentially
- Controls iterations per story (default: 5)
- Handles timeouts (default: 10 minutes per story)
- Emits progress events
- Coordinates with CraftAgent for story execution
- Integrates with git operations for commit verification

```typescript
export class RalphLoopRunner extends EventEmitter {
  constructor(
    private sessionId: string,
    private agent: CraftAgent,
    private gitOps: GitOperations,
    private config: LoopConfig
  ) {}

  async start(prd: PRD): Promise<LoopResult>
  pause(): void
  async resume(): Promise<void>
  cancel(): void
  getState(): LoopState | null
  isRunning(): boolean
}
```

#### 2. PRD Parser (`packages/shared/src/ralph-loop/prd-parser.ts`)

Parses markdown PRD documents into structured story objects:

- Extracts checkbox-formatted user stories
- Tracks story status (pending, completed, failed, skipped)
- Maintains line numbers for marking stories complete
- Validates PRD format and detects duplicates

```typescript
export function parsePRD(markdown: string): PRD
export function markStoryComplete(prd: PRD, storyId: string): PRD
export function markStoryFailed(prd: PRD, storyId: string): PRD
export function markStorySkipped(prd: PRD, storyId: string): PRD
export function getNextPendingStory(prd: PRD): Story | null
export function validatePRD(markdown: string): { isValid: boolean; error?: string }
export function generateStoryPrompt(story: Story, prdPath?: string): string
```

#### 3. Git Operations (`packages/shared/src/ralph-loop/git-ops.ts`)

Handles git operations for commit tracking and auto-commit:

```typescript
export interface GitOperations {
  getCurrentHead(): Promise<string>
  hasUncommittedChanges(): Promise<boolean>
  getChangesSummary(): Promise<ChangeSummary>
  createAutoCommit(storyId: string, title: string): Promise<string>
  verifyCommitCreated(beforeHead: string): Promise<boolean>
  getLastCommitMessage(): Promise<string>
  isGitRepository(): Promise<boolean>
}
```

#### 4. Module Index (`packages/shared/src/ralph-loop/index.ts`)

Exports all public types and functions for the Ralph Loop system.

### Key File Locations

| File | Purpose |
|------|---------|
| `packages/shared/src/ralph-loop/types.ts` | Core type definitions |
| `packages/shared/src/ralph-loop/loop-runner.ts` | Main loop orchestration |
| `packages/shared/src/ralph-loop/prd-parser.ts` | PRD parsing and validation |
| `packages/shared/src/ralph-loop/git-ops.ts` | Git commit operations |
| `packages/shared/src/ralph-loop/index.ts` | Module exports |
| `apps/electron/src/main/sessions.ts` | IPC handlers and integration |
| `apps/electron/src/renderer/components/loop/` | UI components |
| `apps/electron/src/renderer/event-processor/handlers/loop.ts` | Event handlers |

---

## Permission Mode

### The 'ralph' Permission Mode

Ralph Loop introduces a dedicated permission mode (`'ralph'`) optimized for autonomous execution workflows.

#### Mode Definition (`packages/shared/src/agent/mode-types.ts`)

```typescript
export type PermissionMode = 'safe' | 'ask' | 'allow-all' | 'ralph';
```

#### Mode Characteristics

| Mode | Display Name | Description | Color |
|------|--------------|-------------|-------|
| `safe` | Explore | Read-only, blocks writes, never prompts | Grey |
| `ask` | Ask to Edit | Prompts for dangerous operations | Amber |
| `allow-all` | Execute | Everything allowed, no prompts | Purple |
| `ralph` | Ralph | Autonomous loop mode for automated workflows | Orange |

#### How Ralph Mode Differs

The `ralph` mode provides the same capabilities as `allow-all` but is explicitly designed for automated workflows:

- **Full tool access**: No restrictions on file writes, bash commands, or API calls
- **No prompts**: Operations execute without user confirmation
- **Optimized for loops**: Designed for multi-story autonomous execution
- **Clear signal**: Indicates the session is in an automated workflow state

#### Mode Manager Integration (`packages/shared/src/agent/mode-manager.ts`)

```typescript
// Ralph mode is treated like allow-all for permissions
if (mode === 'allow-all' || mode === 'ralph') {
  return { allowed: true };
}
```

#### UI Configuration

```typescript
'ralph': {
  displayName: 'Ralph',
  shortName: 'Ralph',
  description: 'Autonomous loop mode. Full execution, optimized for automated workflows.',
  // Zap icon from Lucide (lightning bolt for speed/automation)
  svgPath: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  colorClass: {
    text: 'text-warning',
    bg: 'bg-warning',
    border: 'border-warning',
  },
}
```

**Note**: Ralph mode is not included in the standard `PERMISSION_MODE_ORDER` for SHIFT+TAB cycling - it is set programmatically when a loop starts.

---

## PRD Format

### Expected Markdown Format

Ralph Loop parses PRD documents with checkbox-formatted user stories. The expected format:

```markdown
# Feature Name

## Overview
Brief description of the feature.

## User Stories

### [ ] US-001: Story title here
Detailed description of what needs to be implemented.
- Acceptance criteria 1
- Acceptance criteria 2

### [ ] US-002: Another story title
Description of the second story.
Implementation notes and requirements.

### [x] US-003: Already completed story
This story is already marked as done.
```

### Story Header Pattern

The parser uses this regex pattern to match story headers:

```typescript
const STORY_HEADER_PATTERN = /^###\s*\[([ xX])\]\s*([A-Za-z]*-?\d+):\s*(.+)$/
```

### Supported Variations

- `### [ ] US-001: Title` - Standard format with prefix
- `### [ ] 001: Title` - Numeric only (no prefix)
- `### [ ] STORY-001: Title` - Custom prefix
- `### [x] US-001: Title` - Completed story (checkbox checked)
- `### [X] US-001: Title` - Case-insensitive checkbox

### Story Structure

```typescript
export interface Story {
  /** Story identifier (e.g., "US-001") */
  id: string
  /** Story title from the checkbox line */
  title: string
  /** Line number in original PRD (for marking complete) */
  lineNumber: number
  /** Full story block content including description */
  content: string
  /** Current status of this story */
  status: StoryStatus  // 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
}
```

### PRD Structure

```typescript
export interface PRD {
  /** Original markdown source */
  source: string
  /** Extracted stories */
  stories: Story[]
  /** PRD metadata */
  metadata: {
    totalStories: number
    completedStories: number
    pendingStories: number
    failedStories: number
  }
}
```

---

## IPC API

### IPC Channels

The following IPC channels are registered for Ralph Loop control:

| Channel | Purpose |
|---------|---------|
| `loop:start` | Start a new loop with PRD content |
| `loop:pause` | Pause the running loop |
| `loop:resume` | Resume a paused loop |
| `loop:cancel` | Cancel the loop immediately |
| `loop:getState` | Get current loop state |

### Channel Definitions (`apps/electron/src/shared/types.ts`)

```typescript
export const IPC_CHANNELS = {
  // ... other channels

  // Ralph Loop (autonomous coding loops)
  LOOP_START: 'loop:start',
  LOOP_PAUSE: 'loop:pause',
  LOOP_RESUME: 'loop:resume',
  LOOP_CANCEL: 'loop:cancel',
  LOOP_GET_STATE: 'loop:getState',
} as const
```

### Electron API Interface

```typescript
interface ElectronAPI {
  // Ralph Loop (autonomous coding loops)
  loopStart(sessionId: string, prdContent: string, config?: LoopConfigInput): Promise<{ loopId: string } | { error: string }>
  loopPause(sessionId: string): Promise<void>
  loopResume(sessionId: string): Promise<void>
  loopCancel(sessionId: string): Promise<void>
  loopGetState(sessionId: string): Promise<LoopStateUI | null>
}
```

### Preload Bindings (`apps/electron/src/preload/index.ts`)

```typescript
// Ralph Loop (autonomous coding loops)
loopStart: (sessionId: string, prdContent: string, config?: LoopConfigInput) =>
  ipcRenderer.invoke(IPC_CHANNELS.LOOP_START, sessionId, prdContent, config),
loopPause: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.LOOP_PAUSE, sessionId),
loopResume: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.LOOP_RESUME, sessionId),
loopCancel: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.LOOP_CANCEL, sessionId),
loopGetState: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.LOOP_GET_STATE, sessionId),
```

---

## Event Types

### SessionEvent Union Types

The following event types are emitted from main to renderer during loop execution:

```typescript
export type SessionEvent =
  // ... other events

  // Ralph Loop events
  | { type: 'loop_started'; sessionId: string; loopId: string; totalStories: number; config: { maxIterationsPerStory: number; timeoutPerStoryMs: number; autoCommit: boolean } }
  | { type: 'loop_progress'; sessionId: string; loopId: string; currentStory: { id: string; title: string } | null; storyIndex: number; totalStories: number; currentIteration: number; maxIterations: number; elapsedMs: number; status: 'running' | 'paused' }
  | { type: 'loop_story_complete'; sessionId: string; loopId: string; story: { id: string; title: string }; result: 'success' | 'failed' | 'skipped' | 'timeout'; commitSha?: string; error?: string }
  | { type: 'loop_complete'; sessionId: string; loopId: string; summary: { totalStories: number; completedStories: number; failedStories: number; skippedStories: number; totalTimeMs: number; commits: string[] } }
  | { type: 'loop_paused'; sessionId: string; loopId: string; currentStoryIndex: number; completedStories: number }
  | { type: 'loop_resumed'; sessionId: string; loopId: string }
  | { type: 'loop_cancelled'; sessionId: string; loopId: string; completedStories: number; totalStories: number }
  | { type: 'loop_error'; sessionId: string; loopId: string; storyId?: string; error: string; code: 'timeout' | 'agent_error' | 'git_error' | 'permission_denied' | 'unknown' }
```

### Event Descriptions

| Event | Description |
|-------|-------------|
| `loop_started` | Loop execution has begun |
| `loop_progress` | Real-time updates during loop execution |
| `loop_story_complete` | A single story finished processing |
| `loop_complete` | Entire loop finished successfully |
| `loop_paused` | Loop was paused by user |
| `loop_resumed` | Loop was resumed after pause |
| `loop_cancelled` | Loop was cancelled by user |
| `loop_error` | Error during loop execution |

### RalphLoopRunner Events

The runner emits strongly-typed events:

```typescript
export type LoopRunnerEvent =
  | { type: 'progress'; state: LoopState }
  | { type: 'story_start'; story: Story }
  | { type: 'story_complete'; story: Story; result: StoryResult }
  | { type: 'iteration'; iteration: number; story: Story }
  | { type: 'error'; error: LoopError }
  | { type: 'complete'; result: LoopResult }
  | { type: 'paused'; state: LoopState }
  | { type: 'resumed'; state: LoopState }
```

---

## Configuration

### LoopConfig Options

```typescript
export interface LoopConfig {
  /** Maximum iterations per story before moving on (default: 5) */
  maxIterationsPerStory: number
  /** Timeout per story in milliseconds (default: 600000 = 10 min) */
  timeoutPerStoryMs: number
  /** Whether to auto-commit changes when agent doesn't (default: true) */
  autoCommit: boolean
  /** Prefix for commit messages (default: "feat") */
  commitMessagePrefix: string
}
```

### Default Values

```typescript
export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  maxIterationsPerStory: 5,
  timeoutPerStoryMs: 600000,  // 10 minutes
  autoCommit: true,
  commitMessagePrefix: 'feat',
}
```

### LoopConfigInput (UI Input)

```typescript
export interface LoopConfigInput {
  maxIterationsPerStory?: number
  timeoutPerStoryMs?: number
  autoCommit?: boolean
  commitMessagePrefix?: string
}
```

---

## Execution Flow

### Story Processing Sequence

```
1. Parse PRD into structured stories
2. Validate PRD (check for duplicates, valid format)
3. For each pending story:
   a. Capture current git HEAD
   b. Mark story as in_progress
   c. For each iteration (up to maxIterationsPerStory):
      i.   Generate story prompt
      ii.  Send to CraftAgent
      iii. Wait for agent completion
      iv.  Check for timeout
      v.   If success, verify/create commit
      vi.  If failure, continue to next iteration
   d. Mark story result (success/failed/timeout)
   e. Check for pause/cancel
   f. Emit story_complete event
4. Emit loop_complete with summary
```

### Iteration Control

Each story is processed with configurable iteration limits:

- Default: 5 iterations maximum per story
- Each iteration represents one agent turn
- If the agent completes the task, iteration stops
- Timeout applies per-story (default: 10 minutes)
- Stories can be skipped if they exceed iteration limits

### Timeout Handling

```typescript
// Set up timeout
const timeoutId = setTimeout(() => {
  this.currentAbortController?.abort()
}, this.config.timeoutPerStoryMs)

try {
  // Run the agent
  for await (const event of this.agent.chat(prompt)) {
    // ... process events
  }
} finally {
  clearTimeout(timeoutId)
}
```

### Git Commit Integration

The loop integrates with git for change tracking:

1. **Before story**: Capture HEAD commit SHA
2. **After story success**: Check if new commit was created
3. **Auto-commit**: If no commit and changes exist, create one automatically

```typescript
// Auto-commit message format
const message = `feat(${storyId}): ${title}\n\nAuto-committed by Ralph Loop`
```

### Pause/Resume/Cancel

- **Pause**: Sets `isPaused` flag; loop completes current story then stops
- **Resume**: Clears `isPaused` flag and continues with next story
- **Cancel**: Sets `isCancelled` flag and aborts current operation immediately

---

## UI Integration

### Session State Extension

Sessions track loop state for UI display:

```typescript
export interface Session {
  // ... other fields

  // Ralph Loop state (when a loop is active)
  loopState?: LoopStateUI
}

export interface LoopStateUI {
  /** Whether a loop is currently active */
  isActive: boolean
  /** Loop ID for tracking */
  loopId?: string
  /** Current status */
  status?: 'running' | 'paused' | 'completed' | 'cancelled' | 'error'
  /** Current story being processed */
  currentStory?: {
    id: string
    title: string
  }
  /** Progress tracking */
  progress?: {
    currentStoryIndex: number
    totalStories: number
    currentIteration: number
    maxIterations: number
  }
  /** Elapsed time in milliseconds */
  elapsedMs?: number
  /** Summary (available after completion) */
  summary?: {
    totalStories: number
    completedStories: number
    failedStories: number
    skippedStories: number
    totalTimeMs: number
    commits: string[]
  }
}
```

### LoopProgressIndicator Component

Located at `apps/electron/src/renderer/components/loop/LoopProgressIndicator.tsx`:

```tsx
export interface LoopProgressIndicatorProps {
  /** Current loop state */
  loopState: LoopStateUI
  /** Callback when pause button is clicked */
  onPause?: () => void
  /** Callback when resume button is clicked */
  onResume?: () => void
  /** Callback when cancel button is clicked */
  onCancel?: () => void
  /** Additional class name */
  className?: string
}
```

**Visual Layout:**

```
+------------------------------------------------------------------+
| Running    | Story 3/5 [=======>     ] | US-003 Add auth | 4m 32s | [||] [X]
+------------------------------------------------------------------+
```

Features:
- Status indicator with icon (running/paused/completed/cancelled/error)
- Story progress bar and count
- Current story ID and title
- Iteration counter
- Elapsed time display
- Pause/Resume and Cancel buttons

### Event Handlers

Located at `apps/electron/src/renderer/event-processor/handlers/loop.ts`:

```typescript
handleLoopStarted(state, event): SessionState
handleLoopProgress(state, event): SessionState
handleLoopStoryComplete(state, event): SessionState
handleLoopComplete(state, event): SessionState
handleLoopPaused(state, event): SessionState
handleLoopResumed(state, event): SessionState
handleLoopCancelled(state, event): SessionState
handleLoopError(state, event): SessionState
```

These are pure functions that return new state - no side effects.

---

## Main Process Integration

### SessionManager Methods

The `SessionManager` class in `apps/electron/src/main/sessions.ts` implements the loop control methods:

```typescript
class SessionManager {
  /** Map of session ID -> running RalphLoopRunner */
  private loopRunners: Map<string, RalphLoopRunner> = new Map()

  /** Start a Ralph Loop for a session */
  async startLoop(sessionId: string, prdContent: string, config?: LoopConfigInput): Promise<{ loopId: string } | { error: string }>

  /** Pause a running loop */
  async pauseLoop(sessionId: string): Promise<void>

  /** Resume a paused loop */
  async resumeLoop(sessionId: string): Promise<void>

  /** Cancel a running loop */
  async cancelLoop(sessionId: string): Promise<void>

  /** Get current loop state for a session */
  getLoopState(sessionId: string): LoopStateUI | null
}
```

### IPC Handlers

IPC handlers in `apps/electron/src/main/ipc.ts`:

```typescript
ipcMain.handle(IPC_CHANNELS.LOOP_START, async (_event, sessionId, prdContent, config) => {
  return sessionManager.startLoop(sessionId, prdContent, config)
})

ipcMain.handle(IPC_CHANNELS.LOOP_PAUSE, async (_event, sessionId) => {
  await sessionManager.pauseLoop(sessionId)
})

ipcMain.handle(IPC_CHANNELS.LOOP_RESUME, async (_event, sessionId) => {
  await sessionManager.resumeLoop(sessionId)
})

ipcMain.handle(IPC_CHANNELS.LOOP_CANCEL, async (_event, sessionId) => {
  await sessionManager.cancelLoop(sessionId)
})

ipcMain.handle(IPC_CHANNELS.LOOP_GET_STATE, async (_event, sessionId) => {
  return sessionManager.getLoopState(sessionId)
})
```

---

## Type Definitions

### Loop Status Types

```typescript
export type LoopStatus = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error'

export type StoryStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
```

### Error Types

```typescript
export interface LoopError {
  /** Story that failed (if applicable) */
  storyId?: string
  /** Error message */
  message: string
  /** Error code for categorization */
  code: 'timeout' | 'agent_error' | 'git_error' | 'permission_denied' | 'unknown'
  /** Timestamp of the error */
  timestamp: number
}
```

### Result Types

```typescript
export interface StoryResult {
  /** Story that was processed */
  storyId: string
  /** Outcome of processing */
  result: 'success' | 'failed' | 'skipped' | 'timeout'
  /** Git commit SHA if changes were committed */
  commitSha?: string
  /** Number of iterations taken */
  iterations: number
  /** Time taken in milliseconds */
  durationMs: number
  /** Error message if failed */
  error?: string
}

export interface LoopResult {
  /** Unique identifier of the completed loop */
  loopId: string
  /** Final status */
  status: 'completed' | 'cancelled' | 'error'
  /** Summary statistics */
  summary: {
    totalStories: number
    completedStories: number
    failedStories: number
    skippedStories: number
    totalTimeMs: number
    commits: string[]
  }
  /** Individual story results */
  storyResults: StoryResult[]
  /** Errors that occurred */
  errors: LoopError[]
}
```

### State Types

```typescript
export interface LoopState {
  /** Unique identifier for this loop execution */
  id: string
  /** Session this loop is running in */
  sessionId: string
  /** The PRD being processed */
  prd: PRD
  /** Configuration for this loop */
  config: LoopConfig
  /** Currently processing story (null if between stories or not started) */
  currentStory: Story | null
  /** Current iteration number for the current story (1-indexed) */
  currentIteration: number
  /** Overall loop status */
  status: LoopStatus
  /** When the loop started (Unix timestamp) */
  startTime: number
  /** Number of stories completed successfully */
  storiesCompleted: number
  /** Errors encountered during execution */
  errors: LoopError[]
  /** Results for each processed story */
  storyResults: StoryResult[]
}
```

### Persistence Types

```typescript
export interface PersistedLoopState {
  loopId: string
  sessionId: string
  prd: PRD
  config: LoopConfig
  currentStoryIndex: number
  currentIteration: number
  completedStories: string[]
  failedStories: string[]
  skippedStories: string[]
  storyResults: StoryResult[]
  startTime: number
  lastUpdated: number
}
```

---

## Usage Example

### Starting a Loop

```typescript
// From renderer process
const prdContent = `
# Feature: User Authentication

### [ ] US-001: Add login form
Create a login form with email and password fields.

### [ ] US-002: Implement JWT authentication
Add JWT token generation and validation.

### [ ] US-003: Add logout functionality
Implement logout button and session cleanup.
`;

const config = {
  maxIterationsPerStory: 3,
  timeoutPerStoryMs: 300000,  // 5 minutes
  autoCommit: true,
};

const result = await window.electronAPI.loopStart(sessionId, prdContent, config);

if ('error' in result) {
  console.error('Failed to start loop:', result.error);
} else {
  console.log('Loop started:', result.loopId);
}
```

### Controlling the Loop

```typescript
// Pause
await window.electronAPI.loopPause(sessionId);

// Resume
await window.electronAPI.loopResume(sessionId);

// Cancel
await window.electronAPI.loopCancel(sessionId);

// Check state
const state = await window.electronAPI.loopGetState(sessionId);
if (state?.isActive) {
  console.log(`Processing story ${state.progress?.currentStoryIndex + 1}/${state.progress?.totalStories}`);
}
```

### Listening for Events

```typescript
// In React component
useEffect(() => {
  const cleanup = window.electronAPI.onSessionEvent((event) => {
    if (event.type === 'loop_progress') {
      console.log(`Story ${event.storyIndex + 1}/${event.totalStories}: ${event.currentStory?.title}`);
    } else if (event.type === 'loop_complete') {
      console.log(`Loop complete! ${event.summary.completedStories}/${event.summary.totalStories} stories done.`);
    }
  });

  return cleanup;
}, []);
```

---

## References

### Internal Files

- Loop types: `/Users/tinnguyen/vesper/packages/shared/src/ralph-loop/types.ts`
- Loop runner: `/Users/tinnguyen/vesper/packages/shared/src/ralph-loop/loop-runner.ts`
- PRD parser: `/Users/tinnguyen/vesper/packages/shared/src/ralph-loop/prd-parser.ts`
- Git operations: `/Users/tinnguyen/vesper/packages/shared/src/ralph-loop/git-ops.ts`
- Mode types: `/Users/tinnguyen/vesper/packages/shared/src/agent/mode-types.ts`
- Mode manager: `/Users/tinnguyen/vesper/packages/shared/src/agent/mode-manager.ts`
- Session manager: `/Users/tinnguyen/vesper/apps/electron/src/main/sessions.ts`
- IPC types: `/Users/tinnguyen/vesper/apps/electron/src/shared/types.ts`
- Preload bindings: `/Users/tinnguyen/vesper/apps/electron/src/preload/index.ts`
- Event handlers: `/Users/tinnguyen/vesper/apps/electron/src/renderer/event-processor/handlers/loop.ts`
- UI components: `/Users/tinnguyen/vesper/apps/electron/src/renderer/components/loop/`

### Related Documentation

- Plan: `/Users/tinnguyen/vesper/plans/feat-ralph-loop-integration.md`
