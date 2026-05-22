# Phase 4: Media Outputs

## Goal

Make generated image and video Outputs feel native in the visual workflow: preview in the sidecar, send to Canvas, and let agents place media on the Canvas through the validated `visual_surface` tool.

## Current Ground Truth

Already present:

- Output records support `kind: image | video | audio`.
- Output previews support `mode: image | video | audio | web`.
- The sidecar can open output-backed visual surfaces.
- `OutputInlinePreview` can render image/video assets from safe Output asset RPCs.
- Canvas already persists output-backed cards through the visual-board Output.

Missing:

- Agent-facing media-specific Canvas actions.
- UI action to send a media Output to Canvas from Output detail.
- Media cards on Canvas still look like generic text output cards.
- Tests for media-only validation.

## User Outcome

- Image/video Outputs open in the sidecar visual surface.
- Image/video Outputs can be sent to the Canvas from Output detail.
- Agents can call `visual_surface` with `add_image` or `add_video` for same-session media Outputs.
- Canvas cards for image/video Outputs show an inline visual preview instead of only text.

## Scope

Implement four things:

1. Extend `visual_surface`
   - Add `add_image`.
   - Add `add_video`.
   - Both require `outputId`.
   - Both resolve workspace/session server-side.
   - Both persist as output-backed Canvas cards.

2. Validate media kind
   - `add_image` only accepts same-session `kind: image` Outputs.
   - `add_video` only accepts same-session `kind: video` Outputs.
   - Existing `pin_output` remains generic.

3. Add media-aware Canvas cards
   - Image card shows primary/preview asset inline.
   - Video card shows an inline playable video preview.
   - Missing/unreadable assets fall back to the existing output-card text state.

4. Add Output detail actions
   - `Focus` opens the Output in the visual sidecar.
   - `Send to Canvas` persists image/video Outputs to the current session Canvas.
   - Show a toast for success/failure.

## Non-Goals

- No drawing-on-image tools.
- No editing image pixels.
- No timeline/video trimming.
- No arbitrary external URL embedding beyond existing Output preview behavior.
- No chat message renderer redesign. Chat receipt actions can be a later phase once the message/action seam is explicit.

## Tool Contract

Existing:

```json
{ "action": "open_board" }
{ "action": "add_note", "title": "Draft angle", "body": "Use this image first." }
{ "action": "pin_output", "outputId": "..." }
```

New:

```json
{ "action": "add_image", "outputId": "..." }
{ "action": "add_video", "outputId": "..." }
```

Receipts:

- `Added image output ... to Canvas.`
- `Added video output ... to Canvas.`
- Duplicate media placement returns `Output ... was already on Canvas.`

## Data Model

No new board card type for Phase 4. Use the existing `VisualBoardOutputCard`:

```ts
{
  type: 'output',
  outputId: string,
  kind: 'image' | 'video' | ...
}
```

Rationale: this preserves board compatibility and lets future richer layouts evolve without a schema break.

## Security / Safety

- The model cannot supply `workspaceId` or `sessionId`.
- The server rejects cross-session media placement.
- The renderer reads media through `readOutputAssetDataUrl`, which already resolves assets through Output safe path validation.
- Raw filesystem paths are not sent to the renderer for preview.

## Verification

Automated:

- Shared event validation accepts `add_image` and `add_video`.
- Server rejects `add_image` for non-image output.
- Server rejects `add_video` for non-video output.
- Server rejects cross-session media.
- Duplicate media placement does not duplicate cards and returns accurate receipt.
- Session tool validates new actions.
- Electron typecheck and channel tests stay green.

Manual/UI:

- Open an image Output in sidecar.
- Send image Output to Canvas.
- Confirm Canvas card shows image preview.
- Open a video Output in sidecar and verify controls render.

## Stop Conditions

Stop before completion if:

- Existing safe Output asset RPC cannot preview local media reliably.
- Output detail cannot access the session ID needed to send to Canvas.
- Video preview requires a new local protocol/security exception.
