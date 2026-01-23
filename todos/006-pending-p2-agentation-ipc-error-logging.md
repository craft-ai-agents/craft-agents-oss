---
status: pending
priority: p2
issue_id: AGEMENT-006
tags: [code-review, logging, debugging, agentation]
dependencies: []
blockedBy: []
blocks: []
created: 2026-01-23
updated: 2026-01-23
---

# Agentation: Missing Error Logging in IPC Handlers

## Problem Statement

The IPC handler for `AGENTATION_SET_ENABLED` silently fails when given invalid input without logging any error. If the setter receives a non-boolean value, the handler returns undefined with no console output, making debugging difficult. Developers won't know that their setting was rejected.

**Why it matters:**
- **Debuggability:** Silent failures are hard to diagnose
- **Observability:** No way to track invalid API usage
- **Production:** Can't monitor for issues in field
- **Developer Experience:** Should get clear feedback when things go wrong

## Findings

**Location:** `apps/electron/src/main/ipc.ts` (lines 1832-1836)

**Current Implementation:**
```typescript
ipcMain.handle(IPC_CHANNELS.AGENTATION_SET_ENABLED, async (_event, enabled: boolean) => {
  if (typeof enabled !== 'boolean') return  // ❌ Silent failure, no logging
  const { setAgentationEnabled } = await import('@craft-agent/shared/config/storage')
  setAgentationEnabled(enabled)
})
```

**Issue:** Type validation passes silently when invalid:
- Input: `setAgentationEnabled("yes")` → validation fails
- Current behavior: Returns `undefined`, no console message
- Desired behavior: Should log error for debugging

**Comparison with Good Pattern:**
```typescript
// Compare to NOTIFICATION_SET_ENABLED (line 1818-1821)
ipcMain.handle(IPC_CHANNELS.NOTIFICATION_SET_ENABLED, async (_event, enabled: boolean) => {
  if (typeof enabled !== 'boolean') return  // Also silent
  const { setNotificationsEnabled } = await import('@craft-agent/shared/config/storage')
  setNotificationsEnabled(enabled)
})
```

**Note:** The NOTIFICATION handler has the same issue - not just Agentation.

## Proposed Solutions

### Solution A: Add Console.warn (RECOMMENDED)
**Effort:** Small | **Risk:** Very Low | **Complexity:** Low

Add a warning log when validation fails:

```typescript
ipcMain.handle(IPC_CHANNELS.AGENTATION_SET_ENABLED, async (_event, enabled: boolean) => {
  if (typeof enabled !== 'boolean') {
    console.warn('[IPC] Invalid type for AGENTATION_SET_ENABLED:', {
      received: typeof enabled,
      value: enabled,
      expected: 'boolean'
    })
    return
  }
  const { setAgentationEnabled } = await import('@craft-agent/shared/config/storage')
  setAgentationEnabled(enabled)
})
```

**Result:**
- Renderer side sends invalid data → main process logs warning
- Easy to spot in DevTools console
- Doesn't break anything, just logs

**Pros:**
- Simple, one-liner fix
- Helps with debugging
- No performance impact
- Can be toggled in development

**Cons:**
- Logs to main process console, not renderer
- Could be spammy if called often
- Doesn't inform renderer about the error

### Solution B: Return Error Response
**Effort:** Medium | **Risk:** Low | **Complexity:** Medium

Return error object to renderer:

```typescript
ipcMain.handle(IPC_CHANNELS.AGENTATION_SET_ENABLED, async (_event, enabled: boolean) => {
  if (typeof enabled !== 'boolean') {
    return { success: false, error: `Invalid type: ${typeof enabled}` }
  }
  const { setAgentationEnabled } = await import('@craft-agent/shared/config/storage')
  setAgentationEnabled(enabled)
  return { success: true }
})
```

Then in settings page:

```typescript
const handleAgentationEnabledChange = useCallback(async (enabled: boolean) => {
  setAgentationEnabled(enabled)
  try {
    const response = await window.electronAPI?.setAgentationEnabled(enabled)
    if (!response?.success) {
      console.error('Failed to save Agentation setting:', response?.error)
      setAgentationEnabled(!enabled) // Revert
    }
  } catch (error) {
    console.error('Failed to save Agentation setting:', error)
    setAgentationEnabled(!enabled)
  }
})
```

**Pros:**
- Renderer knows about the error
- Can provide user feedback
- Better error handling

**Cons:**
- Breaks compatibility with current API
- Requires updating preload types
- More complex change
- Current code expects `void` return

### Solution C: Add Type Guard at Preload
**Effort:** Small | **Risk:** Very Low | **Complexity:** Low

Validate at preload layer before sending to main:

```typescript
// In preload/index.ts
setAgentationEnabled: (enabled: boolean) => {
  if (typeof enabled !== 'boolean') {
    console.warn('[Preload] Invalid type for setAgentationEnabled:', typeof enabled)
    return Promise.resolve()
  }
  return ipcRenderer.invoke(IPC_CHANNELS.AGENTATION_SET_ENABLED, enabled)
},
```

**Pros:**
- Fails fast at preload layer
- Renderer gets immediate feedback
- Prevents bad data from leaving renderer

**Cons:**
- Doesn't prevent malicious code from main process
- Duplicate validation

## Recommended Action

**IMPLEMENT: Solution A (Add Console.warn)**

This is the pragmatic approach for a debug feature. Add a warning log that helps developers spot issues during development. No API changes needed.

**Optional follow-up:** Consider applying the same fix to `NOTIFICATION_SET_ENABLED` for consistency.

## Technical Details

**Affected Files:**
- `apps/electron/src/main/ipc.ts` (lines 1832-1836)

**Change type:** Add logging only

**No API changes required.**

**Backward compatible:** Yes

## Acceptance Criteria

- [ ] `console.warn()` added for type validation failure
- [ ] Log includes: received type, expected type, actual value
- [ ] Manual test: Send invalid type → verify console warning
- [ ] Manual test: Send valid type → no warning
- [ ] Check that logger is visible in Dev Tools
- [ ] TypeScript compiles without errors
- [ ] No performance regression

## Work Log

- **2026-01-23 10:15** - Issue identified during security review
- **2026-01-23 10:21** - Solutions analyzed
- **Pending** - Implementation

## Related Issues

- Related: AGEMENT-005 (error boundary - separate concern)
- Similar pattern: NOTIFICATION_SET_ENABLED (line 1818-1821)

## Resources

- Console API: https://developer.mozilla.org/en-US/docs/Web/API/Console/warn
- Electron logging: https://www.electronjs.org/docs/tutorial/debugging-main-process
- Vespr logging patterns: Check existing IPC handlers for log patterns

## Future Enhancement

If error handling becomes more critical, consider:
1. Structured logging framework (e.g., `winston`, `pino`)
2. Error tracking service (e.g., Sentry)
3. Return error objects from IPC handlers
4. Telemetry/metrics on invalid requests

For now, `console.warn()` is sufficient for development use.
