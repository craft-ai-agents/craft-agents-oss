/**
 * Agent Definitions — types
 *
 * An "Agent" is a saved, reusable bundle of session configuration:
 *   LLM connection + model + system prompt + skills + sources + runtime knobs.
 *
 * Agents live in a single GLOBAL library (`~/.agents/agents/`) and are
 * activated per-workspace via an activation manifest. Compare with skills
 * which today live per-workspace by default — agents intentionally invert
 * that to reduce friction ("a great agent is reusable everywhere").
 *
 * NOT to be confused with the runtime "Agent" classes in `../agent/`
 * (claude-agent.ts, base-agent.ts). Those are the executor; this is the
 * persisted persona that an executor runs as.
 */

import type { PermissionMode } from '../agent/mode-types.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';

/** Where an agent definition was loaded from. */
export type AgentDefinitionSource = 'global' | 'workspace' | 'project';

/**
 * Frontmatter shape for AGENT.md files. Every field except `name`,
 * `description`, and the system prompt body is optional — sensible defaults
 * apply at run time.
 */
export interface AgentMetadata {
  /** Human-readable display name (e.g. "Research Agent"). */
  name: string;
  /** One-sentence description shown in pickers and lists. */
  description: string;
  /** Optional emoji shown in the UI (single grapheme). Defaults to a generic icon. */
  avatar?: string;
  /** LLM connection slug (e.g. "anthropic-default"). Falls back to workspace default. */
  llmConnection?: string;
  /** Model ID (e.g. "claude-opus-4-7"). Falls back to provider default. */
  model?: string;
  /** Permission mode the spawned session starts in. Defaults to "ask". */
  permissionMode?: PermissionMode;
  /** Thinking depth. Defaults to workspace default. */
  thinkingLevel?: ThinkingLevel;
  /** Skill slugs auto-activated when this agent runs. Validated at run time. */
  skills?: string[];
  /** Source slugs auto-activated when this agent runs. Validated at run time. */
  sources?: string[];
  /**
   * Optional opening line shown in the composer when this agent is summoned.
   * Pure UX hint — does not affect the model's behavior.
   */
  greeting?: string;

  // ============================================================================
  // Capabilities — declarative I/O contract
  //
  // Three short, structured fields that future orchestration layers (Rooms,
  // a decision step, agent-to-agent handoff) can reason about without
  // re-reading the full system prompt every turn. They also make the picker
  // UI useful at scale: search by tag, browse by what an agent does.
  //
  // All three are optional and natural-language. We deliberately don't try to
  // type-check the contents — that would lock the schema before we know what
  // shapes orchestrators actually need. Today: human-readable hints.
  // Tomorrow: an orchestrator that prefers the agent whose `inputs` matches
  // what it has and whose `outputs` matches what it needs next.
  // ============================================================================

  /**
   * One short sentence describing what this agent expects as input.
   * Example: "A topic and the depth you want."
   */
  inputs?: string;

  /**
   * One short sentence describing what this agent produces.
   * Example: "A cited summary with TL;DR and open questions."
   */
  outputs?: string;

  /**
   * 1-8 lowercase capability tags. Used by the picker for browse/filter and
   * (eventually) by the Orchestrator for routing. Free-form strings; a small
   * shared vocabulary will emerge from real use.
   * Example: ["research", "summarize", "cite"]
   */
  tags?: string[];
}

export type AgentParseWarningCode =
  | 'invalid-permission-mode'
  | 'invalid-thinking-level'
  | 'invalid-skills'
  | 'invalid-sources'
  | 'invalid-tags';

export interface AgentParseWarning {
  field: keyof AgentMetadata;
  code: AgentParseWarningCode;
  message: string;
}

/**
 * A loaded agent definition with parsed metadata + system prompt body.
 */
export interface LoadedAgent {
  /** Filesystem slug — also the @-mention identifier (e.g. `/research`). */
  slug: string;
  /** Parsed YAML frontmatter. */
  metadata: AgentMetadata;
  /** System prompt body (everything below the frontmatter, trimmed). */
  systemPrompt: string;
  /** Absolute path to the agent's directory. */
  path: string;
  /** Where this agent was loaded from. */
  source: AgentDefinitionSource;
  /** Non-fatal parse issues from AGENT.md frontmatter. */
  parseWarnings?: AgentParseWarning[];
}

/**
 * Per-workspace activation manifest.
 *
 * Agents live globally; each workspace explicitly activates a subset.
 * This file is small (just slugs + an updatedAt) so the renderer can read it
 * synchronously when computing the visible-agents list.
 */
export interface ActivatedAgentsManifest {
  /** Schema version for forward compatibility. */
  version: 1;
  /** Slugs of globally-defined agents that should be visible in this workspace. */
  active: string[];
  /** ISO timestamp of last mutation. */
  updatedAt: string;
}

/**
 * Slug rules. Keep in sync with the validator.
 *
 * - lowercase letters, digits, hyphens
 * - 1-64 chars
 * - no leading/trailing hyphen
 *
 * Same shape as `WEBHOOK_SLUG_REGEX` so the two namespaces stay symmetric
 * and the picker's @-resolver can use a single matcher.
 */
export const AGENT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Built-in coordinator agent slug. */
export const ORCHESTRATOR_SLUG = 'orchestrator';
