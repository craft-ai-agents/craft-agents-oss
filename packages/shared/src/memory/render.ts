/**
 * Canonical rendering of memory entries into the agent's runtime system
 * prompt.
 *
 * Lives in `@craft-agent/shared` because BOTH the renderer-spawned chat
 * path (apps/electron/src/renderer/lib/compose-agent-prompt.ts) and the
 * server-spawned workflow path (packages/server-core/src/sessions/SessionManager.ts)
 * inject memory, and the format MUST match — otherwise the same agent
 * sees different prompt shapes depending on origin and the LLM behaves
 * inconsistently.
 *
 * Both render sites import from this file. Do not fork.
 */

import type { MemoryEntry } from './types.ts';

export const USER_MEMORY_HEADER = 'USER.md — durable user memory:';
export const AGENT_MEMORY_HEADER = 'MEMORY.md — durable memory for this agent:';

export interface MemorySectionOptions {
  /**
   * Date used to filter entries by `expires`. Defaults to today.
   * Override only in tests.
   */
  now?: Date;
}

/**
 * Filter memory entries to those that should appear in a prompt right
 * now: non-empty body + name, and not past their expiry date.
 *
 * Returning a fresh array — never mutating the input.
 */
export function selectActiveMemoryEntries(
  entries: ReadonlyArray<MemoryEntry>,
  opts: MemorySectionOptions = {},
): MemoryEntry[] {
  const today = (opts.now ?? new Date()).toISOString().slice(0, 10);
  return entries.filter((entry) => {
    if (!entry.name.trim() || !entry.body.trim()) return false;
    if (entry.expires && entry.expires < today) return false;
    return true;
  });
}

function formatEntry(entry: MemoryEntry): string {
  const meta = [
    `type: ${entry.type}`,
    entry.expires ? `expires: ${entry.expires}` : undefined,
  ]
    .filter(Boolean)
    .join(' | ');
  return `## ${entry.name.trim()}\n${meta}\n\n${entry.body.trim()}`;
}

/**
 * Render one memory section (USER or AGENT) given an already-filtered
 * list of entries. Returns an empty string when there's nothing to
 * inject.
 */
export function buildMemoryEntrySection(header: string, entries: ReadonlyArray<MemoryEntry>): string {
  if (entries.length === 0) return '';
  return `${header}\n\n${entries.map(formatEntry).join('\n\n')}`;
}

/**
 * Render both memory sections from raw (unfiltered) entry arrays.
 * Filters expires + empties internally so callers can't accidentally
 * skip the filter.
 *
 * Returns an empty string when both sections would be empty.
 */
export function buildMemorySectionsText(
  userEntries: ReadonlyArray<MemoryEntry>,
  agentEntries: ReadonlyArray<MemoryEntry>,
  opts: MemorySectionOptions = {},
): string {
  const activeUser = selectActiveMemoryEntries(userEntries, opts);
  const activeAgent = selectActiveMemoryEntries(agentEntries, opts);
  const sections = [
    buildMemoryEntrySection(USER_MEMORY_HEADER, activeUser),
    buildMemoryEntrySection(AGENT_MEMORY_HEADER, activeAgent),
  ].filter((section) => section.length > 0);
  return sections.join('\n\n');
}
