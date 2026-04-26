# Fix Per-Session Sound Pack: Three Bugs

## Bug 1: Sound pack selection not persisted across restarts

**Root cause:** When the user selects a sound pack via `SoundPackBadge`, the call chain is:
1. `window.electronAPI.setSoundPack(sessionId, packName)` → RPC
2. Handler calls `engine.setSessionPack(sessionId, packName)` (in-memory Map)
3. Handler calls `deps.sessionManager.updateSessionSoundPack(sessionId, packName)` (persists to JSONL)

The persistence to JSONL works correctly. However, the renderer's session atom is **not updated**.
The `SoundPackBadge` uses optimistic local state (`optimisticPack`), but when the component re-mounts
or the session is reloaded, it reads `activePack` from the session atom prop.

**Fix:** After `setSoundPack` RPC succeeds, update the session atom in the renderer so
the `activePack` prop stays in sync. Also, `updateSessionSoundPack` should push an event
to the renderer so all session observers get the update.

## Bug 2: Per-session sound pack doesn't affect playback

**Root cause:** In `apps/electron/src/main/index.ts`, lifecycle sound hooks call `engine.play()`
without passing `sessionId`:
- Line 637: `engine.play('session.start')` — no sessionId
- Line 645: `engine.play('task.complete')` — no sessionId
- Line 647: `engine.play('task.error')` — no sessionId

Only `onAutomationEvent` passes sessionId. Without sessionId, `SoundEngine.getActivePack()`
falls back to the global default pack, ignoring per-session packs.

**Fix:** Update `SessionRuntimeHooks` to pass sessionId to `onSessionStarted`, `onSessionStopped`,
and `onSessionCompleted`. Then pass that sessionId to `engine.play()`.

## Bug 3: Changing one session's pack appears to change all

**Root cause:** The `SoundPackBadge` uses local optimistic state (`optimisticPack`).
When `activePack` prop (from session atom) changes for ANY reason (e.g., session reload
merges data), the `useEffect` that syncs `optimisticPack` to `activePack` can pick up
stale values. But the deeper issue is that `setSoundPack` for session A doesn't send
any event to update session A's atom — so the badge relies purely on local optimistic
state until the session is reloaded from disk.

**Fix:** Same as Bug 1 — after setting a pack, update the session atom so the prop
stays correct. Each session's `SoundPackBadge` reads its own `session.soundPack` prop,
so fixing event propagation means each badge correctly shows only its own session's pack.

## Implementation Plan

### Step 1: Add sessionId to runtime hooks (Bug 2)

In `SessionManager.ts`, update `SessionRuntimeHooks` interface:
```ts
onSessionStarted: (sessionId: string) => void
onSessionStopped: (sessionId: string) => void  
onSessionCompleted?: (reason: string, sessionId: string) => void
```

Update `setProcessing()` call site to pass `managed.id`:
```ts
sessionRuntimeHooks.onSessionStarted(managed.id)
sessionRuntimeHooks.onSessionStopped(managed.id)
```

Update `onSessionCompleted` call site at line 5558 to pass sessionId.

In `index.ts`, update the hooks to pass sessionId to `engine.play()`.

### Step 2: Emit event on soundPack change (Bugs 1 & 3)

In `updateSessionSoundPack`, add an event push after persisting:
```ts
this.sendEvent({ type: 'metadata_changed', sessionId, soundPack }, managed.workspace.id)
```
Or create a specific event type.

### Step 3: Handle the event in the renderer (Bugs 1 & 3)

In the session event processor, handle the new event type by updating the
session atom's `soundPack` field.

### Step 4: Update SoundPackBadge to confirm after RPC

The `handleSelectPack` already uses optimistic state with rollback.
Since the event propagation will update the session atom, the `activePack`
prop will also update, which the `useEffect` syncs to `optimisticPack`.
This ensures consistency without needing additional logic in the badge.

## Files to modify
- `packages/server-core/src/sessions/SessionManager.ts` — hook signatures + sessionId params
- `apps/electron/src/main/index.ts` — pass sessionId to engine.play()
- `apps/electron/src/renderer/event-processor/handlers/session.ts` — handle metadata_changed event
- `apps/electron/src/renderer/atoms/sessions.ts` — update soundPack in session atom