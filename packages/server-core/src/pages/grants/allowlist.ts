/**
 * Trusted read-only tool allowlist (ADR 0001, WS7).
 *
 * A grant naming a tool is NOT sufficient authorization. MCP tool names and
 * `readOnlyHint` annotations are supplied by the MCP server itself, so a
 * compromised or careless server can claim a mutating tool is read-only. The
 * allowlist is therefore curated by us, per source kind, and consulted twice:
 * once when a grant is approved, and again on every execution — a tool can be
 * removed from this list after a grant was already issued.
 *
 * Curated, never inferred. A tool called `list_everything` is not trusted
 * because of its name; it is trusted because someone checked what it does and
 * added it here.
 */

/**
 * Source slug → tool names known to be read-only.
 *
 * Keep entries narrow. Anything that writes, sends, deletes, moves, labels, or
 * triggers a side effect on the remote service does not belong here, no matter
 * how convenient it would be for a dashboard.
 */
const TRUSTED_READ_ONLY: Record<string, ReadonlySet<string>> = {
  gmail: new Set([
    'list_messages',
    'get_message',
    'list_labels',
    'list_threads',
    'get_thread',
  ]),
  'google-calendar': new Set([
    'list_events',
    'get_event',
    'list_calendars',
  ]),
  linear: new Set([
    'list_issues',
    'get_issue',
    'list_projects',
    'list_teams',
  ]),
  github: new Set([
    'list_issues',
    'get_issue',
    'list_pull_requests',
    'get_pull_request',
    'list_repositories',
  ]),
  slack: new Set([
    'list_channels',
    'get_channel_history',
    'list_users',
  ]),
}

/** Is this (source, tool) pair on the curated read-only allowlist? */
export function isTrustedReadOnlyTool(sourceSlug: string, toolName: string): boolean {
  return TRUSTED_READ_ONLY[sourceSlug]?.has(toolName) ?? false
}

/** Tools a given source may expose to pages. Used by the approval UI. */
export function trustedToolsForSource(sourceSlug: string): string[] {
  return [...(TRUSTED_READ_ONLY[sourceSlug] ?? [])].sort()
}

/** Sources that can back a page query at all. */
export function sourcesWithTrustedTools(): string[] {
  return Object.keys(TRUSTED_READ_ONLY).sort()
}
