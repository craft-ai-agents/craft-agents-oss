# Phase 5C: Agent Canvas Guidance

Status: implemented
Owner: RunnerOS
Last updated: 2026-05-22

## Goal

Teach all capable agents the same Canvas workflow without adding a custom `SKILL.md` to every agent.

Phase 5C is complete when agents know to create durable Outputs first, inspect Canvas state, and pin/open Canvas only when the visual surface helps the user.

## Product Rule

Canvas is a presentation and review surface, not a replacement for chat.

Agents should use Canvas when the user benefits from seeing an artifact beside the conversation: generated images, videos, local web previews, reports, JSON/data previews, receipts, links, or comparison boards.

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

## Implementation

- Add shared Canvas guidance to the central system prompt.
- Tighten `create_output` and `visual_surface` descriptions so agents understand the order of operations.
- Keep specialist agents free to add stronger visual habits later, but the base behavior lives in platform guidance.

## Verification

- Prompt test confirms the central system prompt includes the shared Canvas workflow.
- Tool definition tests/typecheck confirm session tools still compile.
