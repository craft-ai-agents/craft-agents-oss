# Visual Agent OS Test Plan

Status: draft
Owner: RunnerOS
Last updated: 2026-05-22

## Test Strategy

Verify the feature as a user-visible sidecar, not just a data model.

Use three layers:

1. Type/unit tests for shared events and storage.
2. Renderer tests for layout state and receipts.
3. Manual RunnerOS smoke tests for real visual behavior.

## Unit Tests

### Shared Types / Storage

Target:

- `packages/shared/src/visual-surfaces`

Cases:

- creates valid surface manifest
- rejects malformed event payload
- rejects event payload with unexpected workspace/path fields from agent-facing calls
- appends event without deleting prior events
- lists surfaces by workspace
- filters surfaces by session
- handles missing/malformed manifest without crashing
- archives surface instead of hard-deleting by default

### Output Integration

Target:

- `packages/shared/src/outputs`
- visual-surface output resolver

Cases:

- resolves image output to previewable asset
- resolves video output to previewable asset
- handles missing primary asset
- handles unsupported preview mode

## Renderer Tests

Target:

- `VisualSurfacePanel`
- visual surface atom/hook
- chat receipt component

Cases:

- opens sidecar when active surface is set
- collapse hides panel without clearing surface
- focus from receipt reopens panel
- ultra-wide mode preserves chat max width
- medium mode uses roll-up above composer
- small mode keeps composer visible
- missing media renders error state

## Integration Tests

Target:

- session creates visual surface
- visual event bridge
- chat receipt rendering

Cases:

- applying `visual_surface.open` creates surface metadata
- applying `visual_surface.add_note` updates canvas event history
- applying `visual_surface.snapshot` writes/updates snapshot without bloating event history
- chat receipt points to correct surface ID
- reload restores active session surface
- agent tool cannot target another workspace by payload

## Manual Runner Smoke

Use `$runner` after the UI is implemented.

Smoke path:

1. Launch RunnerOS locally.
2. Open or create a chat session.
3. Trigger demo visual sidecar.
4. Resize app to ultra-wide, laptop, medium, and narrow widths.
5. Verify chat input remains usable.
6. Collapse and reopen visual sidecar.
7. Add image output if available.
8. Restart app and verify visual surface can reopen.

Pass criteria:

- no blank sidecar
- no hidden chat input
- no unrecoverable media error
- no lost surface after restart

## Regression Risks

- Existing chat layout gets cramped.
- Panel stack keyboard/focus behavior regresses.
- Session restore becomes slower due to visual state loading.
- Large media blocks renderer responsiveness.
- Output references break after moving workspace folders.
- Untrusted agent payload opens media/output from the wrong workspace.

## Required Checks By Phase

Phase 1:

- `bun run typecheck:electron`
- focused renderer tests if available
- manual width smoke

Phase 2:

- `bun run typecheck:electron`
- canvas persistence unit test
- manual restart smoke

Phase 3:

- shared event validation tests
- session event bridge tests
- permission-mode behavior smoke

Phase 4:

- output resolver tests
- image/video manual preview smoke
- missing-file smoke
