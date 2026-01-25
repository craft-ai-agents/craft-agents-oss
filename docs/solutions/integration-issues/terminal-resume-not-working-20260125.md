---
module: Vesper
date: 2026-01-25
problem_type: integration_issue
component: tooling
symptoms:
  - "Terminal resume button not appearing in UI despite session having SDK session ID"
  - "Error invoking remote method when clicking terminal resume button"
  - "Invalid session ID format error for valid UUIDs like cbb68f4b-e8d5-45a1-9f2a-b665f82f780a"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [terminal-resume, electron-ipc, session-id, uuid-validation, event-propagation]
---

# Troubleshooting: Terminal Resume Feature Not Working

## Problem
The terminal resume button failed to appear and threw errors when clicked, preventing users from resuming Claude Agent SDK sessions in an external terminal window.

## Environment
- Module: Vesper Electron App
- Platform: macOS (also affects Linux/Windows)
- Affected Components: terminal.ts, ipc.ts, sessions.ts, event-processor
- Date: 2026-01-25

## Symptoms
- Terminal resume button never appeared in the UI even after sending messages (which creates SDK session ID)
- Clicking the button (when manually made visible) showed "Error invoking remote method 'sessions:resumeInT...'"
- Console logs showed "Invalid session ID format: cbb68f4b-e8d5-45a1-9f2a-b665f82f780a" for valid UUIDs
- Terminal.app never opened

## What Didn't Work

**Attempted Solution 1:** Assumed AppleScript permissions were blocking Terminal.app launch
- **Why it failed:** AppleScript wasn't the issue - the validation was rejecting valid session IDs before even reaching the terminal spawn code

**Attempted Solution 2:** Checked if IPC handler was throwing vs returning errors
- **Partial success:** Fixed the "Error invoking remote method" but still got "Invalid session ID format"

## Solution

Three separate issues needed to be fixed:

### 1. SDK Session ID Event Propagation (Button Not Appearing)

The renderer never received SDK session ID updates because no event was being sent.

**Code changes:**

```typescript
// apps/electron/src/shared/types.ts - Added event type
| { type: 'sdk_session_id_changed'; sessionId: string; sdkSessionId: string | undefined }

// apps/electron/src/renderer/event-processor/types.ts - Added interface
export interface SdkSessionIdChangedEvent {
  type: 'sdk_session_id_changed'
  sessionId: string
  sdkSessionId: string | undefined
}

// apps/electron/src/main/sessions.ts - Send event when SDK session ID captured
onSdkSessionIdUpdate: (sdkSessionId: string) => {
  managed.sdkSessionId = sdkSessionId
  this.sendEvent({
    type: 'sdk_session_id_changed',
    sessionId: managed.id,
    sdkSessionId
  }, managed.workspace.id)
},
```

### 2. IPC Error Handling (Error Invoking Remote Method)

The IPC handler was throwing errors instead of returning error objects.

**Code changes:**

```typescript
// Before (broken) - threw errors
ipcMain.handle(IPC_CHANNELS.SESSION_RESUME_IN_TERMINAL, async (_event, sessionId) => {
  if (!session.sdkSessionId) {
    throw new Error('Send a message first') // Caused "Error invoking remote method"
  }
})

// After (fixed) - returns error objects
ipcMain.handle(IPC_CHANNELS.SESSION_RESUME_IN_TERMINAL, async (_event, sessionId): Promise<{ success: boolean; error?: string }> => {
  if (!session.sdkSessionId) {
    return { success: false, error: 'Send a message first' }
  }
  return { success: true }
})
```

### 3. Session ID Validation (Invalid Session ID Format)

The `validateSessionId()` function only accepted `ses-` prefixed IDs, but SDK session IDs are plain UUIDs.

**Code changes:**

```typescript
// Before (broken) - only accepted ses- prefix
function validateSessionId(sessionId: string): boolean {
  const fullPattern = /^ses-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
  const shortPattern = /^ses-[a-f0-9-]+$/
  return fullPattern.test(sessionId) || shortPattern.test(sessionId)
}

// After (fixed) - accepts plain UUIDs with case-insensitive flag
function validateSessionId(sessionId: string): boolean {
  // Plain UUID format (most common for SDK session IDs)
  const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
  // With ses- prefix (legacy format)
  const sesUuidPattern = /^ses-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
  // Short hex format with ses- prefix
  const shortPattern = /^ses-[a-f0-9-]+$/i
  return uuidPattern.test(sessionId) || sesUuidPattern.test(sessionId) || shortPattern.test(sessionId)
}
```

### 4. macOS Terminal Spawning (Bonus Fix)

Replaced AppleScript with shell script approach for more reliable terminal spawning.

```typescript
// Creates temp script, opens with Terminal.app, cleans up after 5 seconds
const scriptPath = join(tmpdir(), `vesper-terminal-${Date.now()}.sh`)
writeFileSync(scriptPath, scriptContent)
chmodSync(scriptPath, 0o755)
spawn('open', ['-a', 'Terminal', scriptPath], { detached: true, stdio: 'ignore' })
setTimeout(() => unlinkSync(scriptPath), 5000)
```

## Why This Works

1. **Event propagation**: The terminal resume button's visibility depends on `session.sdkSessionId` being set in the renderer state. Without the event, the renderer never knew when SDK session IDs were captured by the agent.

2. **IPC error handling**: Electron's `ipcMain.handle` expects handlers to either return a value or throw. Thrown errors are serialized and become "Error invoking remote method" messages. By returning `{success: false, error}`, the renderer can handle errors gracefully.

3. **UUID validation**: The SDK session ID format assumption was wrong. SDK session IDs are plain UUIDs like `cbb68f4b-e8d5-45a1-9f2a-b665f82f780a`, not `ses-` prefixed. The case-insensitive `/i` flag handles both uppercase and lowercase hex digits.

## Prevention

1. **Verify input format assumptions with actual data**: Before writing validation logic, log actual values at runtime to confirm format assumptions
2. **Test IPC handlers with real session data**: Mock tests may not catch format mismatches
3. **Add event propagation tests**: If UI state depends on backend data, test that events properly update renderer state
4. **Use typed return values for IPC handlers**: `Promise<{ success: boolean; error?: string }>` makes error handling explicit

## Related Issues

No related issues documented yet.
