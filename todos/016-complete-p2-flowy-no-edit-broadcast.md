---
status: complete
priority: p2
issue_id: "016"
tags: [code-review, architecture, flowy]
dependencies: []
---

# Problem Statement

**Missing Event Broadcast for Flowy Edits Creates Multi-Window Sync Issues**

The `handleFlowyEdit` IPC handler in the main process saves embed changes to disk but does not broadcast a `session:updated` event. This causes other windows viewing the same session to be unaware of changes, resulting in stale UI state and potential data loss if multiple windows edit the same embed.

**Why This Matters:**
- Multi-window users don't see real-time updates from other windows
- Potential data loss if Window A and Window B both edit the same embed
- Violates session architecture where all updates should broadcast
- Inconsistent with pattern used in other handlers (template updates, scheduler)
- Breaks assumption that all windows stay in sync

## Findings

**Location:** `apps/electron/src/main/ipc.ts:2637-2679`

```typescript
ipcMain.handle('flowy:edit', async (event, sessionId: string, embedId: string, data: unknown) => {
  try {
    const serializedData = JSON.stringify(data);
    const sessionPath = join(getSessionsDir(workspaceId), `${sessionId}.jsonl`);

    // Writes to file
    await writeFile(sessionPath, `${serializedData}\n`, { flag: 'a' });

    // Missing: Broadcast event to all windows!
    // Missing: session:updated or flowy:updated event

    return { success: true };
  } catch (error) {
    throw new Error(`Flowy edit failed: ${error.message}`);
  }
});
```

**Multi-Window Scenario:**
1. Window A and Window B both have Session 1 open
2. User edits an embed in Window A, sends `flowy:edit` IPC call
3. Main process saves the change to disk
4. **Problem:** Window B is never notified about the change
5. Window B still shows old embed state
6. If user edits in Window B, it overwrites Window A's changes (last-write-wins)

**Comparison with Other Handlers:**
```typescript
// Template updates BROADCAST event
ipcMain.handle('template:save', async (event, template) => {
  // ... save to disk
  mainWindow.webContents.send('template:updated', template);
  // ... notify all windows
});

// Scheduler operations BROADCAST event
ipcMain.handle('scheduler:create', async (event, schedule) => {
  // ... create schedule
  broadcastEvent('scheduler:created', schedule);
  // ... notify all windows
});

// Flowy edits should follow the same pattern!
```

**Session Update Pattern:**
Looking at `apps/electron/src/main/scheduler.ts`, the pattern is:
1. Receive IPC request from window
2. Perform operation (read/write/update)
3. **Emit session:updated event** so all windows know state changed
4. All windows receive event and re-load session data

## Proposed Solutions

### Solution 1: Emit session:updated Event (Recommended)

**Pros:**
- Consistent with existing patterns (scheduler, templates)
- Keeps all windows in sync
- Minimal performance overhead
- Handles multi-window scenario automatically

**Cons:**
- Requires all windows to re-load session on embed change
- Could trigger unnecessary re-renders

**Implementation:**
```typescript
ipcMain.handle('flowy:edit', async (event, sessionId: string, embedId: string, data: unknown) => {
  try {
    const serializedData = JSON.stringify(data);
    const sessionPath = join(getSessionsDir(workspaceId), `${sessionId}.jsonl`);

    // Save to disk
    await writeFile(sessionPath, `${serializedData}\n`, { flag: 'a' });

    // Broadcast to all windows
    broadcastEvent('session:updated', {
      sessionId,
      type: 'flowy:edit',
      embedId,
    });

    return { success: true };
  } catch (error) {
    throw new Error(`Flowy edit failed: ${error.message}`);
  }
});

// Helper function (may already exist)
function broadcastEvent(channel: string, data: unknown) {
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send(channel, data);
  });
}
```

**Effort:** Small (30 minutes)
**Risk:** Low (follows established pattern)

### Solution 2: Emit Granular flowy:edited Event

**Pros:**
- More specific event for embeds
- Could optimize re-rendering in components
- Clearer intent

**Cons:**
- Creates new event type to handle
- Less consistent with existing patterns
- Requires renderer update to listen to new event

**Implementation:**
```typescript
ipcMain.handle('flowy:edit', async (event, sessionId: string, embedId: string, data: unknown) => {
  try {
    // ... save to disk

    // Emit specific event
    broadcastEvent('flowy:edited', {
      sessionId,
      embedId,
      data,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  } catch (error) {
    throw new Error(`Flowy edit failed: ${error.message}`);
  }
});
```

**Effort:** Small (1 hour)
**Risk:** Low-Medium (new event type)

### Solution 3: Include Flowy State in Session Load

**Pros:**
- Ensures consistency on every session load
- No need for separate event listener

**Cons:**
- Less efficient (re-load entire session on single embed change)
- Could be slow with large sessions

**Effort:** N/A (existing pattern)
**Risk:** N/A

## Recommended Action

**Implement Solution 1 (Emit session:updated Event)**

Add `broadcastEvent('session:updated', {...})` call to `handleFlowyEdit` after successfully saving. This:
1. Keeps pattern consistent with scheduler, templates, and other handlers
2. Automatically syncs all windows viewing the session
3. Minimal code change
4. No new event types to manage

**Implementation Order:**
1. Ensure `broadcastEvent` function exists in main process
2. Add broadcast call to `handleFlowyEdit`
3. Add broadcast call to `handleFlowyDelete`
4. Test multi-window scenario

## Technical Details

**Affected Files:**
- `apps/electron/src/main/ipc.ts:2637-2679` (handleFlowyEdit)
- Potentially: `apps/electron/src/main/flowy-ipc.ts` (if handler is there)

**Related Files:**
- `apps/electron/src/main/scheduler.ts` (reference pattern)
- `apps/electron/src/main/ipc.ts` (where broadcastEvent is defined)
- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` (session consumer)

**Database/Schema Changes:** None

**Dependencies:** None

## Acceptance Criteria

- [ ] `handleFlowyEdit` emits session:updated or flowy:edited event
- [ ] `handleFlowyDelete` emits corresponding event
- [ ] All windows receive event when embed is changed
- [ ] Event contains sessionId, embedId, and relevant data
- [ ] Timestamp included for ordering
- [ ] Multi-window scenario: Window B sees edits from Window A
- [ ] No event storms or infinite loops
- [ ] Add unit tests for event broadcasting
- [ ] Performance acceptable with multiple embeds per session

## Work Log

### 2026-01-25
- **Discovered:** Missing event broadcast in flowy:edit handler during code review
- **Analysis:** Identified multi-window sync issue
- **Risk Assessment:** P2 (Important) - Affects data consistency
- **Recommendation:** Emit session:updated event
- **Verified:** Fix committed - event broadcast added to all workspace windows with SESSION_EVENT containing 'Flowy diagram updated' message and statusType 'flowy_updated' (lines 2779-2796) in apps/electron/src/main/ipc.ts

## Resources

- **File:** `apps/electron/src/main/ipc.ts`
- **Reference Pattern:** `apps/electron/src/main/scheduler.ts` (lines 100-150)
- **Related:** `apps/electron/src/renderer/contexts/NavigationContext.tsx` (session state)
