# Ralph Loop - Technical Architecture

## Overview

Ralph Loop is an autonomous coding system integrated into the Vesper Electron application. It enables users to execute iterative, goal-driven coding loops directly from the chat interface. Ralph Loop processes a PRD (Product Requirements Document) with checkbox-formatted user stories, working through each story autonomously until completion or iteration limits are reached.

This document provides comprehensive technical details for developers working on or integrating with the Ralph Loop system.

---

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Core Components](#core-components)
3. [Permission Mode System](#permission-mode-system)
4. [PRD Format Specification](#prd-format-specification)
5. [IPC API](#ipc-api)
6. [Event System](#event-system)
7. [Configuration](#configuration)
8. [Execution Flow](#execution-flow)
9. [UI Integration](#ui-integration)
10. [Main Process Integration](#main-process-integration)
11. [Type Definitions](#type-definitions)
12. [State Persistence](#state-persistence)
13. [Security Considerations](#security-considerations)
14. [Design Decisions](#design-decisions)

---

## High-Level Architecture

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
|  |  - Expandable sections (Completed, Activity, Errors)          |  |
|  +---------------------------------------------------------------+  |
+---------------------------------------------------------------------+
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent Integration | Use Claude Agent SDK directly | Avoids CLI spawning overhead, integrates with existing permission system |
| Process Location | Main process | Simpler IPC, direct access to SessionManager and git operations |
| State Management | Extend session state with loop metadata | Consistent with Vesper's Jotai atom architecture |
| PRD Format | Markdown with `### [ ] US-XXX:` syntax | Compatible with standard checkbox format, easy to edit |
| Permission Handling | Respect session's current mode | Maintains safety, locks mode during execution |
| Loop Invocation | Direct IPC call | Faster, more reliable than LLM-mediated flow |

---

## Core Components

### 1. RalphLoopRunner

**Location:** `packages/shared/src/ralph-loop/loop-runner.ts`

The central orchestrator for loop execution.

**Responsibilities:**
- Manages loop lifecycle (start, pause, resume, cancel)
- Processes stories sequentially
- Controls iterations per story (default: 5)
- Handles timeouts (default: 10 minutes per story)
- Emits progress events
- Coordinates with CraftAgent for story execution
- Integrates with git operations for commit verification

**Interface:**

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

**Event Emissions:**

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

### 2. PRD Parser

**Location:** `packages/shared/src/ralph-loop/prd-parser.ts`

Parses markdown PRD documents into structured story objects.

**Responsibilities:**
- Extracts checkbox-formatted user stories
- Tracks story status (pending, completed, failed, skipped)
- Maintains line numbers for marking stories complete
- Validates PRD format and detects duplicates

**Interface:**

```typescript
export function parsePRD(markdown: string): PRD
export function markStoryComplete(prd: PRD, storyId: string): PRD
export function markStoryFailed(prd: PRD, storyId: string): PRD
export function markStorySkipped(prd: PRD, storyId: string): PRD
export function getNextPendingStory(prd: PRD): Story | null
export function validatePRD(markdown: string): { isValid: boolean; error?: string }
export function generateStoryPrompt(story: Story, prdPath?: string): string
```

**Story Structure:**

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

**PRD Structure:**

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

### 3. Git Operations

**Location:** `packages/shared/src/ralph-loop/git-ops.ts`

Handles git operations for commit tracking and auto-commit.

**Interface:**

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

export function createGitOperations(workingDirectory: string): GitOperations
```

**Auto-commit Message Format:**

```
feat(US-XXX): story title

Auto-committed by Ralph Loop
```

### 4. Module Index

**Location:** `packages/shared/src/ralph-loop/index.ts`

Exports all public types and functions for the Ralph Loop system.

### Key File Locations

| File | Purpose |
|------|---------|
| `packages/shared/src/ralph-loop/types.ts` | Core type definitions |
| `packages/shared/src/ralph-loop/loop-runner.ts` | Main loop orchestration |
| `packages/shared/src/ralph-loop/prd-parser.ts` | PRD parsing and validation |
| `packages/shared/src/ralph-loop/git-ops.ts` | Git commit operations |
| `packages/shared/src/ralph-loop/state-storage.ts` | Loop state persistence |
| `packages/shared/src/ralph-loop/index.ts` | Module exports |
| `apps/electron/src/main/sessions.ts` | IPC handlers and integration |
| `apps/electron/src/renderer/components/loop/` | UI components |
| `apps/electron/src/renderer/event-processor/handlers/loop.ts` | Event handlers |

---

## Permission Mode System

### The 'ralph' Permission Mode

Ralph Loop introduces a dedicated permission mode (`'ralph'`) optimized for autonomous execution workflows.

**Mode Definition:**

```typescript
// packages/shared/src/agent/mode-types.ts
export type PermissionMode = 'safe' | 'ask' | 'allow-all' | 'ralph';
```

**Mode Characteristics:**

| Mode | Display Name | Description | Color |
|------|--------------|-------------|-------|
| `safe` | Explore | Read-only, blocks writes, never prompts | Grey |
| `ask` | Ask to Edit | Prompts for dangerous operations | Amber |
| `allow-all` | Execute | Everything allowed, no prompts | Purple |
| `ralph` | Ralph | Autonomous loop mode for automated workflows | Orange |

**How Ralph Mode Differs:**

The `ralph` mode provides the same capabilities as `allow-all` but is explicitly designed for automated workflows:

- **Full tool access**: No restrictions on file writes, bash commands, or API calls
- **No prompts**: Operations execute without user confirmation
- **Optimized for loops**: Designed for multi-story autonomous execution
- **Clear signal**: Indicates the session is in an automated workflow state
- **Mode locking**: Permission mode is locked during loop execution to prevent accidental changes

**Mode Manager Integration:**

```typescript
// packages/shared/src/agent/mode-manager.ts
// Ralph mode is treated like allow-all for permissions
if (mode === 'allow-all' || mode === 'ralph') {
  return { allowed: true };
}
```

**UI Configuration:**

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

**Note:** Ralph mode is not included in the standard `PERMISSION_MODE_ORDER` for SHIFT+TAB cycling - it is set programmatically when a loop starts and locked during execution.

---

## PRD Format Specification

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

**Components:**
- `###` - Level 3 markdown heading
- `\[([ xX])\]` - Checkbox (space for unchecked, x/X for checked)
- `([A-Za-z]*-?\d+)` - Story ID (optional prefix, required number)
- `:` - Separator
- `(.+)` - Story title

### Supported Variations

- `### [ ] US-001: Title` - Standard format with prefix
- `### [ ] 001: Title` - Numeric only (no prefix)
- `### [ ] STORY-001: Title` - Custom prefix
- `### [x] US-001: Title` - Completed story (checkbox checked)
- `### [X] US-001: Title` - Case-insensitive checkbox

---

## IPC API

### IPC Channels

**Channel Definitions:**

```typescript
// apps/electron/src/shared/types.ts
export const IPC_CHANNELS = {
  // ... other channels

  // Ralph Loop (autonomous coding loops)
  LOOP_START: 'loop:start',
  LOOP_PAUSE: 'loop:pause',
  LOOP_RESUME: 'loop:resume',
  LOOP_CANCEL: 'loop:cancel',
  LOOP_GET_STATE: 'loop:getState',
  LOOP_SKIP_STORY: 'loop:skipStory',
  LOOP_RECOVER: 'loop:recover',
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
  loopSkipStory(sessionId: string): Promise<void>
  loopRecover(sessionId: string): Promise<void>
}
```

### Preload Bindings

**Location:** `apps/electron/src/preload/index.ts`

```typescript
// Ralph Loop (autonomous coding loops)
loopStart: (sessionId: string, prdContent: string, config?: LoopConfigInput) =>
  ipcRenderer.invoke(IPC_CHANNELS.LOOP_START, sessionId, prdContent, config),
loopPause: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.LOOP_PAUSE, sessionId),
loopResume: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.LOOP_RESUME, sessionId),
loopCancel: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.LOOP_CANCEL, sessionId),
loopGetState: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.LOOP_GET_STATE, sessionId),
loopSkipStory: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.LOOP_SKIP_STORY, sessionId),
loopRecover: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.LOOP_RECOVER, sessionId),
```

---

## Event System

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

| Event | Description | Emitted When |
|-------|-------------|--------------|
| `loop_started` | Loop execution has begun | Loop starts successfully |
| `loop_progress` | Real-time updates during loop execution | Every iteration, story change, or time threshold |
| `loop_story_complete` | A single story finished processing | Story succeeds, fails, or is skipped |
| `loop_complete` | Entire loop finished successfully | All stories processed or loop cancelled |
| `loop_paused` | Loop was paused by user | User clicks pause button |
| `loop_resumed` | Loop was resumed after pause | User clicks resume button |
| `loop_cancelled` | Loop was cancelled by user | User confirms cancellation |
| `loop_error` | Error during loop execution | Fatal error or story failure |

### Event Handlers

**Location:** `apps/electron/src/renderer/event-processor/handlers/loop.ts`

```typescript
export function handleLoopStarted(state: SessionState, event: LoopStartedEvent): SessionState
export function handleLoopProgress(state: SessionState, event: LoopProgressEvent): SessionState
export function handleLoopStoryComplete(state: SessionState, event: LoopStoryCompleteEvent): SessionState
export function handleLoopComplete(state: SessionState, event: LoopCompleteEvent): SessionState
export function handleLoopPaused(state: SessionState, event: LoopPausedEvent): SessionState
export function handleLoopResumed(state: SessionState, event: LoopResumedEvent): SessionState
export function handleLoopCancelled(state: SessionState, event: LoopCancelledEvent): SessionState
export function handleLoopError(state: SessionState, event: LoopErrorEvent): SessionState
```

These are pure functions that return new state - no side effects.

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
3. Lock permission mode to 'ralph'
4. For each pending story:
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
   e. Emit story_complete event
   f. Check for pause/cancel
   g. Persist loop state
5. Emit loop_complete with summary
6. Unlock permission mode
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

### Skip Story

- **Skip**: Marks current story as skipped with `[~]` checkbox
- Moves to next pending story
- Updates PRD with skip marker
- Emits story_complete event with 'skipped' result

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
  /** Completed stories list */
  completedStories?: CompletedStory[]
  /** Activity log (last 20 actions) */
  activityLog?: ActivityLogEntry[]
  /** Error history */
  errorHistory?: LoopError[]
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

**Location:** `apps/electron/src/renderer/components/loop/LoopProgressIndicator.tsx`

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
  /** Callback when skip story button is clicked */
  onSkipStory?: () => void
  /** Additional class name */
  className?: string
}
```

**Visual Layout:**

```
+------------------------------------------------------------------+
| Running    | Story 3/5 [=======>     ] | US-003 Add auth | 4m 32s | [||] [Skip] [X]
+------------------------------------------------------------------+
| ▼ Completed Stories (2/5)                                        |
|   ✅ US-001: Create login form (2m 15s) [abc123]                |
|   ✅ US-002: Add form styling (1m 30s) [def456]                 |
+------------------------------------------------------------------+
| ▼ Activity Log                                                   |
|   [14:23:45] Bash: npm install                                   |
|   [14:24:01] Edit: src/components/LoginForm.tsx                  |
|   [14:24:23] Bash: git add .                                     |
+------------------------------------------------------------------+
| ▼ Error Details                                                  |
|   [Auto-expands when error occurs]                               |
+------------------------------------------------------------------+
```

**Features:**
- Status indicator with icon (running/paused/completed/cancelled/error)
- Story progress bar and count
- Current story ID and title
- Iteration counter
- Elapsed time display
- Pause/Resume, Skip Story, and Cancel buttons
- Three expandable sections: Completed Stories, Activity Log, Error Details

### UI Components

**Location:** `apps/electron/src/renderer/components/loop/`

- `LoopProgressIndicator.tsx` - Main progress display
- `LoopSummaryCard.tsx` - Completion summary
- `CompletedStoriesList.tsx` - Expandable completed stories list
- `ActivityLogViewer.tsx` - Expandable activity log with virtualization
- `ErrorDetailsSection.tsx` - Error display with recovery options
- `ConfirmCancelLoopModal.tsx` - Confirmation modal for cancel action

---

## Main Process Integration

### SessionManager Methods

**Location:** `apps/electron/src/main/sessions.ts`

The `SessionManager` class implements the loop control methods:

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

  /** Skip current story in running loop */
  async skipCurrentStory(sessionId: string): Promise<void>

  /** Get current loop state for a session */
  getLoopState(sessionId: string): LoopStateUI | null

  /** Persist loop state to disk */
  private async persistLoopState(sessionId: string): Promise<void>

  /** Recover loop state from disk */
  private async recoverLoopState(sessionId: string): Promise<PersistedLoopState | null>
}
```

### IPC Handlers

**Location:** `apps/electron/src/main/ipc.ts`

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

ipcMain.handle(IPC_CHANNELS.LOOP_SKIP_STORY, async (_event, sessionId) => {
  await sessionManager.skipCurrentStory(sessionId)
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

### UI-Specific Types

```typescript
export interface CompletedStory {
  id: string
  title: string
  result: 'success' | 'failed' | 'skipped' | 'timeout'
  commitSha?: string
  durationMs: number
}

export interface ActivityLogEntry {
  timestamp: number
  tool: string
  summary: string
}
```

---

## State Persistence

### Persistence Storage

**Location:** `packages/shared/src/ralph-loop/state-storage.ts`

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

export class LoopStateStorage {
  constructor(private workspacePath: string) {}

  save(state: PersistedLoopState): Promise<void>
  load(loopId: string): Promise<PersistedLoopState | null>
  getActiveLoop(sessionId: string): Promise<PersistedLoopState | null>
  clear(loopId: string): Promise<void>
}
```

**Storage Location:** `~/.vesper/workspaces/{id}/sessions/{sessionId}_loop.json`

### Recovery on App Restart

When session loads, check for active loop state:

1. If found, show recovery prompt: "Ralph Loop was interrupted. Would you like to resume?"
2. User can choose to resume or discard
3. Resuming restores:
   - Completed stories list
   - Current story position
   - Elapsed time
   - Configuration settings

**Implementation:**

```typescript
// On app startup
const persistedState = await loopStateStorage.getActiveLoop(sessionId)
if (persistedState) {
  // Show recovery modal
  const shouldRecover = await showRecoveryPrompt(persistedState)
  if (shouldRecover) {
    await sessionManager.recoverLoop(sessionId, persistedState)
  } else {
    await loopStateStorage.clear(persistedState.loopId)
  }
}
```

---

## Security Considerations

### Permission Mode Locking

- Permission mode is locked to 'ralph' during loop execution
- Prevents accidental mode changes that could interrupt the loop
- Automatically unlocks when loop completes, is cancelled, or encounters fatal error

### Auto-commit Safety

- Only creates commits if there are actual changes
- Verifies git repository exists before attempting commits
- Uses standard git commit format for traceability
- Includes "Auto-committed by Ralph Loop" attribution

### Story Isolation

- Each story runs in isolated agent context
- Failures in one story don't affect subsequent stories
- Uncommitted changes remain in working directory for review

### Timeout Protection

- Per-story timeout prevents infinite loops
- Default 10-minute timeout per story
- Configurable based on story complexity

### Error Handling

- All errors are categorized with error codes
- Error details preserved in state
- User can review error messages and recovery options
- Fatal errors halt the loop and preserve state

---

## Design Decisions

### Alternative Approaches Considered

#### 1. CLI Spawning (Rejected)

**Approach:** Spawn `ralph` CLI as child process, capture stdout for progress.

**Pros:**
- Direct reuse of existing Ralph Loop code
- No SDK integration needed

**Cons:**
- Bypasses Vesper's safety model
- No integration with Vesper's permission prompts
- Process management complexity
- Stdout parsing is fragile

**Decision:** Rejected. Safety and integration benefits of SDK approach outweigh reuse benefits.

#### 2. Utility Process Worker (Considered)

**Approach:** Run loop in Electron UtilityProcess for isolation.

**Pros:**
- Won't block main process
- Clean separation

**Cons:**
- Complex IPC for agent operations
- CraftAgent not designed for utility process context
- Overkill for current needs

**Decision:** Defer. Start with main process, migrate if performance issues arise.

#### 3. Background Session (Considered)

**Approach:** Create separate background session for loop, run in parallel.

**Pros:**
- User can continue chatting while loop runs
- Clean session isolation

**Cons:**
- May confuse users with multiple sessions
- Complex state synchronization
- Resource intensive

**Decision:** Defer to future enhancement. Start with foreground loop in current session.

#### 4. LLM-Mediated Invocation (Rejected)

**Approach:** Keep the current message-based flow but enhance Claude's prompt to reliably invoke Ralph Loop.

**Pros:**
- Minimal code changes
- Preserves flexibility (Claude can choose manual execution if appropriate)

**Cons:**
- Still unreliable (LLM behavior isn't deterministic)
- Slower (requires API round-trip)
- Doesn't solve fundamental UX issue (users expect direct action)

**Decision:** Rejected. Direct IPC invocation is more reliable, faster, and clearer for users.

### Key Architectural Decisions

1. **Direct IPC Invocation**: "Accept Plan" button calls IPC directly for immediate, reliable loop start
2. **Permission Mode Locking**: Prevents accidental interruptions during autonomous execution
3. **Three-Section Progress UI**: Completed Stories, Activity Log, and Error Details provide comprehensive visibility
4. **State Persistence**: Enables recovery from app crashes without losing work
5. **Skip Story Feature**: Allows users to bypass stuck stories without canceling entire loop
6. **Confirmation Modal**: Prevents accidental cancellation of long-running loops

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

// Skip current story
await window.electronAPI.loopSkipStory(sessionId);

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

- Loop types: `packages/shared/src/ralph-loop/types.ts`
- Loop runner: `packages/shared/src/ralph-loop/loop-runner.ts`
- PRD parser: `packages/shared/src/ralph-loop/prd-parser.ts`
- Git operations: `packages/shared/src/ralph-loop/git-ops.ts`
- State storage: `packages/shared/src/ralph-loop/state-storage.ts`
- Mode types: `packages/shared/src/agent/mode-types.ts`
- Mode manager: `packages/shared/src/agent/mode-manager.ts`
- Session manager: `apps/electron/src/main/sessions.ts`
- IPC types: `apps/electron/src/shared/types.ts`
- Preload bindings: `apps/electron/src/preload/index.ts`
- Event handlers: `apps/electron/src/renderer/event-processor/handlers/loop.ts`
- UI components: `apps/electron/src/renderer/components/loop/`

### Related Documentation

- User Guide: `docs/ralph-mode-user-guide.md`
- Contributing: `CONTRIBUTING.md`
- Security: `SECURITY.md`

---

*Last Updated: 2026-01-23*
