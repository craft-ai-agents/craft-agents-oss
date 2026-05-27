# Visual Agent OS UX Spec

Status: draft
Owner: RunnerOS
Last updated: 2026-05-22

## UX Thesis

Do not make users leave chat.

The agent chat is the command center. Visual output appears as a live companion panel.

## Primary Flow

1. User asks agent to make something visual.
2. Agent starts normally in chat.
3. When visual work begins, a right-side panel opens automatically.
4. Chat narrows only as much as necessary.
5. Agent posts concise chat receipts while updating the visual panel.
6. User can keep chatting while watching the artifact evolve.

## Interaction Contract

The user should always know three things:

- what visual was created
- whether it is live/updating or static
- how to focus, collapse, or reopen it

## Layout Modes

### Ultra-Wide

Chat keeps its readable max width. Visual panel uses available empty space first.

Result: no cramped chat.

Expected behavior:

- Chat column remains near its normal max readable width.
- Sidecar opens in the unused right region.
- If the user manually widens the sidecar beyond slack space, then chat compresses.

### Wide

Split view.

Suggested default:

- Chat: 55-60%
- Visual: 40-45%

### Medium

Visual panel slides over from the right. Chat remains mostly intact.

Overlay must be dismissible by collapse button and Escape when focus is inside the sidecar.

### Small

Switch to tabs:

- Chat
- Visual

The active tab should follow user intent:

- agent opens visual -> switch to Visual once, with a clear return to Chat
- user sends a message -> Chat becomes active

## Sidecar Controls

MVP:

- collapse
- resize
- focus current visual
- reopen from chat/session receipt

Control placement:

- top-right of sidecar: collapse, more menu
- sidecar header: title, surface kind, live/static status
- resize handle: only in split/ultra-wide modes

Later:

- pop out window
- pin surface
- compare surfaces
- version history

## Chat Receipts

When a visual is created, chat should show a compact receipt:

```text
Canvas opened: Campaign Map
[Focus visual]
```

Receipt requirements:

- Receipts should be compact, not giant cards.
- Receipts should not interrupt streaming assistant text.
- Receipts should be clickable after restart if the surface still exists.

For generated media:

```text
Image generated: hero-concept-03.png
[Open] [Send to canvas]
```

For video:

```text
Video generated: launch-cut-v1.mp4
[Play] [Open in sidecar]
```

## Media Display

Generated images/videos should appear in both places:

- chat thumbnail/receipt
- sidecar full viewer or canvas object

Do not store media only as chat blobs. Store as outputs so agents, workflows, and visual surfaces can reference them later.

Media states:

- loading
- ready
- missing file
- unsupported codec/type
- generation failed

Missing/failed media should show a plain error with the output title and a retry/open-location action when available.

## Navigation

Add one app-level surface:

- `Workbench` or `Visuals`

But do not force users there during agent work. The primary entry point is automatic sidecar opening from chat.

Session-level entry points:

- chat receipt
- session info popover
- optional visual badge near active option badges
- future Workbench navigator

## Empty State

If a session has no visual surface:

```text
No visual surface yet.
Ask the agent to sketch, map, compare, generate, or visualize something.
```

## Design Direction

Use RunnerOS dark/glass styling, but keep visual surfaces clean. The canvas/media should be the focus, not decorative UI.

## Accessibility

- Collapse/focus controls need labels.
- Sidecar resize handle needs keyboard fallback or fixed presets.
- Canvas toolbar should remain reachable at narrow heights.
- Video player must expose native controls.
- Do not rely only on color to distinguish live/static/error states.
