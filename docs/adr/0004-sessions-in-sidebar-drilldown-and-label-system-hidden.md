# ADR 0004 — Sessions in Sidebar Drill-Down, Label System Hidden

**Status:** Accepted

## Context

The session navigation previously used two separate surfaces: a `nav:allSessions` expandable item in the left sidebar (with status filter subitems: todo, in-progress, done, Flagged, Archived) and a NavigatorPanel that rendered the full `SessionList` as a separate middle panel. The label system provided a `nav:labels` sidebar section, inline `#` label assignment in the chat input, and a label filter dropdown in the NavigatorPanel header.

This two-surface session navigation added friction: users had to think about both the sidebar state filter subitems and the NavigatorPanel list. The label system added further complexity through the inline `#` trigger and filter dropdown, which were underused relative to the surface area they occupied.

## Decision

**Sessions:** Move the session list out of the NavigatorPanel and into the existing **Sidebar Drill-Down Mode**. Clicking `nav:allSessions` expands the sidebar to ~300 px and renders the `SessionList` inline, replacing the icon strip. No status filter subitems are shown in the sidebar; sessions are listed unfiltered. The filter dropdown (ListFilter button) in the NavigatorPanel header is removed. The NavigatorPanel continues to serve Sources, Skills, Automations, and Settings navigations unchanged.

**Archived:** Extracted to a top-level sidebar item. Clicking it activates the **Archived View**: an Archived Sessions Panel in the navigator slot alongside the Main Content Panel. The Right Sidebar is never shown in the Archived View. The sidebar stays in Icon Strip Mode (no drill-down).

**Flagged:** Removed from the sidebar entirely.

**Label system:** Hidden in full — `nav:labels` sidebar section, label subitems, label badges on session items, `InlineLabelMenu` (`#` trigger in chat input), `useInlineLabelMenu` hook, and the label filter section in the filter dropdown are all removed from the UI and their logic is dead-coded out.

## Alternatives considered

- **Keep NavigatorPanel for sessions with a simplified header** — fewer changes, but maintains the two-surface model and the unclear relationship between sidebar status items and the list panel.
- **Hide only the inline `#` menu, keep sidebar labels** — orphaned label badges on sessions with no assignment path would be confusing.

## Consequences

- Status-based filtering (todo/in-progress/done) is no longer accessible from the sidebar. Users can no longer navigate directly to a specific workflow state. If state filtering is re-introduced later, it would live inside the session list (e.g., as a toolbar within Sidebar Drill-Down Mode).
- The NavigatorPanel remains, but no longer renders the session list — its sessions-specific width persistence and resize handle are no longer needed for that case.
- Label data already stored on sessions is unaffected at the data layer; only the UI surfaces are hidden.
