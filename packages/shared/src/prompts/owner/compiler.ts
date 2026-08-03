/**
 * Versioned prompt compiler.
 *
 * Composes the final agent prompt from ordered layers following the
 * Phase 2 plan. Stable layers (runtime contract, owner identity,
 * execution policy, project context) are cached and only rebuilt
 * when invalidated. Volatile layers (memory, session state,
 * capabilities) are recomputed every turn.
 *
 * Usage:
 * ```typescript
 * const compiler = new PromptCompiler();
 * const result = compiler.compile({
 *   ownerProfile: { name: 'Skobez', ... },
 *   sessionState: { sessionId, permissionMode, ... },
 *   // ...other layers
 * });
 * // result.snapshot.prompt is the full compiled prompt
 * ```
 */

import type {
  PromptLayer,
  CompileOptions,
  CompileResult,
  CompiledPromptSnapshot,
} from './types.ts';

import {
  RUNTIME_CONTRACT_LAYER,
  buildOwnerIdentityLayer,
  buildExecutionPolicyLayer,
  buildProjectContextLayer,
  buildSkillsLayer,
  buildMemoryLayer,
  buildSessionStateLayer,
  buildCapabilitiesLayer,
} from './defaults.ts';

/** Current compiler version. Bump on structural changes. */
const COMPILER_VERSION = 1;

/** Default layer order matching the Phase 2 plan. */
const DEFAULT_LAYER_ORDER: string[] = [
  'runtime-contract',
  'owner-identity',
  'execution-policy',
  'project-context',
  'skills',
  'memory',
  'session-state',
  'capabilities',
];

/**
 * Quick token estimate: ~4 chars per token for English text.
 * This is intentionally rough — the Prompt Studio can provide
 * a more accurate count via the model's tokenizer.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build a stable content hash for cache invalidation.
 * Uses a simple string hash — not cryptographic.
 */
function contentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return `h${Math.abs(hash).toString(36)}`;
}

export class PromptCompiler {
  /** Cache keyed by layer id + content hash. */
  private layerCache = new Map<string, { version: number; content: string; hash: string }>();
  /** Monotonically increasing invalidation counter. */
  private invalidateCount: number = 0;

  /**
   * Invalidate all cached layers.
   *
   * Stable layers (owner-identity, execution-policy, project-context) cache
   * their render output keyed only by layer id — not by the input CompileOptions
   * that produced them. Therefore, whenever the owner profile, execution policy,
   * working directory, or project context files change between sessions, you MUST
   * call this method before the next compile() call, or stale cached content will
   * be returned for those layers.
   *
   * The runtime-contract layer is truly immutable and never needs invalidation.
   */
  invalidateAll(): void {
    this.layerCache.clear();
    this.invalidateCount++;
  }

  /**
   * Invalidate a specific cached layer by id.
   */
  invalidateLayer(layerId: string): void {
    this.layerCache.delete(layerId);
    this.invalidateCount++;
  }

  /**
   * Get the current invalidation version (for callers that want to
   * detect stale references).
   */
  getInvalidationVersion(): number {
    return this.invalidateCount;
  }

  /**
   * Compile a prompt from the given options.
   *
   * 1. Resolves the layer order (default or override).
   * 2. Builds each layer (using cache for stable layers).
   * 3. Joins them in order with separator.
   * 4. Returns a `CompileResult` with the full snapshot.
   */
  compile(options: CompileOptions = {}): CompileResult {
    const layerOrder = options.layerOrder ?? DEFAULT_LAYER_ORDER;
    let cacheInvalidated = false;

    const layers: PromptLayer[] = [];

    for (const id of layerOrder) {
      // Check cache BEFORE buildLayer so we can detect whether the layer
      // was freshly built (and possibly cached by buildLayer) vs. reused.
      const wasCached = this.layerCache.has(id);
      const layer = this.buildLayer(id, options);
      if (layer) {
        layers.push(layer);
        if (!wasCached) {
          cacheInvalidated = true;
        }
      }
    }

    const prompt = layers.map((l) => l.content).join('\n\n');
    const estimatedTokens = estimateTokens(prompt);

    const snapshot: CompiledPromptSnapshot = {
      id: `prompt:${Date.now()}:${contentHash(prompt)}`,
      compilerVersion: COMPILER_VERSION,
      layerOrder,
      prompt,
      estimatedTokens,
      layers,
      compiledAt: new Date().toISOString(),
    };

    return { snapshot, cacheInvalidated };
  }

  /**
   * Build (or retrieve from cache) a single layer by id.
   */
  private buildLayer(id: string, options: CompileOptions): PromptLayer | null {
    // Check cache first for stable layers that haven't been invalidated.
    const cached = this.layerCache.get(id);
    if (cached) {
      // Check if any override would change this layer — if so, skip cache.
      const override = options.layerOverrides?.[id];
      if (!override) {
        return {
          id,
          name: cached.content.split('\n')[0] ?? id,
          version: cached.version,
          stability: 'stable',
          content: cached.content,
        };
      }
    }

    let layer: PromptLayer | null = null;

    switch (id) {
      case 'runtime-contract':
        layer = RUNTIME_CONTRACT_LAYER;
        break;

      case 'owner-identity': {
        const profile = options.ownerProfile ?? {
          name: 'Owner',
          aliases: [],
          locale: 'en',
          timezone: 'UTC',
          tone: 'Direct and technical.',
          verbosity: 3,
          bannedPhrases: [],
        };
        layer = buildOwnerIdentityLayer(profile);
        break;
      }

      case 'execution-policy': {
        const policy = options.executionPolicy ?? {
          defaultMode: 'owner-auto',
          askOnlyWhen: ['filesystem-write', 'config-write', 'memory-write'],
          allowedRoots: [],
          // retryConfig deliberately omitted — buildExecutionPolicyLayer
          // applies defaults (?? 3, empty suffix) for backward compatibility.
        };
        layer = buildExecutionPolicyLayer(policy);
        break;
      }

      case 'project-context':
        layer = buildProjectContextLayer(options.projectContext);
        break;

      case 'skills':
        layer = buildSkillsLayer(options.skills);
        break;

      case 'memory':
        layer = buildMemoryLayer(options.memories);
        break;

      case 'session-state': {
        const state = options.sessionState ?? {
          sessionId: 'unknown',
          permissionMode: 'explore',
          plansFolderPath: '/tmp/plans',
          dataFolderPath: '/tmp/data',
        };
        layer = buildSessionStateLayer(state);
        break;
      }

      case 'capabilities':
        layer = buildCapabilitiesLayer(options.capabilities);
        break;

      default:
        // Custom layer IDs are not handled by the built-in compiler.
        // The Prompt Studio can load custom layers from disk.
        return null;
    }

    // Apply overrides from options.layerOverrides.
    const override = options.layerOverrides?.[id];
    if (override && layer) {
      if (override.content !== undefined) {
        layer = { ...layer, content: override.content };
      }
    }

    // Cache stable layers.
    if (layer && layer.stability === 'stable') {
      const hash = contentHash(layer.content);
      this.layerCache.set(id, { version: layer.version, content: layer.content, hash });
    }

    return layer;
  }
}
