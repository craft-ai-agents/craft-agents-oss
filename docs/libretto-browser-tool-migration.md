# Libretto-First Browser Tool Migration

Replace the current AX-ref browser tool with a Libretto-first model. Craft keeps owning browser panes; Libretto owns automation. This is a deletion project, not an architecture project.

---

## Target state

- `browser_tool` stays as the tool name
- Craft-native commands: `open`, `windows`, `focus`, `hide`, `release`, `close`
- Everything else passes through to Libretto: `snapshot`, `exec`, `run`, `resume`
- Old AX-ref contract (`click @eN`, `fill @eN`, `find`, `select`, etc.) is deleted, not emulated
- Panes with a Libretto attachment are pinned — no auto-unbind/reuse

---

## What changes

### Expose CDP for the pane

Enable `--remote-debugging-port` on Electron (via `CRAFT_CDP_PORT` env var). Libretto connects via `connectOverCDP` and targets the correct page using `--page <targetId>`.

**Key requirement:** The `nativeOverlayView` must have `about:blank` loaded (not left unloaded). An unloaded BrowserView appears as an empty-URL CDP target, which causes Playwright's `connectOverCDP` to hang waiting for it to reach a ready state.

### Libretto page targeting

Each browser pane has 3 BrowserViews (toolbar, pageView, overlay) visible as CDP targets. Libretto's `--page <id>` flag selects the right one. The pageView's CDP target ID can be looked up via the `/json` endpoint on the remote debugging port — it's the target with an http/https URL.

### Pin attached panes

Today `SessionManager` unbinds panes at turn end (`clearVisualsForSession` + `unbindAllForSession`). With Libretto attached, skip the unbind. Clear overlay only.

### Track attachment on the pane instance

Minimal metadata on each `BrowserInstance`:

```ts
librettoSession?: string   // e.g. "craft-abc123"
```

Presence implies pinned. Current implementation also stores `pageTargetId` so Libretto can reliably target the pane's `pageView` when multiple BrowserViews are exposed over CDP.

### Simplify `BrowserPaneFns`

The current callback surface has ~30 action methods. Replace with:

```ts
type BrowserPaneFns = {
  openPanel(options?: { background?: boolean }): Promise<{ instanceId: string }>
  listWindows(): Promise<...>
  focusWindow(instanceId?: string): Promise<...>
  hideWindow(instanceId?: string): Promise<...>
  releaseControl(instanceId?: string): Promise<...>
  closeWindow(instanceId?: string): Promise<...>
  runLibretto(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>
}
```

### Rewrite `browser-tool-runtime.ts`

Current file is a giant command parser for AX-ref verbs. Replace with:

```ts
if (cmd === 'open')    return handleOpen(...)
if (cmd === 'close')   return handleClose(...)
if (cmd === 'release') return handleRelease(...)
if (cmd === 'focus')   return handleFocus(...)
if (cmd === 'hide')    return handleHide(...)
if (cmd === 'windows') return handleWindows(...)
// everything else
return fns.runLibretto(parts)
```

### Delete old code

Once the Libretto path works:

- AX-ref command branches in `browser-tool-runtime.ts`
- Most of `BrowserPaneFns` action surface
- Most of `IBrowserPaneManager` action methods
- `BrowserCDP` tool-facing methods (keep if renderer still needs them)
- Challenge detection logic

---

## `open` flow

1. Create or focus Craft browser pane
2. Ensure `nativeOverlayView` has `about:blank` loaded
3. Run `npx libretto connect http://127.0.0.1:<cdpPort> --session craft-<instanceId>`
4. Look up pageView's CDP target ID via `http://127.0.0.1:<cdpPort>/json`
5. Store `librettoSession` and `pageTargetId` on the pane
6. Return result telling agent Libretto is attached

---

## Libretto command routing

The `runLibretto` implementation should:

- always inject `--session <sessionName>`
- always inject `--page <pageTargetId>` (to select the correct BrowserView)
- shell out to `npx libretto <cmd> ...`
- return stdout/stderr/exitCode

For v1 this can live inline in SessionManager's callback wiring or as a small helper. No need for a formal service class yet.

---

## Rollout

Use a feature flag following the existing pattern in `packages/shared/src/feature-flags.ts`:

```ts
export function isLibrettoBrowserToolEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('CRAFT_FEATURE_LIBRETTO_BROWSER_TOOL'))
  if (override !== undefined) return override
  return false
}

// in FEATURE_FLAGS:
get librettoBrowserTool(): boolean {
  return isLibrettoBrowserToolEnabled()
}
```

Gate the new path in `session-scoped-tools.ts` where `browser_tool` is already conditionally included. No need for a separate `browserToolBackend` config setting — dual-backend is not a long-term goal.

---

## Phase 1 spike findings

### What works (all validated manually)

- `CRAFT_CDP_PORT=9229` + `--remote-debugging-port=9229` exposes all BrowserViews as CDP targets
- Libretto `connect`, `exec`, `readonly-exec`, `snapshot` all work against the pageView
- `page.title()` ✅, `page.screenshot()` ✅, `page.evaluate()` ✅, locators ✅
- No CDP contention: Libretto uses the remote debugging port; Craft's BrowserCDP uses `webContents.debugger`
- Multiple pages handled via `--page <targetId>` flag

### Key finding: no proxy needed

Originally built a per-pane CDP proxy (~300 lines) because Playwright's `connectOverCDP` hung with multiple targets. Root cause turned out to be much simpler: the `nativeOverlayView` BrowserView had **no URL loaded**, appearing as an empty-URL CDP target. Playwright waits for all targets to reach a ready state, and an unloaded BrowserView never does.

**Fix: one line** — `void nativeOverlayView.webContents.loadURL('about:blank')` after creating the overlay view. After this, `connectOverCDP` works directly with all 5 targets visible.

---

## Migration phases

### Phase 1 — Spike ✅

- ✅ Enable remote debugging port in Electron (localhost only)
- ✅ Validate Libretto connect/exec/snapshot against browser pane
- ✅ Confirm Libretto targets correct page via `--page` flag
- ✅ Confirm no CDP contention
- ✅ Identify and fix the `connectOverCDP` hang (overlay needs `about:blank`)

### Phase 2 — Flagged integration

- Add `FEATURE_FLAGS.librettoBrowserTool`
- Wire `runLibretto` into `BrowserPaneFns`
- Rewrite `browser-tool-runtime.ts`: Craft-native commands + Libretto passthrough
- Add `librettoSession` + `pageTargetId` metadata to pane instances
- Skip `unbindAllForSession` for attached panes
- Update tool description/help text

### Phase 3 — Cleanup

- Validate lifecycle behavior end-to-end:
  - `open` eagerly attaches Libretto
  - later Libretto commands require an existing attachment and tell the user to `close` + `open` if stale
  - `close` and session deletion clean up Libretto sessions
  - attached panes stay pinned and are not reused as generic unbound panes
- Prevent non-`open` Libretto commands from implicitly creating an unattached hidden pane during overlay activation
- Close Libretto sessions on all destroy paths, including direct pane destruction outside `browser_tool close`
- Update tests, help text, and docs to match the Libretto command surface
- Leave the legacy AX-ref path in place behind the feature flag until rollback is no longer needed; remove it in a later follow-up

### Phase 3 — Validated behavior / notes

- Hidden or released panes with a Libretto attachment remain reserved to the owning session until `close` or session deletion.
- `browser_tool open` is the only command that creates or re-attaches a pane for Libretto automation.
- `snapshot` / `exec` / `run` / `resume` require an existing attachment; they do not lazily create one.
- Explicit `browser_tool close` and session deletion perform best-effort `libretto close` cleanup before destroying the pane.

---

## Files touched

### Phase 1 (spike) ✅

- `apps/electron/src/main/index.ts` — `CRAFT_CDP_PORT` env var enables `--remote-debugging-port`
- `apps/electron/src/main/browser-pane-manager.ts` — load `about:blank` into overlay on creation

### Phase 2 (integration)

- `packages/shared/src/feature-flags.ts` — add flag
- `packages/shared/src/agent/browser-tools.ts` — rewrite description
- `packages/shared/src/agent/browser-tool-runtime.ts` — rewrite command routing
- `packages/server-core/src/sessions/SessionManager.ts` — new callback wiring + turn-end change
- `apps/electron/src/main/browser-pane-manager.ts` — attachment metadata + pinning

### Phase 3 (cleanup)

- `packages/shared/src/agent/browser-tool-runtime.ts` — tighten Libretto help/error messaging; keep legacy branches behind the flag for now
- `packages/shared/src/agent/browser-tools.ts` — reduce small redundant Libretto surface while keeping rollback intact
- `packages/server-core/src/handlers/browser-pane-manager-interface.ts` — add destroy notifications for Libretto cleanup
- `packages/server-core/src/sessions/SessionManager.ts` — validate close/delete/destroy cleanup and prevent hidden-pane creation for non-\`open\` Libretto commands
- `apps/electron/src/main/browser-pane-manager.ts` — keep attached panes pinned and notify SessionManager when attached panes are destroyed directly
- `apps/electron/src/main/__tests__/browser-pane-manager.test.ts` / `packages/shared/src/agent/__tests__/browser-tools-libretto.test.ts` — add Libretto validation coverage

---

## Risks

1. ~~**CDP contention**~~ — **Resolved.** Remote debugging port and `webContents.debugger` are independent channels.

2. ~~**Target selection**~~ — **Resolved.** Libretto's `--page <targetId>` flag targets the correct BrowserView.

3. ~~**Playwright multi-target hang**~~ — **Resolved.** Caused by unloaded overlay view. Fix: `about:blank` on creation.

4. **CLI overhead** — `npx libretto ...` per command is fine for v1. If latency matters later, call the library directly or keep a long-lived process.

5. **Libretto setup** — `.libretto/` config and AI provider setup become prerequisites. Fail clearly on `open` if not ready.

---

## Acceptance criteria

- `browser_tool open <url>` opens pane + attaches Libretto
- `browser_tool snapshot/exec` work through Libretto against the correct page
- `browser_tool release` clears overlay, keeps Libretto session alive
- `browser_tool close` tears down pane + cleans up mapping
- Turn end does not orphan the attachment or reuse attached panes
- Two panes can have two distinct Libretto sessions
- Connect failure on `open` produces a clear error
