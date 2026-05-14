# ADR 0006 — All Sessions Inline List: Scroll Boundary at the Outer Wrapper

**Status:** Accepted

## Context

The **All Sessions Nav Item** embeds a full `SessionList` inline below the chevron row. The session list uses a flex-1 chain (`SessionList → EntityList → ScrollArea`) that requires a parent with a defined height to scroll. Previously the wrapper supplied an explicit fixed height, which made `flex-1` resolve cleanly and let `ScrollArea` own the scroll viewport.

The desired UX is auto-height growth (container shrinks to fit few sessions) capped by `max-height`. A `max-height`-only parent does not give `flex-1` children a height to resolve against — they collapse to zero — so the internal `ScrollArea` cannot serve as the scroll boundary in this mode.

## Decision

The scroll boundary moves to the outer wrapper div in `AppShell`. The wrapper carries `max-h-[min(560px,calc(100vh-150px))] overflow-y-auto`. `SessionList` is given a `heightBehavior="auto"` prop that strips `flex-1` from its root div and disables the internal `ScrollArea` as a scroll container, letting items render at their natural stacked height. Overflow scrolls at the wrapper level.

The `heightBehavior="fill"` default preserves the existing flex-1 + internal-ScrollArea behavior for all other `SessionList` usages (NavigatorPanel, etc.).

## Considered Options

**Keep fixed explicit height, accept the whitespace floor** — simpler, no prop needed, no flex-chain change. Rejected: dead whitespace when a user has few sessions is the core UX problem this change addresses.

**Use a ResizeObserver to measure content height and set an explicit pixel height dynamically** — avoids the prop, keeps the flex chain intact. Rejected: adds JS measurement overhead and a layout-shift frame on every render; the CSS-only solution is more predictable.

## Consequences

The internal `ScrollArea` inside `EntityList` is bypassed for sidebar usage. A future reader will see `overflow-y-auto` on the outer wrapper and no explicit height on `SessionList`, and may wonder why the internal `ScrollArea` isn't doing the scrolling. The answer is that `flex-1` cannot resolve height from a `max-height`-only parent — the scroll boundary had to move up.
