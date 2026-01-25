---
status: complete
priority: p2
issue_id: "013"
tags: [code-review, security, flowy]
dependencies: []
---

# Problem Statement

**Missing Authorization Checks in Flowy IPC Handler**

The `handleFlowyEdit` IPC handler in the main process does not verify that the renderer has permission to edit the specified session before processing the request. This creates a security vulnerability where a malicious renderer (or cross-window attack) could modify diagrams in sessions that don't belong to its workspace.

**Why This Matters:**
- Allows cross-session data tampering in multi-window scenarios
- A compromised or crafted renderer could modify embeds in other sessions
- Violates session isolation principle
- Could lead to unauthorized changes to user data

## Findings

**Location:** `apps/electron/src/main/ipc.ts:2637-2679`

```typescript
ipcMain.handle('flowy:edit', async (event, sessionId: string, embedId: string, data: unknown) => {
  // Missing: Verify that sessionId belongs to the window's workspace
  // Missing: Validate renderer permissions

  try {
    const serializedData = JSON.stringify(data);
    const sessionPath = join(getSessionsDir(workspaceId), `${sessionId}.jsonl`);

    // Proceeds to edit without checking if sessionId is authorized for this window
    // ...
  } catch (error) {
    // error handling
  }
});
```

**Security Issue:**
In a multi-window scenario:
1. Window A is authenticated to Workspace 1, showing Session 1A
2. Window B is authenticated to Workspace 2, showing Session 2B
3. Window B could send `flowy:edit` for Session 1A if it somehow knows the sessionId
4. Main process would allow the edit because there's no workspace/window validation

**Related Code:**
- The handler has access to `event.sender` which could be used to get the window ID
- Window-to-workspace mapping exists in `apps/electron/src/renderer/contexts/NavigationContext.tsx`
- Session validation pattern exists in other handlers

## Proposed Solutions

### Solution 1: Validate Session Belongs to Window's Workspace (Recommended)

**Pros:**
- Consistent with permission mode checks in other handlers
- Uses existing window/workspace mapping infrastructure
- Minimal performance impact

**Cons:**
- Requires passing window ID through IPC

**Implementation:**
```typescript
ipcMain.handle('flowy:edit', async (event, sessionId: string, embedId: string, data: unknown) => {
  try {
    // Get the window that sent this request
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error('Window not found');

    // Get workspace for this window (from window state)
    const workspaceId = getWorkspaceForWindow(window.id);
    if (!workspaceId) throw new Error('Workspace not found for window');

    // Verify session exists in this workspace
    const session = loadSession(sessionId, workspaceId);
    if (!session) throw new Error('Session not found or not in workspace');

    // Proceed with edit
    const serializedData = JSON.stringify(data);
    const sessionPath = join(getSessionsDir(workspaceId), `${sessionId}.jsonl`);
    // ...
  } catch (error) {
    throw new Error(`Flowy edit failed: ${error.message}`);
  }
});
```

**Effort:** Small (1-2 hours)
**Risk:** Low (adds validation layer, no API changes)

### Solution 2: Use Context Bridge Pattern

**Pros:**
- Automatically validates window context
- Follows Electron security best practices
- Can't be bypassed by direct IPC calls

**Cons:**
- Requires refactoring preload and context bridge
- More invasive change

**Effort:** Medium (2-4 hours)
**Risk:** Medium (requires testing multiple windows)

## Recommended Action

**Implement Solution 1 (Validate Session Belongs to Window's Workspace)**

Add authorization checks to ensure:
1. Window exists and has valid workspace assignment
2. Session belongs to the window's workspace
3. Consistent with existing permission mode validation

## Technical Details

**Affected Files:**
- `apps/electron/src/main/ipc.ts:2637-2679`

**Database/Schema Changes:** None

**Dependencies:** None

## Acceptance Criteria

- [ ] `handleFlowyEdit` verifies session belongs to window's workspace
- [ ] Unauthorized edits are rejected with clear error
- [ ] Cross-window edit attempts fail gracefully
- [ ] Multi-window scenarios properly isolated
- [ ] Add unit tests for authorization checks
- [ ] Document window-to-workspace mapping requirement

## Work Log

### 2026-01-25
- **Discovered:** Missing authorization checks in flowy:edit handler during code review
- **Analysis:** Identified cross-session data tampering vulnerability
- **Risk Assessment:** P2 (Important) - Affects multi-window security
- **Recommendation:** Add workspace/session validation
- **Verified:** Fix committed - workspace authorization (lines 2639-2643) and session ownership validation (lines 2646-2654) added to FLOWY_EMBED_UPDATE handler in apps/electron/src/main/ipc.ts

## Resources

- **File:** `apps/electron/src/main/ipc.ts`
- **Related:** `apps/electron/src/renderer/contexts/NavigationContext.tsx`
- **Pattern:** Permission mode validation in other IPC handlers
