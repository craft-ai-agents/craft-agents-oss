# feat: Integrate Ralph Loop Autonomous Coding System

## Overview

Bring the Ralph Loop autonomous coding system into Vesper App, enabling users to execute iterative, goal-driven coding loops directly from the chat interface. Ralph Loop processes a PRD (Product Requirements Document) with checkbox-formatted user stories, working through each story autonomously until completion or iteration limits are reached.

**Key Integration Points:**
- Chat-based trigger with real-time progress indicators
- Integration with Vesper's permission system (safe/ask/allow-all modes)
- Main process execution using Claude Agent SDK (not CLI spawning)
- State persistence for pause/resume and crash recovery

---

## Problem Statement / Motivation

Currently, users must manually guide Claude through multi-step coding tasks one message at a time. For larger features with multiple user stories, this becomes tedious and breaks flow. Ralph Loop solves this by:

1. **Autonomy**: Process multiple stories without constant user intervention
2. **Structured Progress**: Track completion via checkbox-based PRDs
3. **Resilience**: Continue working even when individual stories fail
4. **Accountability**: Auto-commit changes with proper attribution

The integration brings this capability into Vesper's polished UI while respecting its safety-first permission architecture.

---

## Proposed Solution

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Vesper Main Process                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐    ┌────────────────────────────────────┐ │
│  │  SessionManager  │◄──►│         RalphLoopRunner            │ │
│  │  (existing)      │    │  - Story selection & parsing       │ │
│  └────────┬─────────┘    │  - Iteration control               │ │
│           │              │  - Progress event emission         │ │
│           │              │  - Git commit verification         │ │
│  ┌────────▼─────────┐    └────────────────┬───────────────────┘ │
│  │   CraftAgent     │◄───────────────────►│                     │
│  │   (per story)    │    Reuses existing agent infrastructure   │
│  └──────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ IPC Events (loop_progress, loop_complete, etc.)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Renderer Process                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Event Processor (extended for loop events)              │   │
│  │  processEvent(state, LoopProgressEvent) => new state     │   │
│  └────────────────────────┬─────────────────────────────────┘   │
│                           │                                      │
│  ┌────────────────────────▼─────────────────────────────────┐   │
│  │  LoopProgressIndicator (chat integration)                │   │
│  │  - Story progress (3/5)                                   │   │
│  │  - Current iteration (2/5)                                │   │
│  │  - Elapsed time                                           │   │
│  │  - Pause/Cancel controls                                  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent Integration | Use Claude Agent SDK directly | Avoids CLI spawning overhead, integrates with existing permission system |
| Process Location | Main process | Simpler IPC, direct access to SessionManager and git operations |
| State Management | Extend session state with loop metadata | Consistent with Vesper's Jotai atom architecture |
| PRD Format | Markdown with `### [ ] US-XXX:` syntax | Compatible with original Ralph Loop format |
| Permission Handling | Respect session's current mode | No `--dangerously-skip-permissions`, maintains safety |

---

## Technical Approach

### Phase 1: Core Loop Infrastructure

#### 1.1 PRD Parser Module

**File:** `packages/shared/src/ralph-loop/prd-parser.ts`

```typescript
export interface Story {
  id: string;           // e.g., "US-001"
  title: string;        // Story title from checkbox line
  lineNumber: number;   // For marking complete
  content: string;      // Full story block content
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface PRD {
  source: string;       // Original markdown
  stories: Story[];
  metadata: {
    totalStories: number;
    completedStories: number;
  };
}

export function parsePRD(markdown: string): PRD;
export function markStoryComplete(prd: PRD, storyId: string): PRD;
export function getNextPendingStory(prd: PRD): Story | null;
```

**Parsing Rules:**
- Stories start with `### [ ] US-XXX:` or `### [x] US-XXX:` (checkbox format)
- Story content extends until next story header or end of file
- Support nested sub-tasks with `- [ ]` within story blocks

#### 1.2 Loop Runner Service

**File:** `packages/shared/src/ralph-loop/loop-runner.ts`

```typescript
export interface LoopConfig {
  maxIterationsPerStory: number;  // Default: 5
  timeoutPerStoryMs: number;      // Default: 600000 (10 min)
  autoCommit: boolean;            // Default: true
  commitMessagePrefix: string;    // Default: "feat"
}

export interface LoopState {
  id: string;
  sessionId: string;
  prd: PRD;
  config: LoopConfig;
  currentStory: Story | null;
  currentIteration: number;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled';
  startTime: number;
  storiesCompleted: number;
  errors: LoopError[];
}

export class RalphLoopRunner extends EventEmitter {
  constructor(
    private session: Session,
    private agent: CraftAgent,
    private gitOps: GitOperations
  ) {}

  async start(prd: PRD, config: LoopConfig): Promise<LoopResult>;
  pause(): void;
  resume(): void;
  cancel(): void;

  // Events emitted
  on(event: 'progress', listener: (state: LoopState) => void): this;
  on(event: 'story_start', listener: (story: Story) => void): this;
  on(event: 'story_complete', listener: (story: Story, result: StoryResult) => void): this;
  on(event: 'iteration', listener: (iteration: number, story: Story) => void): this;
  on(event: 'error', listener: (error: LoopError) => void): this;
  on(event: 'complete', listener: (result: LoopResult) => void): this;
}
```

#### 1.3 Git Operations Module

**File:** `packages/shared/src/ralph-loop/git-ops.ts`

```typescript
export interface GitOperations {
  getCurrentHead(): Promise<string>;
  hasUncommittedChanges(): Promise<boolean>;
  getChangesSummary(): Promise<ChangeSummary>;
  createAutoCommit(storyId: string, message: string): Promise<string>;
  verifyCommitCreated(beforeHead: string): Promise<boolean>;
}

export function createGitOperations(workingDirectory: string): GitOperations;
```

### Phase 2: IPC and Event Integration

#### 2.1 New IPC Channels

**File:** `apps/electron/src/preload/index.ts` (additions)

```typescript
// Add to IPC_CHANNELS enum
LOOP_START = 'LOOP_START',
LOOP_PAUSE = 'LOOP_PAUSE',
LOOP_RESUME = 'LOOP_RESUME',
LOOP_CANCEL = 'LOOP_CANCEL',
LOOP_EVENT = 'LOOP_EVENT',

// Add to electronAPI
loopStart: (sessionId: string, prdContent: string, config?: Partial<LoopConfig>) =>
  ipcRenderer.invoke('LOOP_START', sessionId, prdContent, config),
loopPause: (sessionId: string) => ipcRenderer.invoke('LOOP_PAUSE', sessionId),
loopResume: (sessionId: string) => ipcRenderer.invoke('LOOP_RESUME', sessionId),
loopCancel: (sessionId: string) => ipcRenderer.invoke('LOOP_CANCEL', sessionId),
onLoopEvent: (callback: (event: LoopEvent) => void) =>
  ipcRenderer.on('LOOP_EVENT', (_, event) => callback(event)),
```

#### 2.2 Event Types

**File:** `apps/electron/src/renderer/event-processor/types.ts` (additions)

```typescript
export interface LoopProgressEvent {
  type: 'loop_progress';
  sessionId: string;
  loopId: string;
  currentStory: { id: string; title: string } | null;
  storyIndex: number;
  totalStories: number;
  currentIteration: number;
  maxIterations: number;
  elapsedMs: number;
  status: 'running' | 'paused';
}

export interface LoopStoryCompleteEvent {
  type: 'loop_story_complete';
  sessionId: string;
  loopId: string;
  story: { id: string; title: string };
  result: 'success' | 'failed' | 'skipped';
  commitSha?: string;
  error?: string;
}

export interface LoopCompleteEvent {
  type: 'loop_complete';
  sessionId: string;
  loopId: string;
  summary: {
    totalStories: number;
    completedStories: number;
    failedStories: number;
    skippedStories: number;
    totalTime: number;
    commits: string[];
  };
}

// Add to AgentEvent union
export type AgentEvent =
  | ... // existing events
  | LoopProgressEvent
  | LoopStoryCompleteEvent
  | LoopCompleteEvent;
```

#### 2.3 Event Handlers

**File:** `apps/electron/src/renderer/event-processor/handlers/loop.ts`

```typescript
export function handleLoopProgress(
  state: SessionState,
  event: LoopProgressEvent
): SessionState {
  return {
    ...state,
    loopState: {
      isActive: true,
      currentStory: event.currentStory,
      progress: {
        current: event.storyIndex,
        total: event.totalStories,
        iteration: event.currentIteration,
        maxIterations: event.maxIterations,
      },
      elapsedMs: event.elapsedMs,
      status: event.status,
    }
  };
}

export function handleLoopComplete(
  state: SessionState,
  event: LoopCompleteEvent
): SessionState {
  return {
    ...state,
    loopState: {
      isActive: false,
      summary: event.summary,
    }
  };
}
```

### Phase 3: UI Components

#### 3.1 Loop Progress Indicator

**File:** `apps/electron/src/renderer/components/chat/LoopProgressIndicator.tsx`

```tsx
interface LoopProgressIndicatorProps {
  loopState: LoopState;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

export function LoopProgressIndicator({
  loopState,
  onPause,
  onResume,
  onCancel
}: LoopProgressIndicatorProps) {
  // Renders inline in chat area showing:
  // - Progress bar (stories completed)
  // - Current story title
  // - Iteration counter
  // - Elapsed time
  // - Pause/Resume and Cancel buttons
}
```

**Visual Design:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Ralph Loop                                              ⏸  ✕   │
├─────────────────────────────────────────────────────────────────┤
│ [████████░░░░░░░░░░░░] 3 of 5 stories                          │
│                                                                 │
│ Current: US-003 - Add user authentication                      │
│ Iteration: 2 of 5 · Elapsed: 4m 32s                            │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.2 Loop Trigger Integration

**Option A: Slash Command**

Add `/loop` command that opens a modal to:
1. Paste or upload PRD content
2. Configure iteration limits
3. Confirm and start

**Option B: Message Detection**

Detect when user sends a message containing PRD format and offer: "This looks like a PRD. Run as Ralph Loop?"

**Recommended:** Implement both - slash command for intentional use, detection for convenience.

#### 3.3 Loop Summary Card

**File:** `apps/electron/src/renderer/components/chat/LoopSummaryCard.tsx`

Renders after loop completion showing:
- Stories completed/failed/skipped
- Total execution time
- List of commits created (collapsible)
- Files modified summary
- "Resume remaining" button if partially complete

### Phase 4: State Persistence

#### 4.1 Loop State Storage

**File:** `packages/shared/src/ralph-loop/state-storage.ts`

```typescript
interface PersistedLoopState {
  loopId: string;
  sessionId: string;
  prd: PRD;
  config: LoopConfig;
  currentStoryIndex: number;
  currentIteration: number;
  completedStories: string[];
  failedStories: string[];
  startTime: number;
  lastUpdated: number;
}

export class LoopStateStorage {
  constructor(private workspacePath: string) {}

  save(state: PersistedLoopState): Promise<void>;
  load(loopId: string): Promise<PersistedLoopState | null>;
  getActiveLoop(sessionId: string): Promise<PersistedLoopState | null>;
  clear(loopId: string): Promise<void>;
}
```

**Storage Location:** `~/.craft-agent/workspaces/{id}/loops/{loopId}.json`

#### 4.2 Recovery on App Restart

When session loads, check for active loop state:
1. If found, show recovery prompt: "A loop was interrupted. Resume from story 4/5?"
2. User can resume, discard, or review partial progress

---

## Alternative Approaches Considered

### 1. CLI Spawning (Rejected)

**Approach:** Spawn `ralph` CLI as child process, capture stdout for progress.

**Pros:**
- Direct reuse of existing Ralph Loop code
- No SDK integration needed

**Cons:**
- `--dangerously-skip-permissions` bypasses Vesper's safety model
- No integration with Vesper's permission prompts
- Process management complexity
- Stdout parsing is fragile

**Decision:** Rejected. Safety and integration benefits of SDK approach outweigh reuse benefits.

### 2. Utility Process Worker (Considered)

**Approach:** Run loop in Electron UtilityProcess for isolation.

**Pros:**
- Won't block main process
- Clean separation

**Cons:**
- Complex IPC for agent operations
- CraftAgent not designed for utility process context
- Overkill for current needs

**Decision:** Defer. Start with main process, migrate if performance issues arise.

### 3. Background Session (Considered)

**Approach:** Create separate background session for loop, run in parallel.

**Pros:**
- User can continue chatting while loop runs
- Clean session isolation

**Cons:**
- May confuse users with multiple sessions
- Complex state synchronization
- Resource intensive

**Decision:** Defer to Phase 2. Start with foreground loop in current session.

---

## Acceptance Criteria

### Functional Requirements

- [ ] User can trigger Ralph Loop via `/loop` slash command
- [ ] User can paste or upload PRD content in markdown format
- [ ] System parses PRD and extracts checkbox-formatted stories
- [ ] Loop processes stories sequentially, calling CraftAgent for each
- [ ] Progress shows: current story, iteration count, elapsed time
- [ ] User can pause loop between stories
- [ ] User can resume paused loop
- [ ] User can cancel loop at any time
- [ ] Cancelled loop shows partial progress summary
- [ ] Completed stories are marked with `[x]` in PRD
- [ ] Auto-commit creates commits when agent doesn't
- [ ] Commit messages follow format: `feat(US-XXX): story title`
- [ ] Loop respects session's permission mode (safe/ask/allow-all)
- [ ] Permission requests pause loop, show UI, resume on approval
- [ ] Loop state persists across app restart
- [ ] User can resume interrupted loops on restart

### Non-Functional Requirements

- [ ] Progress updates render within 100ms of state change
- [ ] Loop start time < 500ms after user confirms
- [ ] Memory usage < 50MB additional during loop execution
- [ ] No UI freezes during agent execution (main thread responsive)

### Quality Gates

- [ ] Unit tests for PRD parser (edge cases, malformed input)
- [ ] Unit tests for loop state machine (all transitions)
- [ ] Integration tests for IPC event flow
- [ ] E2E test: complete loop with 3 stories
- [ ] E2E test: cancel mid-loop and verify partial state
- [ ] E2E test: app restart recovery

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Loop completion rate | > 80% | Stories completed / stories started |
| User interruption rate | < 20% | Loops cancelled / loops started |
| Time saved per story | > 2 min | Manual vs loop execution time |
| Permission prompt response | < 5 sec avg | Time from prompt to user action |

---

## Dependencies & Prerequisites

### Technical Dependencies

- [ ] CraftAgent supports multiple sequential runs in same session
- [ ] Git operations available in session working directory
- [ ] Session state can be extended with loop metadata

### External Dependencies

- [ ] None (uses existing Claude Agent SDK)

### Team Dependencies

- [ ] Design review for progress UI components
- [ ] Security review for permission handling approach

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Agent gets stuck on complex story | Medium | Medium | Timeout per story, auto-skip with retry option |
| Permission prompts interrupt flow | Medium | Low | Clear UI showing loop is waiting, easy resume |
| Git conflicts from auto-commit | Low | Medium | Detect conflicts, pause for manual resolution |
| Memory leak from long-running loops | Low | High | Monitor memory, implement cleanup between stories |
| User confusion about loop status | Medium | Medium | Clear progress UI, notifications, session list indicator |

---

## Implementation Phases

### Phase 1: Foundation (Core Loop Logic)
- PRD parser module
- Loop runner service (without UI)
- Git operations module
- Basic IPC channels
- Unit tests

### Phase 2: UI Integration
- Loop progress indicator component
- Slash command trigger
- Event processor handlers
- Loop summary card
- Integration tests

### Phase 3: Polish & Persistence
- State persistence and recovery
- Pause/resume functionality
- Error recovery improvements
- E2E tests
- Performance optimization

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `packages/shared/src/ralph-loop/prd-parser.ts` | Parse PRD markdown into stories |
| `packages/shared/src/ralph-loop/loop-runner.ts` | Core loop execution logic |
| `packages/shared/src/ralph-loop/git-ops.ts` | Git operations (commit, verify) |
| `packages/shared/src/ralph-loop/state-storage.ts` | Persist loop state |
| `packages/shared/src/ralph-loop/types.ts` | Shared type definitions |
| `packages/shared/src/ralph-loop/index.ts` | Module exports |
| `apps/electron/src/renderer/components/chat/LoopProgressIndicator.tsx` | Progress UI |
| `apps/electron/src/renderer/components/chat/LoopSummaryCard.tsx` | Completion summary |
| `apps/electron/src/renderer/components/chat/LoopTriggerModal.tsx` | Start loop modal |
| `apps/electron/src/renderer/event-processor/handlers/loop.ts` | Event handlers |

### Modified Files

| File | Changes |
|------|---------|
| `apps/electron/src/preload/index.ts` | Add loop IPC channels |
| `apps/electron/src/main/ipc.ts` | Add loop handlers |
| `apps/electron/src/main/sessions.ts` | Integrate RalphLoopRunner |
| `apps/electron/src/renderer/event-processor/types.ts` | Add loop event types |
| `apps/electron/src/renderer/event-processor/processor.ts` | Route loop events |
| `apps/electron/src/renderer/atoms/sessions.ts` | Add loop state to session atom |
| `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` | Render loop progress |

---

## References

### Internal References

- Session management: `/Users/tinnguyen/vesper/apps/electron/src/main/sessions.ts`
- Event processor: `/Users/tinnguyen/vesper/apps/electron/src/renderer/event-processor/processor.ts`
- CraftAgent: `/Users/tinnguyen/vesper/packages/shared/src/agent/craft-agent.ts`
- Permission modes: `/Users/tinnguyen/vesper/packages/shared/src/agent/mode-manager.ts`
- IPC patterns: `/Users/tinnguyen/vesper/apps/electron/src/preload/index.ts`

### External References

- Original Ralph Loop: `/Users/tinnguyen/ralph-loop/lib/loop.sh`
- Ralph Loop PRD format: `/Users/tinnguyen/ralph-loop/README.md`
- Claude Agent SDK: `@anthropic-ai/claude-agent-sdk`
- Electron IPC: https://www.electronjs.org/docs/latest/tutorial/ipc

### Related Patterns

- Background tasks: `/Users/tinnguyen/vesper/apps/electron/src/renderer/atoms/sessions.ts` (backgroundTasksAtomFamily)
- Event streaming: `/Users/tinnguyen/vesper/apps/electron/src/main/sessions.ts` (onSessionEvent)
- AbortController usage: `/Users/tinnguyen/vesper/packages/shared/src/agent/craft-agent.ts` (AbortReason enum)
