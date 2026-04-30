/**
 * Workspace Context — types
 *
 * A "Context Doc" is a markdown file holding workspace-level guidance:
 * goals, vision, voice/style, glossary, anything the user wants their
 * agents to read before starting work.
 *
 * Design choices that drive the schema:
 *   - One file per topic (not one big workspace.md). Lets users keep
 *     "voice & style" separate from "Q2 product goals" and route them
 *     to different agents.
 *   - Routing is per-doc. Default = broadcast to every agent. Targeted
 *     routing names specific agent slugs.
 *   - The Concierge agent ALWAYS receives every enabled doc, regardless
 *     of routing. Its job is omniscience; we hard-wire the override in
 *     the loader, not in the file.
 *   - Frontmatter mirrors AGENT.md / SKILL.md so the YAML+markdown idiom
 *     stays consistent.
 */
import { AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';

/**
 * "broadcast" = visible to every agent in the workspace.
 * A list of slugs = visible only to those agents (plus Concierge).
 *
 * We use a string literal for the broadcast case rather than `string[] | undefined`
 * so the file format is explicit: `agents: all` reads as a deliberate decision,
 * `agents: [writer]` reads as a deliberate narrowing. Missing field defaults
 * to broadcast at parse time.
 */
export type ContextDocRouting =
  | { mode: 'broadcast' }
  | { mode: 'targeted'; agents: string[] };

export interface ContextDocMetadata {
  /** Human-readable display name (e.g. "Voice & Style"). */
  name: string;
  /** One-sentence description. Optional. */
  description?: string;
  /** Routing rule. Defaults to broadcast when the field is missing. */
  routing: ContextDocRouting;
  /**
   * If false, the doc is in the workspace but not delivered to any agent.
   * Lets users keep drafts without affecting prompts. Defaults to true.
   */
  enabled: boolean;
}

export type ContextDocParseWarningCode =
  | 'invalid-agents'
  | 'invalid-enabled';

export interface ContextDocParseWarning {
  field: keyof ContextDocMetadata;
  code: ContextDocParseWarningCode;
  message: string;
}

export interface LoadedContextDoc {
  /** Filesystem slug — also the @-mention identifier. */
  slug: string;
  metadata: ContextDocMetadata;
  /** Markdown body (everything below the frontmatter, trimmed). */
  body: string;
  /** Absolute path to the doc's directory. */
  path: string;
  /** Workspace this doc belongs to. */
  workspaceRootPath: string;
  parseWarnings?: ContextDocParseWarning[];
}

/** Same slug shape as agents/skills — keeps @-mentions uniform. */
export const CONTEXT_DOC_SLUG_REGEX = AGENT_SLUG_REGEX;

/** Filename used inside each doc's directory. */
export const CONTEXT_FILE = 'CONTEXT.md';
