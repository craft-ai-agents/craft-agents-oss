# ADR 0005 — Permanent Wide Sidebar with All Sessions as Expandable Item

**Status:** Accepted

## Context

ADR 0004 moved the session list into **Sidebar Drill-Down Mode**: clicking `nav:allSessions` expanded the sidebar to ~300 px, replaced the icon strip with a Back button, and rendered `SessionList` inline. The icon strip (~40 px) was the default resting state.

This two-width model required dedicated layout logic (`resolveSidebarDrilldownLayout`, `isSidebarDrilldownMode`), a separate width-persistence key (`sessionListWidth` vs `sidebarWidth`), and a Back-button navigation stack that no other sidebar item used. The Right Sidebar and Editor Panel were gated behind the drill-down nav state rather than behind session activity, coupling layout to navigation.

## Decision

**Sidebar width:** The left sidebar is permanently at session-list width (~300 px). There is no narrow icon-strip mode. Nav items always show icons and labels. The `isSidebarDrilldownMode` flag and dual-width logic are removed.

**All Sessions:** `nav:allSessions` becomes a chevron-toggle expandable row. When expanded, the full `SessionList` component (search header, date groups, hover menus, multi-select) embeds inline below the row — no Back button, no separate panel. Expanded by default; state persisted per workspace.

**Navigator slot:** Sources, Skills, Automations, and Settings continue to open the NavigatorPanel additively to the right of the sidebar, unchanged.

**Right Sidebar and Editor Panel gate:** Both are now shown when a session is active, not when the sidebar is in a specific nav state.

## Alternatives considered

- **Keep drill-down mode, change interaction to chevron** — simpler change, but preserves the dual-width complexity and the nav-state gate on Right Sidebar.
- **Replace NavigatorPanel with in-place rendering inside the sidebar** — eliminates the additive slot but loses the side-by-side layout users are familiar with for Sources/Skills.

## Consequences

- `resolveSidebarDrilldownLayout`, `isSidebarDrilldownMode`, and the separate `sidebarWidth` persistence key can be removed.
- The Right Sidebar and Editor Panel decouple from nav state — they are available whenever a session is open, regardless of which sidebar item is selected.
- The sidebar always occupies ~300 px; narrower screen budgets must be handled by the existing auto-compact / hide-sidebar path.
- ADR 0004's drill-down decision is superseded by this ADR.
