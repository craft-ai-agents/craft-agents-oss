# ADR 0016: Source-Level Refresh for Workspace MCP Pools

## Status

Accepted

## Context

ADR 0014 keeps MCP connections warm in a workspace-scoped pool so sessions can reuse HTTP connections and stdio subprocesses. That reuse creates a correctness risk when a skill-provided MCP source, source config, or manual refresh changes what a source should expose while the old workspace pool client is still connected.

## Decision

An MCP Source Refresh forces a source-level reconnect in the running workspace MCP pool, followed by tool rediscovery and active-session notification. Skill install/update, effective source config changes, and manual MCP Source detail-page refresh all converge on this source-level refresh path instead of requiring workspace close or app restart.

The pool keeps declarative `sync(...)` for normal reconciliation and effective config-change detection, including stdio `command`, `args`, and `env`. Manual refresh and skill-provided source updates use an explicit source-level refresh operation rather than forcing a reconnect indirectly through temporary sync inputs.

When a skill-provided MCP source duplicates an existing workspace source, the install/update path still refreshes the reused source slug. Duplicate detection means the skill reuses the workspace source; it does not mean the running pool can keep stale tool metadata.

## Consequences

Workspace MCP pools remain warm by default, but refresh correctness wins for the affected source slug. Refreshing one MCP source must not restart unrelated MCP sources in the same workspace.

Source-level refresh fails closed: the old client is disconnected before reconnect. If reconnect or tool discovery fails, stale cached tools are removed, active sessions are notified, and the source records the failed connection status instead of continuing to expose tools from the old process or config.

The source-level refresh operation returns a small structured result containing the source slug, success status, and either the discovered tool count or an error message. Skill install/update does not fail solely because a refreshed MCP source is temporarily unavailable.
