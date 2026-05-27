# Visual Agent OS Build Readiness

Status: draft
Owner: RunnerOS
Last updated: 2026-05-22

## Build Recommendation

Proceed with Phase 1 only.

Do not start with tldraw, ComfyUI, browser surfaces, chart surfaces, or FlexLayout. The first valuable proof is the responsive visual sidecar shell attached to chat.

## First PR Boundary

Build:

- shared type definitions
- renderer sidecar state
- `VisualSurfacePanel` placeholder
- adaptive width behavior
- collapse/focus controls
- synthetic chat receipt that focuses the sidecar

Do not build:

- agent-facing tools
- canvas persistence
- tldraw
- output/media resolver
- pop-out window
- new global dock layout

## Why This Is The Right First Cut

It proves the product interaction that matters most: chat stays primary while a live artifact appears beside it.

If the sidecar layout feels wrong, every later surface will feel wrong. Prove layout before adding engines.

## Required Pre-Implementation Checks

Before code:

1. Re-check current `git status`.
2. Avoid unrelated dirty files.
3. Inspect current panel stack behavior.
4. Confirm whether the sidecar should live inside the existing panel stack or beside it.
5. Confirm whether chat max-width logic already gives enough ultra-wide slack.

## Completion Gate For Phase 1

Phase 1 is done only when:

- sidecar opens without navigation
- chat input remains usable
- ultra-wide mode does not unnecessarily compress chat
- medium/narrow modes avoid cramped two-column layout
- collapse/focus controls work
- receipt can reopen/focus the sidecar
- typecheck passes for touched packages
- manual UI smoke confirms the layout

## Stop Conditions

Stop and regroup if:

- existing panel stack cannot support right-side sidecar without major rewrite
- chat layout has hidden width assumptions that make adaptive sidecar unsafe
- implementing Phase 1 requires broad router/session persistence changes
- any proposed change touches unrelated messaging/automation dirty work

