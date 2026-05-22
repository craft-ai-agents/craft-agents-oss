# Phase 2 Execution Spec

Status: ready for build
Owner: RunnerOS
Last updated: 2026-05-22

## Goal

Turn the Phase 1 Canvas shell into a real session-linked output viewer.

Phase 2 is complete when a session can show its durable generated outputs in the Canvas panel, reopen them after reload, and let the user toggle the viewer without losing chat usability.

## Scope

Build Phase 2A first.

In:

1. Use existing RunnerOS Outputs as the artifact source.
2. Load outputs where `manifest.origin.sessionId === current session`.
3. Open the most recent visual output from the Canvas button.
4. Render image, video, markdown/text/json, receipt, and external-link previews in the Canvas panel.
5. Show a compact output selector/list inside Canvas when a session has multiple outputs.
6. Keep the Phase 1 placeholder only when no session output exists.
7. Persist by relying on existing output manifests under `<workspaceRoot>/outputs/<outputId>/output.json`.

Out for Phase 2A:

1. tldraw editable canvas.
2. Agent visual operation protocol.
3. Arbitrary HTML/browser embedding.
4. Dragging images onto a canvas.
5. New output storage system.

## Existing System To Reuse

- Output types: `packages/shared/src/outputs/types.ts`
- Output persistence: `packages/shared/src/outputs/storage.ts`
- Output service: `packages/server-core/src/outputs/OutputService.ts`
- Session tool: `create_output`
- Renderer hook: `apps/electron/src/renderer/hooks/useOutputs.ts`
- Existing output preview logic: `apps/electron/src/renderer/pages/OutputDetailPage.tsx`
- Phase 1 Canvas shell:
  - `apps/electron/src/renderer/components/visual-surfaces/VisualSurfacePanel.tsx`
  - `apps/electron/src/renderer/components/visual-surfaces/VisualSurfaceToggle.tsx`
  - `apps/electron/src/renderer/atoms/visual-surfaces.ts`

## Data Model

Do not create a parallel visual-artifact store in Phase 2A.

Use:

- `OutputManifest.id` as the visual artifact ID.
- `OutputManifest.kind` as the visual kind.
- `OutputManifest.preview.mode` and primary asset MIME type to choose renderer.
- `OutputManifest.origin.sessionId` to bind outputs to chat sessions.

Extend renderer state only as needed:

```ts
activeSurface: {
  id: outputId or demo id
  workspaceId
  sessionId
  kind
  title
  status
  source: 'output' | 'demo'
  outputId?: string
}
```

## UX

Canvas button:

- Eye icon stays the single open/close control.
- Left click toggles Canvas.
- Right click keeps the mode menu.
- If the session has visual outputs, opening Canvas selects the newest one.
- If no outputs exist, opening Canvas shows the placeholder.

Canvas panel:

- Header title is always `Canvas`.
- No X/minimize buttons.
- Composer remains pinned.
- Roll-up fills the chat viewport above composer.
- Sidecar mode uses available wide-screen space.
- Show a small selector row only when there is more than one session output.

Preview priority:

1. Selected output primary asset.
2. `manifest.preview.inlineText`.
3. First asset.
4. Empty/unsupported state.

## Renderer Requirements

Add or adapt a preview component usable both by Output Detail and Canvas:

- `OutputInlinePreview` or equivalent.
- Supports:
  - image via `readFileDataUrl`
  - video via resolved data URL or safe local URL strategy
  - markdown/text/json via `readFile`
  - receipt/link summary
  - unsupported file fallback

Avoid duplicating unsafe path resolution in renderer. Use existing Output APIs where possible.

## Acceptance Criteria

1. Create or locate a session-linked output.
2. Canvas button opens Canvas.
3. Canvas displays that session output instead of the placeholder.
4. Multiple outputs can be selected inside Canvas.
5. Closing/reopening Canvas preserves the last selected output during the renderer session.
6. Reloading the app can rediscover the session outputs from existing manifests.
7. Roll-up does not move the composer out of frame.
8. Sidecar still works on wide screens.
9. No unrelated chat/session behavior regresses.

## Verification Plan

Required:

- `bun run typecheck:electron`
- targeted visual surface tests
- targeted output hook/preview tests if added
- touched-file ESLint
- `bun run electron:build:renderer`
- manual Electron smoke:
  1. open session
  2. create/use session-linked output
  3. open Canvas in roll-up
  4. switch Canvas mode to sidecar on wide window
  5. close/reopen Canvas
  6. reload app and confirm output returns

Optional if available:

- use `create_output` from a real session to generate a test output.

## Research Notes

No more broad research is needed for Phase 2A.

Web research already checked:

- tldraw React quick start and persistence docs.

Conclusion:

- tldraw is viable for Phase 2B.
- Do not add it in Phase 2A because RunnerOS already has an Outputs system that solves the immediate media/artifact path.

## Stop Conditions

Stop and ask before continuing if:

1. Existing Outputs APIs cannot resolve asset paths safely for Canvas preview.
2. Video preview requires a new local-file protocol or security decision.
3. `create_output` cannot reliably create session-linked outputs from normal agent runs.
4. The implementation would require changing output manifest schema in a breaking way.
5. Manual smoke shows Canvas still harms chat input usability.

## Next Phase

Phase 2B should add editable canvas only after Phase 2A is stable.

Likely Phase 2B scope:

- add `tldraw`
- create `canvas` output kind or `other` output tagged `visual-canvas`
- persist snapshots under output bundle
- add simple agent/user commands: create note, add image, export snapshot
