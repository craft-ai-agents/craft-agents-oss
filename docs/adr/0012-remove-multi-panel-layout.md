# Remove multi-panel layout — single content area

Sessions always open in a single content area. The side-by-side panel stack is removed.

## Considered options

- **Keep multi-panel** — sessions can be opened into adjacent panels for split-screen comparison. Rejected: adds layout complexity (proportional sizing, resize sashes, focus management) that is rarely used and conflicts with the simpler "one session at a time" model.
- **Single panel** (chosen) — one content area, one session. Navigation always replaces the current view in-place.

## Consequences

**Panel infrastructure removed:**
- `PanelStackContainer` becomes a passthrough wrapper (no multi-panel flex layout).
- `PanelSlot` close button (`X`) is removed — closing the only panel is meaningless.
- `session-panel-routing.ts` and its test are deleted — clicking a session always navigates in-place regardless of what is currently shown.
- `branching.ts` (`resolveBranchNewPanelOption`) is deleted — the `newPanel` option in `navigate()` is a no-op and can be removed from `NavigateOptions`.

**Session menu:**
- "Open in New Panel" (`Columns2`) is removed from `SessionMenu`.
- "Open in New Window" (`AppWindow`) remains as the sole "open elsewhere" action.

**Branch sessions:**
- After creating a branch from a message, the new session is opened in-place (same behavior as creating a new session). No new panel, no new OS window.

**Keyboard shortcut:**
- `Cmd+Shift+Click` on a session item is repurposed: opens the session in a new OS window instead of a new panel. Intent is preserved ("I want this in a separate space").
