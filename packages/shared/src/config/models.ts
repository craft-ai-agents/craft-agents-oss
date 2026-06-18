/**
 * Centralized Model Registry
 *
 * Single source of truth for all model definitions across the application.
 * All model metadata, capabilities, and costs are defined here.
 *
 * When adding a new model or provider:
 * 1. Add the model(s) to MODEL_REGISTRY
 * 2. The convenience exports (ANTHROPIC_MODELS, OPENAI_MODELS) auto-update
 * 3. Update llm-connections.ts if adding a new built-in connection
 */
// Bedrock-native → bare Anthropic ID reverse mapping.
// Duplicated from llm-connections.ts to avoid circular imports (llm-connections imports models).
// Must stay in sync with BEDROCK_MODEL_MAP in llm-connections.ts.
const BEDROCK_TO_BARE: Record<string, string> = {
  // US inference profile IDs (primary)
  'us.anthropic.claude-opus-4-8': 'claude-opus-4-8',
  'us.anthropic.claude-fable-5': 'claude-fable-5',
  'us.anthropic.claude-opus-4-7': 'claude-opus-4-7',
  // Compatibility alias for an earlier incorrect 4.7 mapping.
  'us.anthropic.claude-opus-4-7-v1': 'claude-opus-4-7',
  'us.anthropic.claude-sonnet-4-6': 'claude-sonnet-4-6',
  'us.anthropic.claude-haiku-4-5-20251001-v1:0': 'claude-haiku-4-5-20251001',
  'us.anthropic.claude-opus-4-5-20251101-v1:0': 'claude-opus-4-5-20251101',
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0': 'claude-sonnet-4-5-20250929',
  // EU inference profile IDs
  'eu.anthropic.claude-opus-4-8': 'claude-opus-4-8',
  'eu.anthropic.claude-fable-5': 'claude-fable-5',
  'eu.anthropic.claude-opus-4-7': 'claude-opus-4-7',
  'eu.anthropic.claude-opus-4-7-v1': 'claude-opus-4-7',
  'eu.anthropic.claude-sonnet-4-6': 'claude-sonnet-4-6',
  'eu.anthropic.claude-haiku-4-5-20251001-v1:0': 'claude-haiku-4-5-20251001',
  'eu.anthropic.claude-opus-4-5-20251101-v1:0': 'claude-opus-4-5-20251101',
  'eu.anthropic.claude-sonnet-4-5-20250929-v1:0': 'claude-sonnet-4-5-20250929',
  // Global inference profile IDs
  'global.anthropic.claude-opus-4-8': 'claude-opus-4-8',
  'global.anthropic.claude-fable-5': 'claude-fable-5',
  'global.anthropic.claude-opus-4-7': 'claude-opus-4-7',
  'global.anthropic.claude-opus-4-7-v1': 'claude-opus-4-7',
  'global.anthropic.claude-sonnet-4-6': 'claude-sonnet-4-6',
  'global.anthropic.claude-haiku-4-5-20251001-v1:0': 'claude-haiku-4-5-20251001',
  // Base IDs (no region prefix)
  'anthropic.claude-opus-4-8': 'claude-opus-4-8',
  'anthropic.claude-fable-5': 'claude-fable-5',
  'anthropic.claude-opus-4-7': 'claude-opus-4-7',
  'anthropic.claude-opus-4-7-v1': 'claude-opus-4-7',
  'anthropic.claude-sonnet-4-6': 'claude-sonnet-4-6',
  'anthropic.claude-haiku-4-5-20251001-v1:0': 'claude-haiku-4-5-20251001',
  'anthropic.claude-opus-4-5-20251101-v1:0': 'claude-opus-4-5-20251101',
  'anthropic.claude-sonnet-4-5-20250929-v1:0': 'claude-sonnet-4-5-20250929',
};
function bedrockToBareId(modelId: string): string {
  return BEDROCK_TO_BARE[modelId] ?? modelId;
}

const DEPRECATED_MODEL_REPLACEMENTS: Record<string, string> = {
  'claude-opus-4-5-20251101': 'claude-opus-4-8',
  'claude-opus-4-6': 'claude-opus-4-8',
  'anthropic.claude-opus-4-5-20251101-v1:0': 'anthropic.claude-opus-4-8',
  'anthropic.claude-opus-4-6-v1': 'anthropic.claude-opus-4-8',
  'anthropic.claude-opus-4-7-v1': 'anthropic.claude-opus-4-7',
  'us.anthropic.claude-opus-4-5-20251101-v1:0': 'us.anthropic.claude-opus-4-8',
  'us.anthropic.claude-opus-4-6-v1': 'us.anthropic.claude-opus-4-8',
  'us.anthropic.claude-opus-4-7-v1': 'us.anthropic.claude-opus-4-7',
  'eu.anthropic.claude-opus-4-5-20251101-v1:0': 'eu.anthropic.claude-opus-4-8',
  'eu.anthropic.claude-opus-4-6-v1': 'eu.anthropic.claude-opus-4-8',
  'eu.anthropic.claude-opus-4-7-v1': 'eu.anthropic.claude-opus-4-7',
  'global.anthropic.claude-opus-4-6-v1': 'global.anthropic.claude-opus-4-8',
  'global.anthropic.claude-opus-4-7-v1': 'global.anthropic.claude-opus-4-7',
};

/** Normalize deprecated built-in model IDs to the current supported replacement. */
export function normalizeDeprecatedModelId(modelId: string): string {
  if (modelId.startsWith('pi/')) {
    const normalized = normalizeDeprecatedModelId(modelId.slice(3));
    return normalized === modelId.slice(3) ? modelId : `pi/${normalized}`;
  }
  return DEPRECATED_MODEL_REPLACEMENTS[modelId] ?? modelId;
}

// ============================================
// TYPES
// ============================================

/**
 * Provider identifier for AI backends.
 */
export type ModelProvider = 'anthropic' | 'pi';

/**
 * Full model definition with capabilities and costs.
 * Used throughout the application for model selection and display.
 */
export interface ModelDefinition {
  /** Model identifier (e.g., 'claude-sonnet-4-6', 'gpt-5.3-codex') */
  id: string;
  /** Human-readable name (e.g., 'Sonnet 4.6', 'Codex') */
  name: string;
  /** Short display name for compact UI (e.g., 'Sonnet', 'Codex') */
  shortName: string;
  /** Brief description of the model's strengths */
  description: string;
  /** Translation key for the description (for built-in static models only).
   *  UI should resolve: t(descriptionKey) if set, otherwise fall back to description. */
  descriptionKey?: string;
  /** Provider that offers this model */
  provider: ModelProvider;
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Whether this model supports thinking/reasoning effort. Defaults to true when undefined. */
  supportsThinking?: boolean;
  /** Explicit per-model image input capability hint, primarily for custom endpoints. */
  supportsImages?: boolean;
}

// ============================================
// MODEL REGISTRY (Single Source of Truth)
// ============================================

/**
 * All available models across all providers.
 * This is the authoritative list - all other model arrays derive from this.
 */
export const MODEL_REGISTRY: ModelDefinition[] = [
  // ----------------------------------------
  // Anthropic Claude Models
  // ----------------------------------------
  {
    id: 'claude-opus-4-8',
    name: 'Opus 4.8',
    shortName: 'Opus',
    description: 'Most capable for complex work',
    descriptionKey: 'model.opusDesc',
    provider: 'anthropic',
    contextWindow: 1_000_000,
  },
  {
    id: 'claude-opus-4-7',
    name: 'Opus 4.7',
    shortName: 'Opus',
    description: 'Previous Opus generation',
    descriptionKey: 'model.opusDesc',
    provider: 'anthropic',
    contextWindow: 1_000_000,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Sonnet 4.6',
    shortName: 'Sonnet',
    description: 'Best for everyday tasks',
    descriptionKey: 'model.sonnetDesc',
    provider: 'anthropic',
    contextWindow: 200_000,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Haiku 4.5',
    shortName: 'Haiku',
    description: 'Fastest for quick answers',
    descriptionKey: 'model.haikuDesc',
    provider: 'anthropic',
    contextWindow: 200_000,
  },
  {
    id: 'claude-fable-5',
    name: 'Fable 5',
    shortName: 'Fable',
    description: 'Next-generation model for complex work',
    descriptionKey: 'model.fableDesc',
    provider: 'anthropic',
    contextWindow: 1_000_000,
  },

  // ----------------------------------------
  // Pi Models
  // No hardcoded entries — models are discovered dynamically:
  //   - Pi: getModels(provider) from @mariozechner/pi-ai SDK
  // See ModelRefreshService in apps/electron/src/main/model-fetchers/
  // ----------------------------------------
];

// ============================================
// PROVIDER-FILTERED EXPORTS
// ============================================

/**
 * Get models filtered by provider.
 */
export function getModelsByProvider(provider: ModelProvider): ModelDefinition[] {
  return MODEL_REGISTRY.filter(m => m.provider === provider);
}

/** All Anthropic Claude models */
export const ANTHROPIC_MODELS = getModelsByProvider('anthropic');


/**
 * Legacy compatibility export.
 * Used by existing code that imports MODELS (expects Claude models only).
 * @deprecated Use ANTHROPIC_MODELS or MODEL_REGISTRY instead
 */
export const MODELS = ANTHROPIC_MODELS;

// ============================================
// MODEL ID HELPERS (Derived from Registry)
// ============================================

/** Get the first model ID matching a short name, or undefined if not found */
function findModelIdByShortName(shortName: string): string | undefined {
  return MODEL_REGISTRY.find(m => m.shortName === shortName)?.id;
}

/** Get the first model ID matching a short name (throws if not found) */
export function getModelIdByShortName(shortName: string): string {
  const id = findModelIdByShortName(shortName);
  if (!id) throw new Error(`Model not found: ${shortName}`);
  return id;
}

// ============================================
// CONNECTION DEFAULTS
// Used ONLY when writing defaults to LLM connection config (not as runtime fallbacks).
// ============================================

/** Default model for Anthropic connections (used when creating/backfilling connections) */
export const DEFAULT_MODEL = getModelIdByShortName('Opus');


// ============================================
// UTILITY MODELS
// ============================================

/**
 * Get the default summarization model ID (Haiku).
 * Used as fallback when no connection context is available
 * (e.g., url-validator, mcp/validation, summarize.ts without modelOverride).
 *
 * For connection-aware summarization model resolution, use
 * getSummarizationModel(connection) from llm-connections.ts instead.
 */
export function getDefaultSummarizationModel(): string {
  return findModelIdByShortName('Haiku') ?? DEFAULT_MODEL;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get a model by ID from the registry.
 * Also handles Bedrock-native IDs (e.g. "anthropic.claude-opus-4-8")
 * by reverse-mapping to the bare Anthropic ID for lookup.
 */
export function getModelById(modelId: string): ModelDefinition | undefined {
  const normalized = normalizeDeprecatedModelId(modelId);
  return MODEL_REGISTRY.find(m => m.id === normalized)
    ?? MODEL_REGISTRY.find(m => m.id === bedrockToBareId(normalized));
}

/**
 * Get display name for a model ID (full name with version).
 */
export function getModelDisplayName(modelId: string): string {
  const model = getModelById(modelId);
  if (model) return model.name;
  // Fallback: normalize deprecated/Bedrock-native IDs, then strip prefix and date suffix
  // e.g., "claude-opus-4-5-20251101" → "Opus 4.8"
  const normalized = bedrockToBareId(normalizeDeprecatedModelId(modelId));
  const stripped = normalized
    .replace('claude-', '')
    .replace(/-\d{8}$/, '');  // Remove date suffix
  // Split on dashes, capitalize first part, join version parts with dots
  const parts = stripped.split('-');
  const first = parts[0];
  if (!first) return modelId;
  const name = first.charAt(0).toUpperCase() + first.slice(1);
  const version = parts.slice(1).join('.');
  return version ? `${name} ${version}` : name;
}

/**
 * Get short display name for a model ID (without version number).
 */
export function getModelShortName(modelId: string): string {
  const model = getModelById(modelId);
  if (model) return model.shortName;
  // For provider-prefixed IDs (e.g. "openai/gpt-5"), show just the model part
  if (modelId.includes('/')) {
    return modelId.split('/').pop() || modelId;
  }
  // Fallback: normalize deprecated/Bedrock-native IDs, then humanize (same logic as getModelDisplayName)
  const normalized = bedrockToBareId(normalizeDeprecatedModelId(modelId));
  const stripped = normalized.replace('claude-', '').replace(/-\d{8}$/, '');
  const parts = stripped.split('-');
  const first = parts[0];
  if (!first) return modelId;
  const name = first.charAt(0).toUpperCase() + first.slice(1);
  const version = parts.slice(1).join('.');
  return version ? `${name} ${version}` : name;
}

/**
 * Get known context window size for a model ID.
 */
export function getModelContextWindow(modelId: string): number | undefined {
  return getModelById(modelId)?.contextWindow;
}

/**
 * Check if model is an Opus model (for cache TTL decisions).
 */
export function isOpusModel(modelId: string): boolean {
  return modelId.includes('opus');
}

/**
 * Check if a model ID refers to a Claude model.
 * Handles direct Anthropic IDs (e.g. "claude-sonnet-4-6"),
 * provider-prefixed IDs (e.g. "anthropic/claude-sonnet-4" via OpenRouter),
 * and Bedrock-native IDs (e.g. "anthropic.claude-opus-4-8").
 */
export function isClaudeModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.startsWith('claude-') || lower.includes('/claude') || lower.includes('.claude');
}

/**
 * Mythos-class models (Claude Fable 5 / Mythos 5 / Mythos Preview) where adaptive
 * thinking is ALWAYS ON and `thinking: { type: 'disabled' }` is rejected by the
 * Messages API. Callers must use adaptive thinking + the `effort` parameter to
 * control depth on these models — there is no way to turn thinking off.
 * (The Messages API is unchanged for Opus/Sonnet/Haiku, which still accept `disabled`.)
 * Matches bare, pi/-prefixed, and Bedrock-native id forms.
 */
export function isAdaptiveThinkingAlwaysOnModel(modelId: string): boolean {
  return /claude-(fable|mythos)/i.test(modelId);
}


/**
 * Get the provider for a model ID.
 */
export function getModelProvider(modelId: string): ModelProvider | undefined {
  return getModelById(modelId)?.provider;
}
