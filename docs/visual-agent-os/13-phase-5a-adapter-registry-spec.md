# Phase 5A: Visual Surface Adapter Registry

## Goal

Add one clean adapter layer for non-media visual surfaces so RunnerOS can support browser views, charts, workflow maps, Excalidraw/Canva-style artifacts, and TradingView-like charts without hardcoding each integration into the Canvas component.

Phase 5A is complete when the sidecar chooses a renderer through a typed adapter registry instead of ad hoc `kind` checks, and unsupported future surface types fail with a clear fallback.

## Why This First

Phase 4 proved the sidecar model with Output-backed media. The next risk is integration sprawl: every external tool could otherwise add its own button, preview path, event shape, and persistence rules.

The adapter registry creates the shared slot first. Specific tools can then plug into it later.

## Current Ground Truth

Already present:

- `VisualSurfaceKind` includes `canvas`, `document`, `image`, `video`, `audio`, `chart`, `browser`, `workflow`, and `output`.
- Output manifests support preview modes for `image`, `video`, `audio`, `web`, `external-link`, `markdown`, `text`, `json`, `receipt`, and table-like data.
- The sidecar can open:
  - session Canvas boards
  - Output-backed previews
  - local web previews through existing Output preview policy
- Browser-pane infrastructure already exists elsewhere in the app.

Missing:

- One registry that maps `VisualSurfaceKind` / `OutputPreview.mode` to the correct sidecar renderer.
- A stable adapter interface for future tools.
- Capability flags for whether a surface can be inspected, refreshed, opened externally, sent to Canvas, or controlled by an agent.
- A single unsupported-surface fallback.

## User Outcome

- The user opens the same Canvas button regardless of surface type.
- The sidecar picks the right renderer automatically.
- Future tool outputs can say "I am a chart/browser/workflow/excalidraw surface" without changing chat layout.
- Unsupported surfaces show a clear "not supported yet" state, not a blank panel.

## Phase 5A Scope

Implement the registry only. Keep the first pass small.

1. Create a renderer registry
   - Input: active visual surface plus selected Output manifest when applicable.
   - Output: React renderer component and capability metadata.
   - Registry lives near `apps/electron/src/renderer/components/visual-surfaces/`.

2. Move existing render choices into adapters
   - Canvas board adapter.
   - Output preview adapter.
   - Placeholder/unsupported adapter.

3. Add adapter capability metadata
   - `canRefresh`
   - `canOpenExternal`
   - `canSendToCanvas`
   - `canInspect`
   - `agentControllable`

4. Add adapter tests
   - `canvas` resolves to board adapter.
   - `image` / `video` / `document` output surfaces resolve to output preview adapter.
   - `browser`, `chart`, `workflow`, or unknown future kinds fall back safely until implemented.

5. Keep existing behavior
   - Canvas board still opens and persists.
   - Output previews still render through `OutputInlinePreview`.
   - Media Canvas cards still lazy/opt-in load.

## Out Of Scope

- No new Canva integration.
- No new Excalidraw/tldraw editor.
- No TradingView control surface.
- No browser-pane embedding inside sidecar yet.
- No agent tool expansion beyond current `visual_surface` actions.
- No custom protocol changes.

## Adapter Contract

Suggested shape:

```ts
export interface VisualSurfaceAdapterContext {
  workspaceId: string
  sessionId?: string
  surface: VisualSurface
  selectedOutputId?: string
  selectedManifest?: OutputManifestDTO | null
  sessionOutputs: OutputSummaryDTO[]
}

export interface VisualSurfaceAdapter {
  id: string
  label: string
  kinds: VisualSurfaceKind[]
  capabilities: {
    canRefresh: boolean
    canOpenExternal: boolean
    canSendToCanvas: boolean
    canInspect: boolean
    agentControllable: boolean
  }
  canRender(context: VisualSurfaceAdapterContext): boolean
  render(context: VisualSurfaceAdapterContext): React.ReactNode
}
```

## Integration Rules

- Adapters must not read files directly in the renderer.
- Adapters must use existing IPC/safe Output APIs.
- Agent-controlled surfaces must be backed by persisted Outputs or visual events.
- External tool adapters must declare what is visible to the agent:
  - preview only
  - console/network inspectable
  - editable
  - controllable
- If an adapter depends on an external connector, the UI must show a setup/fallback state.

## Future Adapter Priority

After Phase 5A:

1. Browser surface adapter
   - Reuse existing browser-pane primitives.
   - Local URLs only by default.
   - Expose console/network awareness only through existing browser tooling, not passive sidecar magic.

2. Chart adapter
   - Start with static chart Outputs before live TradingView control.
   - TradingView later becomes a provider-specific adapter.

3. Workflow graph adapter
   - Read existing workflow metadata and render a non-editable graph.

4. Excalidraw/tldraw adapter
   - Only after the registry proves stable.
   - Persist snapshots as Outputs.

5. Canva adapter
   - Treat Canva as an external design Output/link first.
   - Native editing depends on Canva connector capabilities and auth.

## Verification

Automated:

- Adapter resolution unit tests.
- Existing visual sidecar atom tests.
- Existing Output preview tests.
- Electron typecheck.
- Renderer build.

Manual:

- Open Canvas from chat.
- Open image/video/document Output sidecar.
- Open a fake unsupported `chart` or `browser` surface and confirm clear fallback.
- Confirm chat composer remains usable in sidecar and rollup modes.

## Stop Conditions

Stop before coding provider-specific adapters if:

- The registry requires changing persisted `VisualSurface` shape.
- Existing Canvas or Output preview behavior regresses.
- Browser/TradingView/Canva support would require credentials or connector behavior not currently available.
- A custom protocol is required before generated HTML/browser-like assets can be safely rendered.
