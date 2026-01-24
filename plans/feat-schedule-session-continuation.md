# Feature: Schedule Session Continuation

> **Schedule triggers send follow-up replies into the original schedule chat session, rather than creating a new chat session every time.**

## Overview

Currently, each scheduled task execution creates a brand new session named `Schedule: {name}`. This means:
- No conversation history between scheduled runs
- Agent starts fresh each time (no learned context)
- Users can't easily track the evolution of a scheduled task's outputs

This feature modifies the scheduler to **continue in the same session** for all executions of a schedule, preserving full conversation context across runs.

## Problem Statement

### Current Behavior
```
Schedule "Daily Report" triggers at 9am
    ↓
Creates new session "Schedule: Daily Report" (260123-swift-river)
    ↓
Agent executes prompt with no prior context
    ↓
Next day at 9am: Creates ANOTHER new session (260124-bright-mesa)
    ↓
Result: 30 separate sessions after a month, no continuity
```

### Desired Behavior
```
Schedule "Daily Report" triggers at 9am (first run)
    ↓
Creates session "Schedule: Daily Report" (260123-swift-river)
    ↓
Session ID stored in lastRunSessionId (already exists)
    ↓
Next day at 9am: Continues in SAME session (260123-swift-river)
    ↓
Agent has full conversation history from previous runs
    ↓
Result: Single session with complete execution history
```

## Technical Approach

### Architecture

The implementation leverages existing infrastructure with **minimal changes**:

1. **Reuse `lastRunSessionId`**: Already tracks the session from the last run - just reuse it instead of creating new
2. **Try-catch for fallback**: If session was deleted, catch the error and create a new one
3. **No new types or methods**: All infrastructure already exists

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│    Scheduler    │────▶│  SessionManager  │────▶│   CraftAgent    │
│   (scheduler.ts)│     │   (sessions.ts)  │     │ (craft-agent.ts)│
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │                        │
        │ Use lastRunSessionId   │ Load messages          │ Resume SDK
        │ Catch error → fallback │ Apply permission mode  │ conversation
        ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Session (session.jsonl)                       │
│  - All previous messages preserved                               │
│  - SDK session ID for resumption                                 │
│  - Permission mode, enabled sources, working directory           │
└─────────────────────────────────────────────────────────────────┘
```

### Data Model Changes

**None required.** The `Schedule` interface already has what we need:

```typescript
export interface Schedule {
  // ... existing fields ...
  lastRunSessionId: string | null  // ← Already exists! Reuse this.
}
```

### Execution Flow Changes

**File**: `apps/electron/src/main/scheduler.ts`

The change is ~15 lines in the `execute()` method:

```typescript
private async execute(schedule: Schedule): Promise<void> {
  // ... existing preamble (logging, broadcastEvent 'started') ...

  try {
    if (!this.sessionManager) {
      throw new Error('SessionManager not initialized')
    }

    let sessionId: string | null = schedule.lastRunSessionId

    // 1. Try to reuse the last session
    if (sessionId) {
      try {
        await this.sessionManager.sendMessage(sessionId, schedule.prompt)
      } catch (e: any) {
        // Session was deleted - fall back to creating new one
        if (e.message?.includes('not found')) {
          mainLog.info(`Session ${sessionId} not found for schedule ${schedule.name}, creating new session`)
          sessionId = null
        } else {
          throw e // Re-throw other errors
        }
      }
    }

    // 2. Create new session if needed (first run or session was deleted)
    if (!sessionId) {
      const session = await this.sessionManager.createSession(this.workspaceId)
      sessionId = session.id
      await this.sessionManager.renameSession(sessionId, `Schedule: ${schedule.name}`)
      await this.sessionManager.sendMessage(sessionId, schedule.prompt)
    }

    // 3. Record execution (existing code already saves sessionId to lastRunSessionId)
    await this.recordExecution(schedule, sessionId, 'success')

    // ... existing success handling (notification, broadcast 'completed') ...

  } catch (error) {
    // ... existing error handling ...
  }
}
```

## Acceptance Criteria

### Functional Requirements

- [x] First schedule execution creates a new session (existing behavior)
- [x] Subsequent executions reuse `lastRunSessionId` instead of creating new session
- [x] If session was deleted, catch error and create new session gracefully
- [x] Agent has access to full conversation history from prior executions
- [x] SDK session resumption works correctly (conversation context preserved)
- [x] Execution history continues to track individual runs with timestamps

### Edge Cases Handled

- [x] **Session deleted**: Catch "not found" error, create new session, continue
- [x] **Session currently processing**: Message queues (existing behavior via `sendMessage`)
- [x] **One-time schedules**: Create session, run once, session persists for review
- [x] **App restart**: `lastRunSessionId` already persisted in `schedules.json`
- [x] **First run**: No `lastRunSessionId` → create new session (existing behavior)

### Non-Functional Requirements

- [x] No breaking changes to existing schedule functionality
- [x] No new types or methods required
- [x] Minimal code change (~15 lines in `execute()`)

## Implementation Plan

### Single-Phase Implementation

**File**: `apps/electron/src/main/scheduler.ts`

Modify the `execute()` method to:
1. Check if `lastRunSessionId` exists
2. If yes, try to send message to that session
3. If send fails with "not found", fall back to creating new session
4. If no `lastRunSessionId`, create new session (existing behavior)

**That's it.** No new types, no new methods, no migration needed.

### Test Cases

| Test | Steps | Expected Result |
|------|-------|-----------------|
| First execution | Create schedule, trigger | New session created, `lastRunSessionId` set |
| Second execution | Trigger same schedule | Same session used, message appended |
| Session deleted | Delete session, trigger | New session created automatically |
| App restart | Restart app, trigger | Continues in same session |
| Conversation context | Ask "what did I ask before?" in 2nd run | Agent recalls prior execution |

### Manual Testing Checklist

- [ ] Create recurring schedule, run twice, verify single session
- [ ] Delete the session, run again, verify new session created
- [ ] Check SDK conversation resumption works (verify in debug logs)
- [ ] Verify existing schedules work without changes

## Considerations

### Context Window Growth

**Risk**: Long-running schedules accumulate messages, potentially hitting context limits.

**Mitigation**: SDK Auto-Compaction handles this automatically. The Claude Agent SDK compacts conversation history when approaching context limits. No special handling needed for MVP.

**Future enhancement**: Add execution counter to rotate session after N runs if users report issues.

### Session Being Processed

**Scenario**: User is actively chatting in session when schedule triggers.

**Behavior**: `sendMessage()` will queue the scheduled message. The existing queue mechanism handles this gracefully - user's conversation completes, then scheduled message runs.

### Cost Implications

Each execution processes conversation history, increasing token usage. However:
- SDK caches are used when available
- Compaction reduces history size over time
- This is the expected behavior users want (context preservation)

### Error Handling

The try-catch approach handles:
- Session deleted → creates new session
- Session corrupted → "not found" error → creates new session
- Other errors → re-thrown, recorded as failure

## Files to Modify

| File | Change |
|------|--------|
| `apps/electron/src/main/scheduler.ts` | Modify `execute()` (~15 lines) |

**No changes needed to:**
- `types.ts` - `lastRunSessionId` already exists
- `sessions.ts` - `sendMessage()` already throws on missing session

## Migration

**None needed.** Existing schedules already have `lastRunSessionId` from their last run. On next execution:
- If `lastRunSessionId` exists → try to continue in that session
- If session was deleted → gracefully create new one
- If no `lastRunSessionId` (never run) → create new session

Fully backward compatible.

## Future Enhancements

1. **Session rotation**: Auto-create new session after N executions
2. **Execution markers**: Add visual separators in UI between schedule runs
3. **Link in UI**: Show which session a schedule uses in ScheduleDetailPanel
4. **Manual reset**: Button to "Start fresh session" for a schedule

## References

### Internal Files
- `apps/electron/src/main/scheduler.ts:192-303` - Current execution logic
- `apps/electron/src/main/sessions.ts:2099-2391` - sendMessage implementation (throws on missing session)
- `packages/shared/src/agent/craft-agent.ts:1504-1506` - SDK resume logic

### Key Insight
The `lastRunSessionId` field already tracks which session was used. The only change needed is to **reuse it** instead of always creating a new session.

---

*Plan created: 2026-01-23*
*Updated: 2026-01-23 - Simplified based on code review (removed unnecessary originSessionId field and sessionExists method)*
