# Visual Agent OS Technical Spec

Status: draft
Owner: RunnerOS
Last updated: 2026-05-22

## Current RunnerOS Integration Points

- Main route rendering: `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`
- Chat rendering: `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`
- Agent launch: `apps/electron/src/renderer/lib/run-agent.ts`
- Session runtime: `packages/server-core/src/sessions/SessionManager.ts`
- Session persistence types: `packages/shared/src/sessions/types.ts`
- Output system: `packages/shared/src/outputs`
- Output media types already include `image` and `video` in `packages/shared/src/outputs/types.ts`.

## Proposed Concept

Add a session-scoped visual surface system.

Surface = durable visual artifact attached to a workspace/session.

Examples:

- `canvas`
- `image`
- `video`
- `chart`
- `browser`
- `workflow`

## Data Model

New shared package area:

`packages/shared/src/visual-surfaces/`

Core types:

```ts
export type VisualSurfaceKind =
  | 'canvas'
  | 'image'
  | 'video'
  | 'chart'
  | 'browser'
  | 'workflow'

export interface VisualSurface {
  id: string
  workspaceId: string
  sessionId?: string
  kind: VisualSurfaceKind
  title: string
  status: 'active' | 'archived' | 'failed'
  createdAt: number
  updatedAt: number
  statePath?: string
  outputIds?: string[]
  bounds?: VisualSurfaceBounds
  metadata?: Record<string, unknown>
}

export interface VisualSurfaceBounds {
  width?: number
  height?: number
  preferredPanelWidth?: number
}
```

Manifest shape:

```ts
export interface VisualSurfaceManifest {
  schemaVersion: 1
  surface: VisualSurface
  events: VisualSurfaceEventRecord[]
}

export interface VisualSurfaceEventRecord {
  id: string
  timestamp: number
  actor: 'user' | 'agent' | 'system'
  event: VisualSurfaceEvent
}
```

## Event Protocol

Agents and runtime code should talk to the visual layer through structured events, not direct UI calls.

Initial event names:

```ts
type VisualSurfaceEvent =
  | { type: 'visual_surface.open'; sessionId?: string; kind: VisualSurfaceKind; title?: string }
  | { type: 'visual_surface.focus'; surfaceId: string }
  | { type: 'visual_surface.add_note'; surfaceId: string; text: string; x?: number; y?: number }
  | { type: 'visual_surface.add_image'; surfaceId: string; outputId: string; x?: number; y?: number }
  | { type: 'visual_surface.add_video'; surfaceId: string; outputId: string }
  | { type: 'visual_surface.snapshot'; surfaceId: string }
```

Rules:

- Events must be JSON-serializable.
- Events must be append-only for audit/debug.
- Renderer may derive UI state from events, but persisted manifest is the source of truth.
- File/media references should use `outputId` when possible, not raw absolute paths.
- Agent-facing tools must not accept `workspaceId` from the model. Server/runtime resolves workspace and session from the current session context.
- Event payloads must be validated before storage and before renderer application.

Event history boundary:

- Semantic agent/user operations are stored in `events`.
- High-volume canvas internals are stored as a canvas snapshot.
- Do not append every tldraw pointer move, selection change, or drag delta as a surface event.
- A `visual_surface.snapshot` event records that a snapshot was taken; the snapshot file contains the full canvas state.

## Renderer Behavior

Add `VisualSurfacePanel`.

Responsibilities:

- render the active surface
- adapt layout based on width
- show canvas/media/chart views
- persist local UI state such as collapsed/resized
- allow focus/collapse/pop-out later

Suggested files:

- `apps/electron/src/renderer/atoms/visual-surfaces.ts`
- `apps/electron/src/renderer/components/visual-surfaces/VisualSurfacePanel.tsx`
- `apps/electron/src/renderer/components/visual-surfaces/CanvasSurface.tsx`
- `apps/electron/src/renderer/components/visual-surfaces/MediaSurface.tsx`
- `apps/electron/src/renderer/hooks/useVisualSurfaces.ts`

Server/runtime files likely needed:

- `packages/shared/src/visual-surfaces/types.ts`
- `packages/shared/src/visual-surfaces/storage.ts`
- `packages/shared/src/visual-surfaces/validation.ts`
- `packages/server-core/src/handlers/rpc/visual-surfaces.ts`
- `packages/shared/src/protocol/channels.ts` or adjacent protocol registry

## Adaptive Layout Rules

Use app/container width, not fixed split.

```ts
if (width >= 1600) mode = 'sidecar-no-chat-compression'
else if (width >= 1150) mode = 'split'
else mode = 'rollup'
```

## Persistence

Store surface metadata under workspace storage.

Suggested path:

`<workspaceRoot>/visual-surfaces/<surfaceId>/surface.json`

Canvas state:

`<workspaceRoot>/visual-surfaces/<surfaceId>/canvas.json`

Media files should remain in the existing outputs/session attachment storage where possible. Surface records reference output IDs or file paths.

Storage API candidates:

```ts
listVisualSurfaces(workspaceRootPath: string, sessionId?: string): Promise<VisualSurface[]>
getVisualSurface(workspaceRootPath: string, surfaceId: string): Promise<VisualSurfaceManifest | null>
applyVisualSurfaceEvent(workspaceRootPath: string, event: VisualSurfaceEvent, actor: VisualSurfaceEventRecord['actor']): Promise<VisualSurfaceManifest>
archiveVisualSurface(workspaceRootPath: string, surfaceId: string): Promise<boolean>
```

Do not put large binary media into `surface.json`. Store files through outputs/assets and reference them.

Deletion policy:

- MVP archives surfaces instead of hard-deleting files.
- Hard delete can be added later with explicit confirmation and tests.

## Agent Tooling

MVP should expose a session-scoped tool or internal command:

- `visual_surface_open`
- `visual_surface_add_note`
- `visual_surface_add_image`
- `visual_surface_snapshot`

This can later become a richer MCP-like surface protocol.

Tool behavior:

- Tool calls should return a compact receipt with `surfaceId`, `title`, and `action`.
- In `safe` permission mode, visual operations are allowed only when they mutate RunnerOS-owned visual state for the current session.
- Exporting files, moving media, invoking external generators, browser control, or touching workspace project files must follow existing permission rules.
- The tool resolves workspace/session server-side; the model cannot choose arbitrary workspace paths.
- Tool errors must be visible in chat and should not leave a half-open blank panel.

Suggested tool boundary:

```ts
visual_surface_open({ kind, title })
visual_surface_add_note({ surfaceId, text, x, y })
visual_surface_add_output({ surfaceId, outputId, x, y })
visual_surface_snapshot({ surfaceId })
```

The tool layer returns receipts; renderer decides how to present them.

## Dependencies

MVP:

- `tldraw`

Later:

- `@xyflow/react`
- TradingView Lightweight Charts
- Playwright/Stagehand browser surface
- ComfyUI API integration
- Yjs

Current research notes:

- tldraw supports editor snapshots for custom persistence and `persistenceKey` for IndexedDB-backed local persistence.
- tldraw assets support image, video, and bookmark records with upload/resolve handlers.
- assistant-ui artifacts are a useful UX reference for chat plus live preview panel, not a dependency recommendation.
- FlexLayout is a real docking option, but should be deferred until the native panel-stack sidecar proves insufficient.

## Risk

Biggest risk is adding a new layout framework too early. Use existing RunnerOS panel stack first. Add FlexLayout only if current panels cannot support the sidecar behavior.

## Migration Strategy

No migration required for Phase 1.

Phase 2 introduces a new optional `visual-surfaces/` workspace folder. Existing sessions keep working without it.

If a surface manifest is malformed:

- skip it in list views
- log a warning
- show a recoverable "surface unavailable" message when directly opened

## Security / Safety

- Never render arbitrary HTML in the sidecar for MVP.
- Video/image previews must use local file URLs or app-safe asset handlers.
- Browser surfaces must not share cookies/session state implicitly until designed.
- ComfyUI integration must treat workflows as untrusted input and require explicit local/server connection setup.
- Agent-provided titles/text should be treated as untrusted display text and escaped normally.
- Output IDs must be checked against the current workspace before rendering.
