# Phase 5C: Agent Canvas Guidance

Status: implemented
Owner: RunnerOS
Last updated: 2026-05-23

## Goal

Teach all capable agents the same Canvas workflow without adding a custom `SKILL.md` to every agent.

Phase 5C is complete when agents know to create durable Outputs first, inspect Canvas state, and pin/open Canvas only when the visual surface helps the user.

## Product Rule

Canvas is a presentation and review surface, not a replacement for chat.

Agents should use Canvas when the user benefits from seeing an artifact beside the conversation: generated images, videos, local web previews, reports, JSON/data previews, receipts, links, or comparison boards.

Browser Pane is the inspection surface. Agents should use Browser Pane or browser tools when the user asks to test, debug, inspect, click through, check console logs, verify layout, capture screenshots, or interact with live web behavior.

If the user's intent is ambiguous, agents should default to Canvas for viewing and ask before launching Browser Pane.

## Agent Workflow

1. Create or identify the durable Output.
2. Read `visual_surface_state` to avoid duplicates and understand what is already visible.
3. Use `visual_surface` to open the board or pin the Output when useful.
4. Tell the user briefly what was placed on Canvas.

## Non-Goals

- No per-agent duplicated Canvas skill.
- No tool-specific Canva/Excalidraw/TradingView contracts yet.
- No claim that Canvas iframe previews expose DOM, console logs, or live app state.
- No automatic Canvas card for every chat answer.
- No automatic Browser Pane launch for simple "show me" viewing requests.

## Implementation

- Add shared Canvas guidance to the central system prompt.
- Tighten `create_output` and `visual_surface` descriptions so agents understand the order of operations.
- Keep specialist agents free to add stronger visual habits later, but the base behavior lives in platform guidance.

## Phase 5C.2: Shared Agent Integration

### Goal

Make Canvas behavior available to every agent without hand-editing every agent file, while giving intentionally visual agents a stronger default.

### Product Shape

All spawned agents are Canvas-aware:

- They know Canvas is the in-chat viewer for durable Outputs.
- When the user asks to show, preview, view, compare, or present an artifact, they should create or reuse an Output and pin/display it in Canvas.
- They should not use Canvas as a substitute for chat.
- They should avoid duplicate Canvas cards when an Output is already visible.

Agents marked `visualAgent: true` are Canvas-proactive:

- They should create durable Outputs for visual/web/media/document deliverables without needing a second user prompt.
- They should pin/display the primary artifact in Canvas.
- They should treat Canvas screenshot feedback as visual QA and make at most one focused fix per artifact version/open.
- They should still ask before risky external launches or broad rewrites.

### UX

Agent create/edit gets one plain toggle:

`Visual agent`

Helper copy:

`Automatically uses Canvas for visual, web, media, and document outputs.`

The toggle writes `visualAgent: true` into `AGENT.md` frontmatter only when enabled. Disabled/blank omits the field.

### Technical Contract

- Add `visualAgent?: boolean` to `AgentMetadata`.
- Parse boolean frontmatter from `AGENT.md`.
- Serialize `visualAgent: true` only when enabled.
- Add a reusable Canvas guidance section in the runtime prompt composer.
- Always inject lightweight Canvas-aware guidance for spawned agents.
- Add the stronger proactive paragraph only when `metadata.visualAgent === true`.
- Include `visualAgent` in HNIC/agent catalog metadata so routing can prefer visual agents when relevant.

### Non-Goals

- No custom Canvas `SKILL.md` per agent.
- No automatic Canvas use for every text answer.
- No special integrations for Canva, Excalidraw, TradingView, or other tool-specific adapters in this slice.
- No automatic external browser launch.

### Acceptance Tests

1. Agent metadata parser preserves `visualAgent: true`.
2. Serializer emits `visualAgent: true` when enabled and omits it when disabled.
3. Runtime prompt composer always includes the base Canvas-aware guidance.
4. Runtime prompt composer includes proactive Canvas guidance only for `visualAgent: true`.
5. Agent create/edit UI can save and reload the toggle.
6. Typecheck/build remains green.

## Verification

- Prompt test confirms the central system prompt includes the shared Canvas workflow.
- Tool definition tests/typecheck confirm session tools still compile.

## Phase 5C.3: Publishing Rules

Status: implemented on 2026-05-25.

Task list:

1. Tell agents exactly when to set `showInCanvas: true`.
2. Teach the preferred Canvas-native output format for each artifact class.
3. Keep Browser Pane as the route for console, DOM, click, screenshot, and live inspection work.
4. Avoid duplicate cards by checking `visual_surface_state` before pinning existing Outputs.

Format rules:

- Images: PNG/JPG/WebP/SVG primary file.
- Video/audio: MP4/WebM/MOV or audio primary file.
- Local/generated web: HTML primary file or a local localhost link; the Output system infers the Canvas web preview.
- Markdown/report: Markdown Output.
- Data/table: CSV/TSV first; JSON when structure matters.
- Charts: `.chart.json` with `type`, `title`, and `data`.
- Workflow maps: `.workflow.json` with `title` and `nodes`.
- Slide decks: HTML preview first, PPTX/PDF exports as supporting files.
- External services: link or receipt Output first, then attach exported image/PDF/video/HTML previews when available.
