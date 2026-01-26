---
title: "Memory Leak - Orchestrate Runners Not Cleaned Up on Session Deletion"
date: 2026-01-22
module: "Orchestrate"
problem_type: "reliability_issue"
component: "session_management"
severity: "critical"
symptoms:
  - "Background loops continue running after session is deleted"
  - "Event listeners accumulate in memory indefinitely"
  - "Loop runners map holds references indefinitely"
  - "IPC events sent to non-existent sessions"
tags:
  - memory-leak
  - resource-cleanup
  - session-management
  - event-emitter
investigation_log:
  - timestamp: 2026-01-22
    action: "Code review of session lifecycle management"
    finding: "deleteSession() and cleanup() don't cancel active loops"
  - timestamp: 2026-01-22
    action: "Traced loop runner lifecycle"
    finding: "loopRunners map entries never removed"
---

## Problem Statement

Orchestrate runners are not properly cleaned up when sessions are deleted or the app shuts down. This causes:

1. **Background loops continue running** - A loop processing 100 stories continues even after user deletes the session
2. **Memory accumulation** - LoopState objects held indefinitely (each ~1MB with large PRDs)
3. **Orphaned event listeners** - EventEmitter listeners never removed, accumulate across sessions
4. **IPC send to deleted sessions** - Events sent to non-existent session channels

**Severity:** CRITICAL (resource leak affecting long-running app stability)

---

## Root Cause

### Location 1: `apps/electron/src/main/sessions.ts:deleteSession() (lines 1988-2037)`

```typescript
async deleteSession(sessionId: string): Promise<void> {
  const managed = this.managedSessions.get(sessionId)
  if (!managed) return

  // Agent and tools cleanup
  if (managed.isProcessing && managed.abortController) {
    managed.abortController.abort()  // Cancels agent
  }
  managed.disposable?.()  // Cleanup callbacks
  managed.agent?.dispose?.()  // Dispose agent

  // Remove from map
  this.managedSessions.delete(sessionId)

  // ❌ MISSING: Loop runner cleanup
  // const runner = this.loopRunners.get(sessionId)
  // if (runner) {
  //   runner.cancel()
  //   this.loopRunners.delete(sessionId)
  // }
}
```

**Issue:** Only cleans up agent, not the Orchestrate runner

### Location 2: `apps/electron/src/main/sessions.ts:cleanup() (line 3236)`

```typescript
cleanup(): void {
  // Stops config watchers
  this.configWatcher?.dispose?.()

  // Clears timers
  clearTimeout(this.updateSessionListTimeout)

  // Unregisters callbacks
  this.unregisterAllCallbacks()

  // ❌ MISSING: Loop runner cleanup
  // for (const runner of this.loopRunners.values()) {
  //   runner.cancel()
  // }
  // this.loopRunners.clear()
}
```

**Issue:** Global cleanup on app shutdown doesn't cancel running loops

### Location 3: `packages/shared/src/orchestrate/loop-runner.ts (no cleanup method)`

```typescript
export class OrchestrateRunner extends EventEmitter {
  // ❌ MISSING: destroy() or cleanup() method
  // Should remove all event listeners and abort controller
}

// Usage in sessions.ts
this.loopRunners.set(sessionId, runner)
runner.on('progress', (state) => { /* ... */ })
runner.on('story_complete', (story, result) => { /* ... */ })
// ... more listeners

// When session deleted: no cleanup!
```

**Issue:** No way to properly destroy a loop runner

---

## Impact

### Scenario 1: Session Deletion Mid-Loop

1. User starts Orchestrate with 100 stories
2. Loop is processing story 45/100
3. User deletes the session (or navigates away)
4. **What happens:**
   - Session deleted from managedSessions map ✓
   - Agent disposed ✓
   - **Loop runner continues executing** ✗
   - Loop emits events to deleted session ✗
   - Events sent via IPC to non-existent session channel ✗
5. Memory impact: ~1MB per runner × number of abandoned loops

### Scenario 2: App Shutdown During Loop

1. User closes Vesper app while loop is running
2. **What happens:**
   - Main process receives quit signal
   - cleanup() called to stop watchers/timers
   - **Loops never cancelled** ✗
   - Processes abort abruptly
   - Loose file handles, uncommitted git operations
3. Memory impact: OS kills process, but leaves git repository in dirty state

### Scenario 3: Long Session Lifetime

1. User runs multiple loops in same session over 8 hours
2. 5 loops completed, 2 active
3. EventEmitter has accumulated 50+ listeners (10 per loop)
4. **What happens:**
   - Each progress event triggers 50+ listener callbacks
   - Memory usage grows linearly with listeners
   - App becomes noticeably slower
5. Memory impact: Listener accumulation + state object retention

---

## Solution

### Fix 1: Add Cleanup Method to OrchestrateRunner

**Location:** `packages/shared/src/orchestrate/loop-runner.ts`

```typescript
/**
 * Properly clean up loop runner resources
 * Called when loop is deleted, cancelled, or app shuts down
 *
 * Ensures:
 * - All event listeners removed
 * - AbortController cancelled
 * - State cleared
 * - No references held in memory
 */
destroy(): void {
  // Cancel any in-flight operations
  if (this.currentAbortController) {
    this.currentAbortController.abort()
    this.currentAbortController = null
  }

  // Remove all event listeners
  this.removeAllListeners()

  // Clear state
  this.state = null
  this.isPaused = false
  this.isCancelled = false
}
```

### Fix 2: Cleanup in deleteSession()

**Location:** `apps/electron/src/main/sessions.ts:deleteSession()`

```typescript
async deleteSession(sessionId: string): Promise<void> {
  const managed = this.managedSessions.get(sessionId)
  if (!managed) return

  // Agent cleanup
  if (managed.isProcessing && managed.abortController) {
    managed.abortController.abort()
  }
  managed.disposable?.()
  managed.agent?.dispose?.()

  // ✅ NEW: Loop runner cleanup
  const runner = this.loopRunners.get(sessionId)
  if (runner) {
    runner.cancel()  // Signal cancellation
    runner.destroy()  // Clean up resources
    this.loopRunners.delete(sessionId)  // Remove reference
  }

  // Remove session
  this.managedSessions.delete(sessionId)

  // Notify listeners
  this.emit('session_deleted', sessionId)
}
```

### Fix 3: Cleanup on App Shutdown

**Location:** `apps/electron/src/main/sessions.ts:cleanup()`

```typescript
cleanup(): void {
  // Existing cleanup
  this.configWatcher?.dispose?.()
  clearTimeout(this.updateSessionListTimeout)
  this.unregisterAllCallbacks()

  // ✅ NEW: Cancel and cleanup all active loops
  for (const [sessionId, runner] of this.loopRunners.entries()) {
    try {
      runner.cancel()
      runner.destroy()
    } catch (error) {
      console.error(`Failed to cleanup loop ${sessionId}:`, error)
    }
  }
  this.loopRunners.clear()

  // Close all sessions
  for (const sessionId of this.managedSessions.keys()) {
    this.deleteSession(sessionId)
  }
}
```

### Fix 4: Prevent EventEmitter Listener Leaks

Even after destroy(), ensure listeners are removed in all code paths:

```typescript
// In loop-runner.ts start() method
async start(prd: PRD): Promise<LoopResult> {
  if (this.state?.status === 'running') {
    throw new Error('Loop is already running')
  }

  try {
    // ... initialization and runLoop() ...
  } catch (error) {
    // Error handling
  } finally {
    // ✅ Ensure cleanup even on error
    // This allows clean restart if resume() called after error
    // But destroy() must be explicit call for full cleanup
  }
}
```

---

## Prevention

### Code Review Checklist

When adding new EventEmitters or long-lived objects:

- ✅ Is there a `destroy()` or `cleanup()` method?
- ✅ Are all event listeners removed in cleanup?
- ✅ Is cleanup called when object is no longer needed?
- ✅ Is cleanup called in error paths (finally blocks)?
- ✅ Are external references (map entries) removed?

### Testing for Leaks

Add tests for proper cleanup:

```typescript
describe('OrchestrateRunner - Cleanup', () => {
  it('should remove all event listeners on destroy', () => {
    const runner = new OrchestrateRunner('session', agent, gitOps, config)

    // Register multiple listeners
    runner.on('progress', () => {})
    runner.on('story_complete', () => {})
    runner.on('error', () => {})

    // Verify listeners registered
    expect(runner.listenerCount('progress')).toBe(1)
    expect(runner.eventNames().length).toBeGreaterThan(0)

    // Destroy and verify cleanup
    runner.destroy()
    expect(runner.listenerCount('progress')).toBe(0)
    expect(runner.eventNames().length).toBe(0)
  })

  it('should cancel in-flight operations on destroy', async () => {
    const runner = new OrchestrateRunner('session', agent, gitOps, config)
    const promise = runner.start(prd)

    // Let it start
    await new Promise(r => setTimeout(r, 100))

    // Destroy while running
    runner.destroy()

    // Should complete (cancelled)
    const result = await promise
    expect(result.status).toBe('cancelled')
  })

  it('should prevent memory leaks when sessions deleted during loop', async () => {
    const sessions = new SessionManager()
    const sessionId = await sessions.createSession()

    const loopPromise = startLoopInSession(sessionId, largeTestData)

    // Let loop start processing
    await new Promise(r => setTimeout(r, 500))

    // Delete session mid-loop
    await sessions.deleteSession(sessionId)

    // Verify loop was cleaned up
    const runner = sessions['loopRunners'].get(sessionId)
    expect(runner).toBeUndefined()
  })
})
```

---

## Related Issues

- **[Insufficient Error Context in Logging](../debugging-issues/error-context-logging-20260122.md)** - Cleanup failures may be silent
- **[Command Injection in Git Operations](../security-vulnerabilities/command-injection-orchestrate-git-operations-20260122.md)** - Could leave git in dirty state if loop not cleaned properly

---

## Implementation Status

- [ ] Add `destroy()` method to OrchestrateRunner
- [ ] Update `deleteSession()` to cleanup loop runners
- [ ] Update `cleanup()` to cancel all active loops
- [ ] Add tests for cleanup and listener removal
- [ ] Test long-running app with multiple loops to verify no memory accumulation
- [ ] Add error logging for cleanup failures

---

## Testing the Fix

After implementation, verify with:

```bash
# Start app
npm run electron:dev

# In DevTools:
# 1. Create session
# 2. Start loop with 50 stories
# 3. Delete session mid-loop
# 4. Check memory doesn't grow
# 5. Check no IPC errors in console

# Monitor with:
# sessionManager.loopRunners.size  # Should be 0 after delete
# runner.listenerCount()  # Should be 0 after destroy
```

---

## References

- [Node.js EventEmitter Memory Leaks](https://nodejs.org/en/docs/guides/nodejs-performance-getting-started/#identifying-event-emitter-memory-leaks)
- [AbortController.abort() documentation](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort)
- [Memory Leaks in Electron](https://www.electronjs.org/docs/tutorial/memory-management)
