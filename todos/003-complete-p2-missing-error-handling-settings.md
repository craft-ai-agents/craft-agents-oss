---
status: pending
priority: p2
issue_id: "003"
tags: [code-review, error-handling, quality]
dependencies: []
---

# Missing Error Handling in Agentation Settings Persistence

## Problem Statement

The `handleAgentationEnabledChange` callback in AppSettingsPage does not handle potential errors from the IPC call. If persistence fails, the UI state will be out of sync with the stored config.

**Why this matters:** Users may think they've enabled/disabled the feature when the change wasn't actually saved.

## Findings

### Code Quality Agent Finding
- **File:** `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx:568-571`

```typescript
const handleAgentationEnabledChange = useCallback(async (enabled: boolean) => {
  setAgentationEnabled(enabled)  // Updates UI immediately
  await window.electronAPI.setAgentationEnabled(enabled)  // No error handling
}, [])
```

### Additional Issue: Missing null check
The handler also doesn't verify `window.electronAPI` exists before calling (though other places in the file do check).

## Proposed Solutions

### Option 1: Add Error Handling with Rollback (Recommended)
**Description:** Wrap the IPC call in try/catch and revert state on failure.

```typescript
const handleAgentationEnabledChange = useCallback(async (enabled: boolean) => {
  setAgentationEnabled(enabled)
  try {
    await window.electronAPI?.setAgentationEnabled(enabled)
  } catch (error) {
    console.error('Failed to save Agentation setting:', error)
    setAgentationEnabled(!enabled) // Revert on failure
  }
}, [])
```

**Pros:**
- UI stays in sync with persisted state
- User gets visual feedback (toggle reverts)
- Error logged for debugging

**Cons:**
- Slightly more complex code

**Effort:** Small
**Risk:** Low

### Option 2: Add Error Handling with Toast Notification
**Description:** Show a user-visible error message instead of just reverting.

**Pros:**
- User understands why setting didn't persist

**Cons:**
- Requires toast/notification system
- More complex implementation

**Effort:** Medium
**Risk:** Low

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files
- `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx`

## Acceptance Criteria

- [ ] IPC call wrapped in try/catch
- [ ] State reverts on error
- [ ] Error logged to console
- [ ] Null check for window.electronAPI added

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created from code review | Optimistic UI updates need rollback on failure |

## Resources

- Similar pattern: Check how other settings handlers in the file handle errors
