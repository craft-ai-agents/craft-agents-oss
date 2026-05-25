# Visual Agent OS PRD

Status: draft
Owner: RunnerOS
Last updated: 2026-05-22

## Problem

RunnerOS agents currently work mainly through chat and text/tool transcripts. That is strong for execution, but weak for visual work: planning maps, generated images, videos, chart views, browser screenshots, comparisons, and evolving artifacts are hard to inspect inside a linear chat.

Users should not have to leave the agent chat to inspect what the agent is creating.

## Goal

Create a visual sidecar experience where an agent can produce and update live visual artifacts beside chat.

The chat remains the command center. The visual panel is the live work surface.

## Jobs To Be Done

- When an agent creates a visual plan, I want to inspect the map while still giving instructions in chat.
- When an agent generates media, I want full-size previews without digging through attachments.
- When an agent compares versions, I want the visual differences side by side instead of buried in prose.
- When a session creates a useful artifact, I want to reopen it later from the same session.

## Non-Goals

- Do not replace the current chat UI.
- Do not rebuild tldraw, Excalidraw, chart engines, browser runtimes, or ComfyUI.
- Do not add multiplayer CRDT collaboration in the MVP.
- Do not add a full docking framework until the existing RunnerOS panel stack proves insufficient.

## Target User

A user running an agent that needs to create, inspect, compare, or iterate on visual output:

- content maps
- landing page structures
- campaign boards
- workflow diagrams
- image generations
- video generations
- screenshots and browser states
- trading or metrics charts

## MVP

Agent-triggered visual sidecar:

1. User chats with an agent.
2. Agent emits a structured visual surface event.
3. RunnerOS opens a right-side visual panel.
4. Chat remains active and resizes intelligently.
5. Agent adds canvas objects or media previews live.
6. User can collapse, resize, or focus the visual panel.

### MVP In Scope

- Session-linked visual surface metadata.
- Responsive right-side visual panel.
- Canvas surface backed by tldraw.
- Image/video sidecar preview using existing output manifests.
- Chat receipts that focus/reopen the active visual.
- Basic agent-facing visual commands.

### MVP Out Of Scope

- Multi-user collaboration.
- GoldenLayout/FlexLayout migration.
- Full browser automation surface.
- ComfyUI node editor.
- Workflow graph editor.
- Cloud sync.

## Success Criteria

- A session can own one or more visual surfaces.
- An agent can open/focus a surface without user navigation.
- Chat remains usable while the visual panel is open.
- Generated images and videos can appear as durable outputs in the sidecar.
- Visual artifacts survive app restart.
- Users can reopen the visual surface from the session.
- The sidecar never makes the chat input unusable.
- Missing media files show a recoverable error state, not a blank panel.
- Visual operations are observable in the session transcript or receipt history.

## Acceptance Criteria

### Layout

- On ultra-wide windows, opening the sidecar uses unused horizontal space first.
- On laptop-width windows, chat and sidecar split without hiding the input.
- On narrow windows, visual content is reachable through a tab or overlay instead of cramped columns.

### Persistence

- Surface metadata survives app restart.
- Canvas state survives app restart.
- Output references still resolve after session reload.

### Agent Use

- An agent can request a surface open.
- An agent can add at least one note to a canvas.
- An agent can attach an existing image output to a surface.

### User Control

- User can collapse the visual panel.
- User can reopen it from a chat receipt or session-level control.
- User can continue sending chat messages while the visual is open.

## Product Principles

- Chat is the control plane.
- Visuals are artifacts, not a separate mode.
- Use existing engines where possible.
- Persist outputs as files/records, not transient chat blobs.
- Start with one excellent sidecar before adding many surface types.

## First Surface

tldraw canvas.

Reason: it gives infinite canvas, shapes, images, embeds, selection, zoom, and a strong React integration without RunnerOS rebuilding canvas logic.

## Product Risks

- If the sidecar is too aggressive, it will make chat worse. Adaptive width rules are required.
- If media is stored only in chat messages, future agents/workflows cannot reuse it. Use output manifests.
- If agent visual commands are raw UI mutations, future browser/chart/canvas surfaces will diverge. Use a shared event protocol.
- If docking is overbuilt first, the project will stall before proving the agent visual loop.

## Future Surfaces

- Image viewer
- Video player
- Chart panel
- Browser surface
- Workflow graph
- Timeline
- ComfyUI generation board
