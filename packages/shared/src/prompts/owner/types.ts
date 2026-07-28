/**
 * Prompt layer types for the versioned prompt compiler.
 *
 * Each layer represents one section of the final compiled prompt,
 * following the composition order defined in the Phase 2 plan:
 *
 *   1. immutable runtime contract
 *   2. owner identity/personality
 *   3. action-first execution policy
 *   4. current project instructions
 *   5. selected skills
 *   6. retrieved durable memory
 *   7. session summary and volatile state
 *   8. active capabilities/tool hints
 *   9. user message (external)
 *
 * Stable layers (1–5) are cacheable; volatile layers (6–8) are
 * recomputed every turn.
 */

/**
 * Unique identifiers for each built-in prompt layer.
 * Custom layers (e.g. `.hermes.md` or user-created) can use
 * arbitrary string IDs outside this enum.
 */
export const BUILT_IN_LAYER_IDS = [
  'runtime-contract',
  'owner-identity',
  'execution-policy',
  'project-context',
  'skills',
  'memory',
  'session-state',
  'capabilities',
] as const;

export type BuiltInLayerId = (typeof BUILT_IN_LAYER_IDS)[number];

/**
 * A single prompt layer definition.
 */
export interface PromptLayer {
  /** Unique layer identifier. Built-in IDs use the enum; custom layers
   *  may use arbitrary strings. */
  id: string;

  /** Human-readable name (for the Prompt Studio UI). */
  name: string;

  /** Semantic version of this layer's content schema. Bump on structural
   *  changes so cached prompts can be invalidated. */
  version: number;

  /** Whether this layer is stable across turns (cacheable) or volatile
   *  (must be recomputed each turn). */
  stability: 'stable' | 'volatile';

  /** The rendered text. In practice this is the output of a layer's
   *  render function. For serialised layers (e.g. loaded from disk)
   *  this is the static content. */
  content: string;

  /** Optional metadata for the Prompt Studio. */
  metadata?: {
    /** Token estimate for this layer (approximate). */
    estimatedTokens?: number;
    /** Whether the layer is enabled (can be toggled in the studio). */
    enabled?: boolean;
    /** Arbitrary tags for filtering/grouping. */
    tags?: string[];
  };
}

/**
 * A versioned snapshot of the full compiled prompt.
 * Stored so we can diff, rollback, and audit prompt changes.
 */
export interface CompiledPromptSnapshot {
  /** Unique id for this snapshot (e.g. `prompt:{timestamp}:{hash}`). */
  id: string;

  /** The compiler version that produced this snapshot. */
  compilerVersion: number;

  /** Ordered list of layer IDs included in this compilation. */
  layerOrder: string[];

  /** Concatenated prompt text. */
  prompt: string;

  /** Approximate total token count. */
  estimatedTokens: number;

  /** Per-layer breakdown. */
  layers: PromptLayer[];

  /** Timestamp when this snapshot was compiled. */
  compiledAt: string;
}

/**
 * Options passed to the prompt compiler for a single compilation pass.
 */
export interface CompileOptions {
  /** Override the default layer order. IDs not in this list are excluded. */
  layerOrder?: string[];

  /** Override content for specific layers keyed by layer id. */
  layerOverrides?: Record<string, Partial<PromptLayer>>;

  /** Owner identity profile (loaded from owner storage). */
  ownerProfile?: {
    name: string;
    aliases: string[];
    locale: string;
    timezone: string;
    tone: string;
    verbosity: number;
    bannedPhrases: string[];
  };

  /** Execution policy overrides. */
  executionPolicy?: {
    defaultMode: string;
    askOnlyWhen: string[];
    allowedRoots: string[];
    /**
     * Retry configuration for transient tool failures.
     * Rendered into the execution-policy layer as "Retry up to N times
     * with exponential backoff (base delay: Xms)".
     * Defaults: maxRetries=3, backoffMs=1000.
     */
    retryConfig?: {
      /** Maximum retry attempts before escalating (default 3). */
      maxRetries: number;
      /** Base backoff in milliseconds (doubles each attempt, default 1000). */
      backoffMs: number;
    };
  };

  /** Project context. */
  projectContext?: {
    workingDirectory?: string;
    contextFiles?: { filename: string; content: string }[];
  };

  /** Skill descriptions to inject. */
  skills?: string[];

  /** Retrieved memory entries to inject. */
  memories?: { title: string; content: string; score: number }[];

  /** Session state. */
  sessionState?: {
    sessionId: string;
    permissionMode: string;
    plansFolderPath: string;
    dataFolderPath: string;
  };

  /** Active capabilities / tool hints. */
  capabilities?: string[];
}

/**
 * Result of a single compilation pass.
 */
export interface CompileResult {
  snapshot: CompiledPromptSnapshot;
  /**
   * Whether any cached layer was invalidated and rebuilt.
   * When false, the snapshot was assembled from cached layer content only.
   */
  cacheInvalidated: boolean;
}

/**
 * Validator result for a prompt layer or compiled prompt.
 */
export interface ValidationResult {
  valid: boolean;
  issues: Array<{
    severity: 'error' | 'warning';
    message: string;
    field?: string;
  }>;
}
