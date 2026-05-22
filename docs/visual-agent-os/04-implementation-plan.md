# Visual Agent OS Implementation Plan

Status: draft
Owner: RunnerOS
Last updated: 2026-05-22

## Phase 1: Visual Sidecar Skeleton

Goal: open a responsive right-side panel from a session.

Tasks:

1. Add shared visual-surface types.
2. Add renderer atom/state for active visual surface.
3. Add `VisualSurfacePanel`.
4. Add adaptive layout rules.
5. Add chat receipt UI for "visual opened."

Detailed build:

1. Add shared type-only module for visual surfaces.
2. Add renderer-only demo/open action behind a local dev flag or inert command.
3. Render a placeholder surface panel with title/status/collapse.
4. Wire adaptive sizing to the existing app shell/panel stack.
5. Add a synthetic chat receipt path for manual QA.

Do not expose agent tools in Phase 1. Keep it renderer/local until the layout is proven.

Verification:

- Chat remains usable at wide, laptop, and narrow widths.
- Sidecar can open/collapse/focus without changing sessions.
- No persistent storage yet unless needed for the panel state.

## Phase 2A: Output-Backed Canvas Viewer

Goal: the Canvas panel renders real session-linked outputs.

Tasks:

1. Reuse existing Outputs manifests as visual artifacts.
2. Load outputs where `origin.sessionId` matches the active session.
3. Open the newest visual output from the Canvas toggle.
4. Render image, video, markdown/text/json, receipt, and link previews.
5. Add a compact output selector when multiple outputs exist.
6. Keep placeholder canvas only when no session output exists.

Detailed execution spec: [08 Phase 2 Execution Spec](./08-phase-2-execution-spec.md).

Verification:

- Session-linked output opens in Canvas.
- Multiple session outputs can be selected.
- Reload rediscovers output manifests.
- Roll-up and sidecar layouts preserve chat usability.

## Phase 2B: tldraw Canvas MVP

Goal: one session can own a persistent canvas.

Tasks:

1. Add tldraw dependency.
2. Render tldraw inside `VisualSurfacePanel`.
3. Persist canvas state.
4. Add commands/events for open canvas and add note.
5. Add "Open visual" from session/chat receipt.

Implementation notes:

- Use manual snapshot persistence if writing to workspace storage.
- Avoid `persistenceKey` as the final storage path because RunnerOS needs workspace/session portability.
- Use tldraw asset handlers to resolve output-backed image/video assets.
- Persist snapshots on debounce, not every editor tick.
- Store only semantic surface events in manifest history.

Verification:

- Create a canvas.
- Add note.
- Restart app.
- Canvas reopens with state intact.
- Add an image output to canvas if an output exists.

## Phase 3: Agent Surface Events

Goal: agent can update the visual surface through structured operations.

Tasks:

1. Add server/renderer event bridge for `visual_surface.*`.
2. Add agent-accessible tool or session-scoped command.
3. Store event history for replay/debugging.
4. Add basic permission behavior if visual operations touch files.

Implementation notes:

- Keep events append-only.
- Return tool receipts that the chat can render.
- Do not let agents emit arbitrary React/component code.
- Validate event payloads with a shared schema before applying them.
- Resolve workspace/session from the current session. Do not accept arbitrary workspace IDs from the model.

Verification:

- Agent opens canvas from chat.
- Agent adds multiple notes.
- Chat stays active.
- Event replay restores surface.

## Phase 4: Media Outputs

Goal: generated images/videos display in chat and sidecar.

Tasks:

1. Connect visual surfaces to existing output records.
2. Add image viewer surface.
3. Add video player surface.
4. Add `add_image` to canvas.
5. Add chat receipt actions: Open, Focus, Send to canvas.

Implementation notes:

- Reuse `OutputManifest.kind` values `image` and `video`.
- Use `OutputPreview.mode` for renderer selection.
- Sidecar should accept output ID first, then resolve asset path through the output system.

Verification:

- Image output opens in sidecar.
- Video output plays in sidecar.
- Image can be placed on canvas.

## Phase 5: Additional Surface Types

Goal: extend the protocol without changing chat.

Candidates:

- charts
- browser surface
- workflow graph
- timeline
- ComfyUI board

Rule: add only after canvas/media prove the sidecar model.

## Recommended First PR

Build only Phase 1.

Files likely touched:

- `packages/shared/src/visual-surfaces/*`
- `apps/electron/src/renderer/atoms/visual-surfaces.ts`
- `apps/electron/src/renderer/components/visual-surfaces/VisualSurfacePanel.tsx`
- `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`
- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`

Do not add tldraw in the first PR unless the sidecar shell is already clean.

Definition of done:

- Visual sidecar can be opened from local UI state.
- Chat layout adapts across width buckets.
- Collapse/focus works.
- Placeholder receipt can focus the sidecar.
- Typecheck passes for touched packages.
- Manual UI smoke confirms the sidecar does not hide or cripple chat.

## Open Questions

These are not blockers for Phase 1. Initial decisions below should stand unless implementation disproves them.

- Should a session have one default visual surface or many named surfaces? Initial answer: many surfaces, with one active default.
- Should surfaces be workspace-level with optional session links, or strictly session-owned? Initial answer: workspace-level records with optional `sessionId`.
- Should agent visual commands require explicit permission in `safe` mode? Initial answer: current-session RunnerOS visual-state edits are allowed; exports, external generators, browser control, media moves, and workspace-file writes follow normal permission gates.
- Should generated media use the existing outputs system or a new artifact store? Initial answer: existing outputs system.

## Initial Decisions

- Use existing RunnerOS panel stack first.
- Use tldraw for first canvas.
- Treat generated media as outputs.
- Add CRDT/Yjs later.
- Keep chat primary.
