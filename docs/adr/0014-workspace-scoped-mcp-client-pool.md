# ADR 0014: Workspace-Scoped MCP Client Pool

## Status

Accepted

## Context

MCP source connections used to be tied to individual sessions. Switching sessions in the same workspace, creating a new session with the same sources, or re-enabling a source mid-session could force the app to reconnect to every enabled MCP source. For HTTP transports this repeated network and OAuth setup; for stdio transports it spawned duplicate subprocesses.

The visible result was avoidable latency before tools became available, plus unnecessary subprocess and connection churn while multiple sessions in the same workspace were open.

## Decision

Each workspace owns one `McpClientPool` for its MCP source connections. The pool is initialized when workspace infrastructure starts, syncs against all usable MCP sources configured in that workspace, and stays alive until the workspace is closed.

Sessions do not own MCP source connections. A session owns only its bridge to the active agent, such as `McpPoolServer`, and registers a tool-change listener while that bridge exists. Tool exposure remains session-scoped by filtering the workspace pool's tools through the session's enabled source slugs.

Per-call session state is passed at call time. `McpClientPool.callTool()` receives `sessionPath` and `summarize` options from the active session so binary files, long-response artifacts, and summaries are routed to the correct session.

API sources remain per-session. Their in-process servers capture session-specific response handling at construction time, so moving them into the workspace pool would mix session output paths and summarization contexts.

## Consequences

MCP HTTP connections and stdio subprocesses are reused across sessions in the same workspace. Closing all sessions does not tear down the workspace pool, so reopening a session can reuse warm connections.

Workspace source changes and token refreshes sync the workspace pool once, and active sessions are notified through their registered listeners. Reconnection after an MCP config change, including refreshed auth headers, happens inside pool sync.

The workspace pool is not an authorization boundary. It may hold connected sources that a given session has not enabled, but session bridges expose only tools whose slugs are enabled for that session.

Workspace shutdown must disconnect the pool and remove the workspace token-refresh manager to avoid leaking MCP subprocesses or HTTP connections.
