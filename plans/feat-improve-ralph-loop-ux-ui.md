# feat: Improve Ralph Loop UX/UI in Electron Frontend

## Overview

Enhance the user experience of Ralph Loop in the Vesper Electron app, addressing critical UX issues from plan acceptance through to loop execution and progress tracking. This improvement focuses on making Ralph Loop more reliable, transparent, and user-friendly by fixing the indirect invocation flow, adding real-time feedback, and providing comprehensive progress visibility.

## Problem Statement / Motivation

**Current Pain Points:**

1. **No feedback during execution**: Users cannot see what Ralph is working on in real-time. They only see the final summary after loop completion.

2. **Confusing start/stop controls**: The "Accept Plan" dropdown is unclear, and there's no confirmation before canceling potentially hours of work.

3. **Unclear progress tracking**: While LoopProgressIndicator exists, it lacks:
   - Completed stories list (only shows current story)
   - Inline error details when stories fail
   - Live activity logs
   - Recovery options for errors

**Critical Technical Issue:**

The "Accept Plan" button sends a message asking Claude to execute, but **doesn't directly start Ralph Loop**. This creates an LLM-mediated flow where Claude must interpret the request and invoke the ralph-loop skill, which is:
- Unreliable (Claude might work manually instead of using the loop)
- Slow (requires LLM round-trip)
- Unpredictable (no guarantee the loop starts)

**Impact:**

Users expect clicking "Accept Plan" to immediately start an automated workflow, but the current indirect implementation creates confusion and inconsistency. This undermines trust in the Ralph Loop feature.

## Proposed Solution

Transform the Ralph Loop UX into a **transparent, reliable, and informative** experience with three key improvements:

### 1. Direct Loop Invocation

Replace the LLM-mediated flow with a direct IPC call:
- "Accept Plan" button calls `window.electronAPI.loopStart(sessionId, prdContent, config)`
- Loop starts immediately with visual feedback
- Permission mode switches to Ralph (orange) automatically

### 2. Enhanced Progress Indicator

Expand `LoopProgressIndicator` with three collapsible sections:
- **Completed Stories** (expandable): Shows list with success/failure icons, commit SHAs
- **Activity Log** (expandable): Recent tool executions and agent actions
- **Error Details** (auto-expands on failure): Full error messages with recovery options

### 3. Safety & Recovery

Add critical safety mechanisms:
- Confirmation modal before canceling
- Loop state persistence for crash recovery
- "Skip Story" button for stuck stories
- Lock permission mode during execution

## Technical Approach

### Architecture Changes

**Component Updates:**

1. **AcceptPlanDropdown.tsx** (packages/ui/src/components/chat/AcceptPlanDropdown.tsx)
   - Add `onStartLoop` callback prop
   - Remove message-based execution, use direct IPC
   - Extract PRD content from plan to pass to IPC call

2. **LoopProgressIndicator.tsx** (apps/electron/src/renderer/components/loop/LoopProgressIndicator.tsx)
   - Add expandable sections: CompletedStories, ActivityLog, ErrorDetails
   - Add "Skip Story" button
   - Add confirmation modal for cancel
   - Add estimated time remaining calculation

3. **TurnCard.tsx** (packages/ui/src/components/chat/TurnCard.tsx)
   - Pass PRD content to AcceptPlanDropdown
   - Connect `onStartLoop` callback to App-level IPC handler

**State Management:**

4. **loop.ts event handlers** (apps/electron/src/renderer/event-processor/handlers/loop.ts)
   - Add completed stories list to loopState
   - Add error history array
   - Add activity log buffer (last 20 actions)

5. **sessions.ts** (apps/electron/src/main/sessions.ts)
   - Implement loop state persistence (write to `~/.vesper/workspaces/{id}/sessions/{sessionId}_loop.json`)
   - Add recovery flow on app restart
   - Add skip story IPC handler
   - Lock permission mode when loop starts

**IPC Channels:**

6. Add new channels to **types.ts** (apps/electron/src/shared/types.ts):
   - `LOOP_SKIP_STORY: 'loop:skipStory'`
   - `LOOP_RECOVER: 'loop:recover'`

### Implementation Phases

#### Phase 1: Direct Invocation & Safety (P0 - Critical)

**Tasks:**
- [ ] Add `onStartLoop` prop to AcceptPlanDropdown component
- [ ] Update TurnCard to pass PRD content to AcceptPlanDropdown
- [ ] Add App-level handler for loop start that calls IPC directly
- [ ] Add confirmation modal component (ConfirmCancelLoopModal.tsx)
- [ ] Wire up confirmation modal to Cancel button in LoopProgressIndicator
- [ ] Add permission mode locking in SessionManager.startLoop()
- [ ] Add permission mode unlocking in loop_complete and loop_cancelled handlers
- [ ] Write tests for direct invocation flow

**Success Criteria:**
- Clicking "Accept Plan" immediately starts loop (no message sent to Claude)
- Permission mode locks to Ralph during execution
- Cancel button shows confirmation modal
- Modal shows progress stats: "X of Y stories completed"

**Estimated Effort:** 3-5 days (includes testing)

#### Phase 2: Enhanced Progress Visibility (P1 - High Priority)

**Tasks:**
- [ ] Design CompletedStoriesList component with icons, commit SHAs, and results
- [ ] Design ActivityLogViewer component with virtualized scrolling (react-window)
- [ ] Design ErrorDetailsSection component with expandable error messages
- [ ] Update LoopProgressIndicator to include three expandable sections
- [ ] Update loop event handlers to populate completed stories array
- [ ] Update loop event handlers to buffer activity log (last 20 actions)
- [ ] Update loop event handlers to capture error details with stack traces
- [ ] Add estimated time remaining calculation (average story duration × pending stories)
- [ ] Implement loop state persistence (save to JSON on every progress event)
- [ ] Implement recovery flow on app restart (detect interrupted loop, show prompt)
- [ ] Write tests for persistence and recovery

**Success Criteria:**
- Users can expand "Completed Stories (3/5)" to see list with results
- Users can expand "Activity Log" to see recent tool executions
- Errors auto-expand with full details and "Retry" button
- Loop recovers from app crash/restart with user confirmation
- Estimated time remaining shows accurate prediction

**Estimated Effort:** 5-7 days (includes UI components and persistence logic)

#### Phase 3: Advanced Features (P2 - Medium Priority)

**Tasks:**
- [ ] Add "Skip Story" button to LoopProgressIndicator
- [ ] Implement `skipCurrentStory()` in RalphLoopRunner
- [ ] Add LOOP_SKIP_STORY IPC channel and handler
- [ ] Update PRD with `[~]` checkbox for skipped stories
- [ ] Add file watcher for PRD changes during loop execution
- [ ] Show notification when PRD is edited: "Changes won't affect running loop"
- [ ] Add first-time onboarding tooltip to "Accept Plan" button
- [ ] Add optional onboarding modal explaining Ralph Loop (shown once)
- [ ] Add loop history to session metadata
- [ ] Add "View Loop History" panel in session info

**Success Criteria:**
- Users can skip stuck stories without canceling entire loop
- Users are warned when editing PRD during execution
- First-time users see helpful guidance
- Users can review past loop executions

**Estimated Effort:** 4-6 days

#### Phase 4: Power User Features (P3 - Nice to Have)

**Tasks:**
- [ ] Add dedicated live logs viewer with syntax highlighting (react-logviewer)
- [ ] Add "View Details" button that opens logs in modal/overlay
- [ ] Add loop statistics (avg story duration, success rate, total commits)
- [ ] Add configurable loop behavior settings (halt on error, commit strategy)
- [ ] Add multi-session loop monitoring in sidebar ("2 loops running")
- [ ] Add notifications for background loop completion

**Success Criteria:**
- Users can view detailed logs with ANSI colors
- Users can configure loop behavior per workspace
- Users can monitor multiple sessions with active loops

**Estimated Effort:** 5-8 days

### File-Level Changes

#### New Files

```typescript
// packages/ui/src/components/loop/CompletedStoriesList.tsx
interface CompletedStoriesListProps {
  stories: CompletedStory[];
  onStoryClick?: (storyId: string) => void;
}

export function CompletedStoriesList({ stories, onStoryClick }: CompletedStoriesListProps) {
  // Expandable list with icons, commit SHAs, and results
}
```

```typescript
// packages/ui/src/components/loop/ActivityLogViewer.tsx
interface ActivityLogViewerProps {
  activities: ActivityLogEntry[];
  maxHeight?: number;
}

export function ActivityLogViewer({ activities, maxHeight = 300 }: ActivityLogViewerProps) {
  // Virtualized scrolling log viewer
}
```

```typescript
// packages/ui/src/components/loop/ErrorDetailsSection.tsx
interface ErrorDetailsSectionProps {
  error: LoopError;
  onRetry?: () => void;
  onSkip?: () => void;
}

export function ErrorDetailsSection({ error, onRetry, onSkip }: ErrorDetailsSectionProps) {
  // Error display with recovery options
}
```

```typescript
// apps/electron/src/renderer/components/modals/ConfirmCancelLoopModal.tsx
interface ConfirmCancelLoopModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  progress: { current: number; total: number };
}

export function ConfirmCancelLoopModal({ open, onConfirm, onCancel, progress }: ConfirmCancelLoopModalProps) {
  // Modal with "Continue Loop" and "Cancel Loop" buttons
}
```

#### Modified Files

```typescript
// packages/ui/src/components/chat/AcceptPlanDropdown.tsx:26-215
// Changes:
// - Add onStartLoop?: (prdContent: string) => void prop
// - Replace message-based execution with onStartLoop callback
// - Extract PRD content from plan markdown
```

```typescript
// apps/electron/src/renderer/components/loop/LoopProgressIndicator.tsx:1-219
// Changes:
// - Add three expandable sections: <CompletedStoriesList />, <ActivityLogViewer />, <ErrorDetailsSection />
// - Add "Skip Story" button next to Pause/Cancel
// - Add confirmation modal trigger on Cancel click
// - Add estimated time remaining display
// - Add keyboard shortcuts (Space = pause/resume, Esc = cancel with confirm)
```

```typescript
// packages/ui/src/components/chat/TurnCard.tsx:1127-1144
// Changes:
// - Extract PRD content from planContent
// - Pass onStartLoop callback from props
// - Pass PRD content to AcceptPlanDropdown
```

```typescript
// apps/electron/src/renderer/event-processor/handlers/loop.ts:1-207
// Changes:
// - Add completedStories: CompletedStory[] to loopState
// - Add activityLog: ActivityLogEntry[] to loopState (buffer last 20)
// - Add errorHistory: LoopError[] to loopState
// - Populate arrays on loop_story_complete and loop_progress events
```

```typescript
// apps/electron/src/main/sessions.ts:3400-3500
// Changes:
// - Add persistLoopState(sessionId) method (write JSON to disk)
// - Add recoverLoopState(sessionId) method (read from disk on startup)
// - Add skipCurrentStory(sessionId) method
// - Lock permissionMode to 'ralph' in startLoop()
// - Unlock permissionMode in loop complete/cancelled handlers
// - Call persistLoopState() on every loop_progress event (debounced 1s)
```

```typescript
// apps/electron/src/shared/types.ts:308-419
// Changes:
// - Add LOOP_SKIP_STORY: 'loop:skipStory' to IPC_CHANNELS
// - Add LOOP_RECOVER: 'loop:recover' to IPC_CHANNELS
// - Add completedStories, activityLog, errorHistory to LoopStateUI
// - Add LoopError interface
// - Add CompletedStory interface
// - Add ActivityLogEntry interface
```

```typescript
// apps/electron/src/main/ipc.ts:1854-1895
// Changes:
// - Add handler for LOOP_SKIP_STORY
// - Add handler for LOOP_RECOVER
```

## Alternative Approaches Considered

### Option A: Separate Ralph Loop Panel/Tab

**Description:** Create a dedicated panel or tab in the app just for Ralph Loop monitoring, similar to Docker Desktop's "Builds View."

**Pros:**
- More space for detailed information
- Doesn't clutter the chat interface
- Can show multiple loops across sessions

**Cons:**
- Requires context switching (leaving chat)
- More complex navigation
- Breaks the inline workflow users requested

**Decision:** Rejected. User specifically requested inline progress, and the chat interface is where users accept plans, so keeping progress inline maintains context.

---

### Option B: Keep LLM-Mediated Invocation, Improve Reliability

**Description:** Keep the current message-based flow but enhance Claude's prompt to reliably invoke Ralph Loop when "Accept Plan" is clicked.

**Pros:**
- Minimal code changes
- Preserves flexibility (Claude can choose manual execution if appropriate)

**Cons:**
- Still unreliable (LLM behavior isn't deterministic)
- Slower (requires API round-trip)
- Doesn't solve fundamental UX issue (users expect direct action)

**Decision:** Rejected. Direct IPC invocation is more reliable, faster, and clearer for users.

---

### Option C: Minimal Changes - Just Add Tooltips and Documentation

**Description:** Keep current implementation but add tooltips, help text, and documentation explaining how Ralph Loop works.

**Pros:**
- Very quick to implement
- Low risk

**Cons:**
- Doesn't solve the core UX problems
- Users still experience unreliable loop starts and unclear progress
- Documentation workarounds are not a substitute for good UX

**Decision:** Rejected. The pain points require actual functional improvements, not just documentation.

## Acceptance Criteria

### Functional Requirements

#### Direct Loop Invocation
- [ ] Clicking "Accept Plan" immediately calls `window.electronAPI.loopStart()` without sending a message to Claude
- [ ] Loop starts within 500ms of button click
- [ ] LoopProgressIndicator appears inline below the plan
- [ ] Permission mode switches to Ralph (orange) automatically
- [ ] If loop start fails (invalid PRD), user sees error message explaining the issue

#### Progress Visibility
- [ ] LoopProgressIndicator shows current story (e.g., "Story 3/5: US-003 Implement auth")
- [ ] Progress bar updates visually (0-100%)
- [ ] Iteration counter shows attempts (e.g., "Iter 2/5")
- [ ] Elapsed time increments every second
- [ ] Estimated time remaining displays accurate prediction based on average story duration

#### Completed Stories List
- [ ] "Completed Stories (3/5)" section is collapsible
- [ ] Expanding section shows list of completed stories with:
  - Story ID and title
  - Result icon (✅ success, ❌ failed, ⊘ skipped)
  - Commit SHA (if auto-commit enabled)
  - Duration (how long story took)
- [ ] Clicking a story shows its acceptance criteria and changes made
- [ ] List scrolls independently if more than 5 completed stories

#### Activity Log
- [ ] "Activity Log" section is collapsible
- [ ] Shows last 20 tool executions (Bash commands, file edits, etc.)
- [ ] Auto-scrolls to bottom when new activity arrives
- [ ] User can scroll up to review past activities
- [ ] Activities show timestamp, tool name, and summary

#### Error Handling
- [ ] When a story fails, "Error Details" section auto-expands
- [ ] Error shows story ID, error message, and error code
- [ ] Error section has "Retry Story" and "Skip Story" buttons
- [ ] User can copy error message to clipboard
- [ ] If loop encounters fatal error, user sees recovery options

#### Controls
- [ ] Pause button pauses loop gracefully (current operation finishes)
- [ ] Resume button appears when paused and resumes execution
- [ ] Cancel button shows confirmation modal before canceling
- [ ] Confirmation modal displays: "Cancel Ralph Loop? X of Y stories completed. Uncommitted work will remain in your working directory."
- [ ] Modal has "Continue Loop" and "Cancel Loop" buttons
- [ ] Skip Story button marks current story as skipped and moves to next

#### State Persistence
- [ ] Loop state is saved to `~/.vesper/workspaces/{id}/sessions/{sessionId}_loop.json` on every progress event (debounced 1s)
- [ ] If app is closed/crashes during loop, state is persisted
- [ ] On app restart, user sees prompt: "Ralph Loop was interrupted. Would you like to resume?"
- [ ] User can choose "Resume" or "Discard"
- [ ] Resuming restores completed stories, current story, and elapsed time

#### Permission Mode Locking
- [ ] Permission mode is locked to 'ralph' while loop is running
- [ ] Attempting to change mode shows tooltip: "Permission mode is locked during Ralph Loop"
- [ ] Mode automatically reverts to previous mode when loop completes/cancels

### Non-Functional Requirements

#### Performance
- [ ] LoopProgressIndicator updates smoothly without causing UI lag
- [ ] Activity log uses virtualized scrolling (react-window) for 100+ items
- [ ] Loop state persistence is debounced to avoid excessive disk writes
- [ ] Expanding/collapsing sections has smooth animation (<200ms)

#### Accessibility
- [ ] All interactive elements have keyboard shortcuts:
  - Space: Pause/Resume
  - Esc: Cancel (with confirmation)
  - S: Skip Story
- [ ] Status icons have aria-labels for screen readers
- [ ] Progress bar has aria-valuenow and aria-valuemax
- [ ] Color is not the only indicator of status (icons + text)

#### Reliability
- [ ] Loop recovers from app crash/restart without data loss
- [ ] Completed work is saved (via git auto-commit) even if loop is canceled
- [ ] IPC channel errors are handled gracefully with user-friendly messages
- [ ] Loop state is consistent across renderer and main process

### Quality Gates

#### Test Coverage
- [ ] Unit tests for CompletedStoriesList component (story display, click handlers)
- [ ] Unit tests for ActivityLogViewer (virtualization, scrolling)
- [ ] Unit tests for ErrorDetailsSection (retry/skip actions)
- [ ] Unit tests for ConfirmCancelLoopModal (confirm/cancel actions)
- [ ] Integration tests for direct loop invocation flow (AcceptPlanDropdown → IPC → loop start)
- [ ] Integration tests for loop state persistence and recovery
- [ ] E2E tests for complete loop lifecycle (start → progress → pause → resume → complete)
- [ ] E2E tests for error scenarios (story failure, skip, cancel with confirmation)

#### Code Review Approval
- [ ] Changes reviewed by at least one team member
- [ ] UI/UX reviewed for consistency with Vesper design system
- [ ] Performance tested with 20+ story PRD
- [ ] Accessibility tested with keyboard-only navigation

## Success Metrics

**User Satisfaction:**
- Users report feeling confident about loop progress (qualitative feedback)
- Users successfully recover from app crashes without losing work
- Users can diagnose story failures without external tools

**Reliability:**
- 100% loop start success rate when "Accept Plan" is clicked (no LLM interpretation failures)
- <1% of loops fail due to state inconsistency or IPC errors

**Performance:**
- Loop starts in <500ms from button click
- Progress updates render in <50ms
- App restart recovery completes in <2s

**Engagement:**
- Increased usage of Ralph Loop feature (measured by loop_started events)
- Decreased cancellation rate (fewer accidental cancels due to confirmation)

## Dependencies & Prerequisites

**Code Dependencies:**
- Existing LoopProgressIndicator component (already implemented)
- Existing ralph-loop skill and RalphLoopRunner backend
- Existing IPC channels for LOOP_PAUSE, LOOP_RESUME, LOOP_CANCEL
- Existing event-driven architecture (loop_started, loop_progress, etc.)

**External Libraries:**
- `react-window` for virtualized activity log scrolling (already used in project)
- `framer-motion` for smooth animations (already used in project)
- `tailwindcss` for styling (already used in project)

**Technical Prerequisites:**
- Must preserve backward compatibility with existing loop state in sessions
- Must not break existing plan acceptance flow for non-Ralph execution paths
- Must handle migration from old loop state format (if persistence already exists)

**Team Prerequisites:**
- UI/UX review of proposed designs for CompletedStoriesList, ActivityLogViewer, ErrorDetailsSection
- Product approval of direct invocation vs. LLM-mediated flow
- Confirmation of desired behavior: continue on error vs. halt on error (affects skip functionality)

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| **Direct invocation breaks flexibility** (e.g., Claude wants to manually execute) | Low | Medium | Keep both flows: default to direct invocation, but allow Claude to use ralph-loop skill manually if needed |
| **Loop state persistence causes file system errors** (permissions, disk full) | Medium | High | Add try-catch with fallback to in-memory state; show warning if persistence fails |
| **Confirmation modal is annoying for power users** | Medium | Low | Add Shift+Click bypass; add "Don't ask again" checkbox with workspace-level setting |
| **Performance degradation with 100+ stories** | Low | Medium | Use virtualized scrolling for all lists; debounce state updates; test with large PRDs |
| **Permission mode locking breaks edge cases** (e.g., user needs to run external command) | Low | Medium | Add "Unlock Mode" button in modal with warning: "This may cause loop failures" |
| **State persistence migration fails** (old format incompatible) | Low | High | Add version field to persisted state; implement migration logic; fall back to fresh start if migration fails |
| **Users don't discover expandable sections** | Medium | Medium | Add visual cues (down arrow icon, badge count); auto-expand on first use; add onboarding tooltip |

## Future Considerations

**Extensibility:**
- Design state persistence format to support future fields (use versioned JSON schema)
- Design IPC channels to support future loop types beyond PRD-based workflows
- Component props should accept optional callbacks for future integrations (e.g., onStoryClick opens diff view)

**Scalability:**
- Activity log buffer is limited to 20 items; consider pagination or log file export for long loops
- Completed stories list could grow large; consider virtualization if >50 stories

**Multi-Platform:**
- Current design is Electron-specific; consider web compatibility for future Claude Code web version
- Persistence path is platform-dependent; abstract file system operations for cross-platform support

**AI-Assisted Improvements:**
- Loop could learn optimal iteration limits per story type
- Estimated time remaining could use ML predictions based on story complexity
- Error suggestions could be generated by LLM (e.g., "This looks like a dependency issue. Try running npm install.")

## Documentation Requirements

**User-Facing Documentation:**
- [ ] Update README.md with Ralph Loop UX improvements
- [ ] Add "Using Ralph Loop" guide to docs/ with screenshots
- [ ] Add FAQ section: "What happens if I close the app during a loop?"
- [ ] Add keyboard shortcuts reference card

**Developer Documentation:**
- [ ] Update CONTRIBUTING.md with loop state persistence architecture
- [ ] Document IPC channel contracts (parameters, return types, error codes)
- [ ] Add JSDoc comments to new components (CompletedStoriesList, ActivityLogViewer, etc.)
- [ ] Document loop state JSON schema with version field

**Migration Guide:**
- [ ] If persistence format changes, document migration steps for users
- [ ] Document backward compatibility guarantees

## References & Research

### Internal References

**Architecture & Components:**
- Execute Dropdown Implementation: `packages/ui/src/components/chat/AcceptPlanDropdown.tsx:1-216`
- Loop Progress UI: `apps/electron/src/renderer/components/loop/LoopProgressIndicator.tsx:1-219`
- Loop Summary UI: `apps/electron/src/renderer/components/loop/LoopSummaryCard.tsx:1-189`
- Chat Display Integration: `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx:590-604,728-745`
- Turn Card Plan Detection: `packages/ui/src/components/chat/TurnCard.tsx:1127-1144`
- Input Event Handlers: `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx:315-447`

**Backend & State Management:**
- Session Manager: `apps/electron/src/main/sessions.ts:3400-3500`
- IPC Handlers: `apps/electron/src/main/ipc.ts:1854-1895`
- Loop Event Handlers: `apps/electron/src/renderer/event-processor/handlers/loop.ts:1-207`
- Type Definitions: `apps/electron/src/shared/types.ts:308-419`
- App IPC Bindings: `apps/electron/src/renderer/App.tsx:1102-1112`
- Context Provider: `apps/electron/src/renderer/context/AppShellContext.tsx:117-123`

**Loop Backend:**
- Loop Runner: `packages/shared/src/ralph-loop/loop-runner.ts`
- PRD Parser: `packages/shared/src/ralph-loop/prd-parser.ts`
- Git Operations: `packages/shared/src/ralph-loop/git-ops.ts`

### External References

**Progress UI Best Practices:**
- [Progress Bar UX Guide](https://usersnap.com/blog/progress-indicators/)
- [Progress Trackers Guide](https://userguiding.com/blog/progress-trackers-and-indicators)
- [Page Flows Progress Bar UX](https://pageflows.com/resources/progress-bar-ux/)
- [VS Code Progress API](https://code.visualstudio.com/api/ux-guidelines/status-bar)
- [GitHub Actions UI Improvements](https://github.blog/changelog/2024-04-30-github-actions-ui-improvements/)

**Live Logging & Streaming:**
- [react-logviewer](https://github.com/melloware/react-logviewer) - Handles 100MB+ log files without browser crashes
- [Virtualize Large Lists](https://web.dev/articles/virtualize-long-lists-react-window)
- [Real-time Log Streaming with SSE](https://dev.to/manojspace/real-time-log-streaming-with-nodejs-and-react-using-server-sent-events-sse-48pk)

**Electron IPC & State Management:**
- [Electron IPC Documentation](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
- [electron-progressbar](https://github.com/AndersonMamede/electron-progressbar)
- [State Management in 2026](https://www.nucamp.co/blog/state-management-in-2026-redux-context-api-and-modern-patterns)

**React Performance & Real-Time Updates:**
- [WebSockets and React.js Integration](https://medium.com/@SanchezAllanManuel/optimizing-real-time-performance-websockets-and-react-js-integration-part-i-e563664647d3)
- [React Memory Leaks Prevention](https://www.c-sharpcorner.com/article/preventing-memory-leaks-in-react-with-useeffect-hooks/)
- [React Concurrent Features](https://certificates.dev/blog/react-concurrent-features-an-overview)
- [Framer Motion Performance Tips](https://tillitsdone.com/blogs/framer-motion-performance-tips/)

**Error Handling & Recovery:**
- [UI Error Handling Best Practices](https://www.devx.com/web-ui/9-best-practices-and-examples-for-effective-error-handling-in-ui-design/)
- [Error Messages UX](https://usersnap.com/blog/error-messages-best-practices/)
- [Prefect Pause/Resume](https://annageller.medium.com/prefect-2-7-is-out-with-pause-resume-and-robust-cancellation-functionality-359f91b0f24c)

### Related Work

**Previous PRs:**
- (Search for recent commits related to Ralph Loop, LoopProgressIndicator, AcceptPlanDropdown)

**Related Issues:**
- (Link to any existing GitHub issues about Ralph Loop UX problems)

**Design Decisions:**
- Permission modes architecture (safe, allow-all, ralph)
- Event-driven session management (SessionEvent types)
- Jotai atoms for session isolation

---

## Appendix: SpecFlow Scenarios Summary

**Happy Path:**
- User accepts plan → Loop starts → Progress visible → Completes successfully

**Alternative Paths:**
- User pauses → reviews → resumes
- User cancels with confirmation
- User switches between sessions with active loops

**Error Paths:**
- Story fails → Error details shown → User retries or skips
- Network error → Loop halts → User sees recovery options
- Invalid PRD format → Validation error → User fixes and retries
- Claude doesn't use Ralph Loop → (Fixed by direct invocation)

**Edge Cases:**
- App crash during loop → State persisted → Recovery prompt on restart
- Multiple sessions with active loops → Independent state per session
- User edits PRD during execution → Warning shown, changes don't apply
- Duplicate story IDs → Validation error before loop starts

See full SpecFlow analysis in research documentation for detailed Given/When/Then scenarios.
