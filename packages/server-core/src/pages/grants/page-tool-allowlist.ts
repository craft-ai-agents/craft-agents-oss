/**
 * The page-tool allowlist: curated built-ins, extended by the user.
 *
 * The built-in list is curated because MCP tool names and `readOnlyHint`
 * annotations come from the MCP server itself, so a compromised or careless
 * server can call a mutating tool read-only (ADR 0001). That argument forbids
 * extension *by the connector* — it does not forbid extension by the user. A
 * local MAVIR, weather or water-level source becomes usable by adding an entry
 * to a file the user owns, which is the user vouching for the tool rather than
 * the source asserting its own trustworthiness.
 *
 * Three properties make that safe enough to offer:
 *
 * 1. **Additive only.** The file can add sources and tools; it can never remove
 *    a built-in, and it cannot promote a mutating tool on a source WE curate.
 *    A file that could subtract would make the curated list depend on the very
 *    thing curation exists to constrain.
 * 2. **All-or-nothing.** One bad entry rejects the whole file. Partial
 *    application means the file did something other than what it says, which is
 *    the worst outcome for security-relevant config.
 * 3. **A snapshot.** Loaded once and held, so authorisation cannot change
 *    midway through a request. Callers reload deliberately.
 *
 * It lives beside `page-grants.json`, outside every agent-writable directory,
 * for the same reason that file does: an agent that could edit the allowlist
 * could widen its own reach.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isTrustedReadOnlyTool as isBuiltInTrusted,
  trustedToolsForSource as builtInToolsFor,
  sourcesWithTrustedTools as builtInSources,
} from './allowlist.ts'

export const ALLOWLIST_FILE = 'page-tool-allowlist.json'
const VERSION = 1

/**
 * Bound on what one file may declare. Not a security boundary on its own — the
 * user wrote it — but a runaway or generated file should fail loudly rather
 * than quietly authorising hundreds of tools.
 */
export const MAX_USER_TOOLS = 200

/** Same shape the tool and grant layers accept, so nothing new is legal here. */
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const TOOL_RE = /^[a-z0-9][a-z0-9_.-]{0,127}$/i
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])

export interface PageToolAllowlist {
  /** Is this (source, tool) pair trusted read-only? */
  isTrusted: (sourceSlug: string, toolName: string) => boolean
  /** Tools a source may expose to pages. Used by the approval UI. */
  toolsFor: (sourceSlug: string) => string[]
  /** Sources that can back a page query at all. */
  sources: () => string[]
  /** How many tools the user's file contributed; 0 when absent or rejected. */
  userToolCount: number
}

/** Parse the user file, returning null for anything that is not entirely valid. */
function parseUserFile(raw: string): Map<string, Set<string>> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  if (obj.version !== VERSION) return null

  const sources = obj.sources
  if (typeof sources !== 'object' || sources === null || Array.isArray(sources)) return null

  const out = new Map<string, Set<string>>()
  let total = 0

  // Object.entries, so an inherited `__proto__` payload is never walked as if
  // it were a declared source.
  for (const [slug, tools] of Object.entries(sources as Record<string, unknown>)) {
    if (RESERVED.has(slug) || !SLUG_RE.test(slug)) return null
    if (!Array.isArray(tools)) return null

    const set = new Set<string>()
    for (const tool of tools) {
      if (typeof tool !== 'string' || !TOOL_RE.test(tool)) return null
      set.add(tool)
      total += 1
      if (total > MAX_USER_TOOLS) return null
    }
    out.set(slug, set)
  }

  return out
}

/**
 * Load the effective allowlist for a workspace.
 *
 * Never throws: a missing, unreadable or invalid file yields the built-ins
 * alone, which is the fail-closed direction for an authorisation record.
 */
export function loadPageToolAllowlist(
  workspaceRootPath: string,
  logger?: { warn: (m: string) => void },
): PageToolAllowlist {
  let user: Map<string, Set<string>> | null = null
  let sawFile = false

  try {
    const raw = readFileSync(join(workspaceRootPath, ALLOWLIST_FILE), 'utf-8')
    sawFile = true
    user = parseUserFile(raw)
  } catch {
    // Absent is the normal case, not an error.
    user = null
  }

  if (sawFile && user === null) {
    logger?.warn(
      `[pages] ${ALLOWLIST_FILE} was ignored entirely: it is invalid. `
      + 'No user-declared tool is trusted until it parses.',
    )
  }

  const userToolCount = user ? [...user.values()].reduce((n, s) => n + s.size, 0) : 0

  return {
    userToolCount,

    isTrusted(sourceSlug, toolName) {
      if (isBuiltInTrusted(sourceSlug, toolName)) return true
      // A source WE curate is ours to define. Letting the file add tools to it
      // would turn "gmail.send_message" into a one-line edit, which is exactly
      // the judgement the curated list exists to hold.
      if (builtInSources().includes(sourceSlug)) return false
      return user?.get(sourceSlug)?.has(toolName) ?? false
    },

    toolsFor(sourceSlug) {
      const builtIn = builtInToolsFor(sourceSlug)
      if (builtIn.length > 0) return builtIn
      return [...(user?.get(sourceSlug) ?? [])].sort()
    },

    sources() {
      return [...new Set([...builtInSources(), ...(user?.keys() ?? [])])].sort()
    },
  }
}
