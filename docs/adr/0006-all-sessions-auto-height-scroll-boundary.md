# ADR 0006 — All Sessions Auto-height Scroll Boundary

**Date:** 2026-05-14  
**Status:** Accepted

## Context

The expanded **All Sessions** sidebar item embeds `SessionList` inside a parent that should shrink to the visible sessions when there are only a few items, but cap at `min(560px, calc(100vh-150px))` and scroll internally when there are many.

The existing session list layout was designed for fixed-height navigator surfaces: `SessionList` filled its parent and `EntityList`'s internal `ScrollArea` owned overflow. That works when an ancestor gives the list an explicit height, but it does not work for an auto-height sidebar section whose only vertical constraint is `max-height`. A flex child that claims `flex-1` cannot derive a useful fill height from a max-height-only parent.

## Decision

The All Sessions expanded content wrapper owns the scroll boundary. It uses natural height plus `max-height: min(560px, calc(100vh-150px))` and `overflow-y: auto`, with no fixed height and no minimum-height floor.

`SessionList` exposes `heightBehavior: 'fill' | 'auto'`:

- `fill` is the default and preserves the navigator behavior: the list fills its fixed-height parent and `EntityList`'s `ScrollArea` stretches.
- `auto` removes the fill-parent flex chain so the list renders at natural stacked height. The outer All Sessions wrapper handles overflow at the max-height cap.

## Consequences

- Workspaces with 0 or a few sessions no longer show dead whitespace below the embedded All Sessions list.
- Workspaces with many sessions still cap the All Sessions section and scroll the session rows without pushing lower sidebar items off screen.
- NavigatorPanel and other fixed-height `SessionList` consumers remain unchanged because they use the default `fill` behavior.
- The scroll boundary is intentionally outside `EntityList` for the All Sessions embed. Future changes should preserve that placement unless the parent gains an explicit height.
