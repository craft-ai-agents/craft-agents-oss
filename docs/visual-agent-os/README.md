# Visual Agent OS

Status: implemented through Phase 5C
Owner: RunnerOS
Last updated: 2026-05-23

## Purpose

Define the first shippable version of visual agent work inside RunnerOS: chat stays primary, and agents can open/update live visual sidecars for canvases, generated media, charts, browser views, and workflow maps.

## Docs

- [01 PRD](./01-prd.md)
- [02 Technical Spec](./02-technical-spec.md)
- [03 UX Spec](./03-ux-spec.md)
- [04 Implementation Plan](./04-implementation-plan.md)
- [05 Test Plan](./05-test-plan.md)
- [06 Research Notes](./06-research-notes.md)
- [07 Build Readiness](./07-build-readiness.md)
- [08 Phase 2 Execution Spec](./08-phase-2-execution-spec.md)
- [09 Phase 2B Web Preview Adapter Spec](./09-phase-2b-web-preview-adapter-spec.md)
- [10 Phase 2C Visual Board Spec](./10-phase-2c-visual-board-spec.md)
- [11 Phase 3 Agent Surface Events Spec](./11-phase-3-agent-surface-events-spec.md)
- [12 Phase 4 Media Outputs Spec](./12-phase-4-media-outputs-spec.md)
- [13 Phase 5A Adapter Registry Spec](./13-phase-5a-adapter-registry-spec.md)
- [14 Phase 5B Web Agent Awareness Spec](./14-phase-5b-web-agent-awareness-spec.md)
- [15 Phase 5C Agent Canvas Guidance Spec](./15-phase-5c-agent-canvas-guidance-spec.md)
- [16 Canvas Agent Smoke Prompts](./16-canvas-agent-smoke-prompts.md)
- [17 Chart Canvas Spec](./17-chart-canvas-spec.md)
- [18 Workflow Graph Canvas Spec](./18-workflow-graph-canvas-spec.md)

## Core Decision

Do not build a separate visual OS first. Build a native RunnerOS visual sidecar that attaches to existing sessions and agents.

First proof: an agent can open a right-side canvas while chat remains active, then add notes/images/shapes through structured events.

## MVP Definition

The MVP is complete when a normal RunnerOS chat session can:

1. Open a responsive right-side visual sidecar.
2. Persist a session-linked visual surface.
3. Render a basic canvas surface.
4. Show generated image/video outputs in the sidecar.
5. Reopen the same surface after restart.
6. Preserve chat usability across wide, medium, and narrow app widths.

## Current Build Status

- Phase 2 output-backed Canvas: implemented.
- Phase 2B local web preview adapter: implemented through Output preview policy and safe `runner-output://` HTML asset serving.
- Phase 2C visual board: implemented.
- Phase 3 agent surface events: implemented through `visual_surface`.
- Phase 4 media outputs: implemented, including media Canvas cards and sidecar add-to-board.
- Phase 5A adapter registry: implemented, including a local-web browser preview adapter.
- Phase 5B web agent awareness: implemented through `visual_surface_state`.
- Phase 5C agent guidance: implemented in the central system prompt and tool descriptions.
- Static chart outputs: implemented for `.chart.json`, `.vega.json`, and `.vegalite.json`.
- Workflow graph outputs: implemented for `.workflow.json` and `.workflow-run.json`.

Next intelligent slice: deeper browser-pane state reporting if agent inspection needs it, or provider-specific adapters.
