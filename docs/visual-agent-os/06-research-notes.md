# Visual Agent OS Research Notes

Status: draft
Owner: RunnerOS
Last updated: 2026-05-22

## Source Summary

The direction is to integrate proven engines, not rebuild them.

## tldraw

Use for the first canvas surface.

Primary docs:

- https://tldraw.dev/sdk-features/persistence
- https://tldraw.dev/sdk-features/store
- https://tldraw.dev/sdk-features/assets

Useful facts from current tldraw docs:

- `persistenceKey` provides quick IndexedDB persistence for local documents.
- Custom persistence can use editor/store snapshots.
- Snapshots separate document state from session state.
- Assets support images, videos, and bookmarks.
- Asset handlers can upload/resolve files while records stay in the tldraw store.

RunnerOS decision:

- Use snapshots for workspace persistence.
- Use output-backed asset resolution for images/videos.
- Do not rely on browser-only IndexedDB as the canonical store.

## assistant-ui Artifacts

Use as UX reference only.

Primary docs/examples:

- https://www.assistant-ui.com/examples/artifacts
- https://www.assistant-ui.com/docs
- https://www.assistant-ui.com/docs/architecture

Useful facts:

- The artifacts example shows chat plus a live preview panel.
- The library is designed around composable React chat primitives and runtimes.

RunnerOS decision:

- Do not replace RunnerOS chat with assistant-ui.
- Borrow the product pattern: compact chat receipt plus side preview.

## FlexLayout / Docking

Use later only if needed.

Primary source:

- https://github.com/caplin/FlexLayout

Useful facts:

- FlexLayout supports React docked tabsets, resizing, and moving tabs.

RunnerOS decision:

- Defer it.
- Existing RunnerOS panel stack should prove the sidecar first.

## React Flow / XYFlow

Use for future workflow graphs, not the first canvas.

Primary docs:

- https://reactflow.dev/learn/getting-started/building-a-flow

Useful facts:

- React Flow models graphs as nodes, edges, and viewport.

RunnerOS decision:

- Use it when building workflow/automation graph surfaces.
- Do not force freeform canvas work into node graph primitives.

## TradingView Lightweight Charts

Use for chart surfaces later.

Primary docs:

- https://tradingview.github.io/lightweight-charts/

Useful facts:

- Lightweight Charts is an interactive financial charting library.
- It does not include market data.

RunnerOS decision:

- Treat chart surfaces as renderers over user/tool-provided data.
- Do not make charting a blocker for the canvas MVP.

## Stagehand

Use later for browser-agent surface work.

Primary source/docs:

- https://github.com/browserbase/stagehand
- https://docs.stagehand.dev/v3/references

Useful facts:

- Stagehand combines code-driven browser automation with AI-driven actions.
- It is useful when exact code is known for stable flows and AI is useful for unfamiliar pages.

RunnerOS decision:

- Keep browser surfaces later and separate from canvas/media surfaces.
- Do not let browser surfaces inherit auth/cookies implicitly without an explicit design.

## ComfyUI

Use later as an image/video generation backend.

Primary docs:

- https://docs.comfy.org/specs/workflow_json

Useful facts:

- ComfyUI workflows are JSON-schema-defined graphs.
- ComfyUI can run workflows through API-shaped JSON.

RunnerOS decision:

- Store ComfyUI results as RunnerOS outputs.
- Show generated media in the visual sidecar.
- Do not rebuild the ComfyUI node editor.
