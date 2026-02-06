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

// ============================================
// TYPES
// ============================================

/**
 * Provider identifier for AI backends.
 */
export type ModelProvider = 'anthropic' | 'openai';

/**
 * Stored default model map (by provider).
 * Keeps app-level defaults scoped to provider.
 */
export type ModelDefaults = Partial<Record<ModelProvider, string>>;

/**
 * Full model definition with capabilities and costs.
 * Used throughout the application for model selection and display.
 */
export interface ModelDefinition {
  /** Model identifier (e.g., 'claude-sonnet-4-5-20250929', 'codex') */
  id: string;
  /** Human-readable name (e.g., 'Sonnet 4.5', 'Codex') */
  name: string;
  /** Short display name for compact UI (e.g., 'Sonnet', 'Codex') */
  shortName: string;
  /** Brief description of the model's strengths */
  description: string;
  /** Provider that offers this model */
  provider: ModelProvider;
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Whether model supports extended thinking/reasoning */
  supportsThinking: boolean;
  /** Whether model supports vision/image inputs */
  supportsVision: boolean;
  /** Whether model supports tool/function calling */
  supportsTools: boolean;
  /** Cost per million input tokens (USD) */
  inputCostPerM?: number;
  /** Cost per million output tokens (USD) */
  outputCostPerM?: number;
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
    id: 'claude-opus-4-6',
    name: 'Opus 4.6',
    shortName: 'Opus',
    description: 'Most capable for complex work',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: true,
    supportsVision: true,
    supportsTools: true,
    inputCostPerM: 5.0,
    outputCostPerM: 25.0,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Sonnet 4.5',
    shortName: 'Sonnet',
    description: 'Best for everyday tasks',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: true,
    supportsVision: true,
    supportsTools: true,
    inputCostPerM: 3.0,
    outputCostPerM: 15.0,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Haiku 4.5',
    shortName: 'Haiku',
    description: 'Fastest for quick answers',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: false,
    supportsVision: true,
    supportsTools: true,
    inputCostPerM: 1.0,
    outputCostPerM: 5.0,
  },

  // ----------------------------------------
  // OpenAI Codex Models (via ChatGPT Plus)
  // Model IDs must match actual Codex CLI model identifiers
  // ----------------------------------------
  {
    id: 'gpt-5.3-codex',
    name: 'Codex',
    shortName: 'Codex',
    description: 'OpenAI reasoning model',
    provider: 'openai',
    contextWindow: 256_000,
    supportsThinking: true,
    supportsVision: true,
    supportsTools: true,
    inputCostPerM: 2.0,
    outputCostPerM: 8.0,
  },
  {
    id: 'gpt-5.1-codex-mini',
    name: 'Codex Mini',
    shortName: 'Codex Mini',
    description: 'Fast OpenAI model',
    provider: 'openai',
    contextWindow: 128_000,
    supportsThinking: false,
    supportsVision: true,
    supportsTools: true,
    inputCostPerM: 0.5,
    outputCostPerM: 2.0,
  },
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

/** All OpenAI/Codex models */
export const OPENAI_MODELS = getModelsByProvider('openai');

/**
 * Legacy compatibility export.
 * Used by existing code that imports MODELS (expects Claude models only).
 * @deprecated Use ANTHROPIC_MODELS or MODEL_REGISTRY instead
 */
export const MODELS = ANTHROPIC_MODELS;

// ============================================
// MODEL ID CONSTANTS (Derived from Registry)
// ============================================

/** Get the first model ID matching a short name */
function getModelIdByShortName(shortName: string): string {
  const model = MODEL_REGISTRY.find(m => m.shortName === shortName);
  if (!model) throw new Error(`Model not found: ${shortName}`);
  return model.id;
}

/** Opus model ID - use this instead of hardcoding */
export const OPUS_MODEL_ID = getModelIdByShortName('Opus');

/** Sonnet model ID - use this instead of hardcoding */
export const SONNET_MODEL_ID = getModelIdByShortName('Sonnet');

/** Haiku model ID - use this instead of hardcoding */
export const HAIKU_MODEL_ID = getModelIdByShortName('Haiku');

/** Codex model ID */
export const CODEX_MODEL_ID = getModelIdByShortName('Codex');

/** Codex Mini model ID */
export const CODEX_MINI_MODEL_ID = getModelIdByShortName('Codex Mini');

// ============================================
// PURPOSE-SPECIFIC DEFAULTS
// ============================================

/** Default model for main chat (user-facing) */
export const DEFAULT_MODEL = SONNET_MODEL_ID;

/** Default model for Codex/OpenAI connections */
export const DEFAULT_CODEX_MODEL = CODEX_MODEL_ID;

/** Model for agent definition extraction (always high quality) */
export const EXTRACTION_MODEL = OPUS_MODEL_ID;

/** Model for API response summarization (cost efficient) */
export const SUMMARIZATION_MODEL = HAIKU_MODEL_ID;

/** Model for instruction updates (high quality for accurate document editing) */
export const INSTRUCTION_UPDATE_MODEL = OPUS_MODEL_ID;

/**
 * Models allowed for secondary LLM calls (call_llm tool).
 * Derived from the registry to stay in sync.
 */
export const ALLOWED_LLM_TOOL_MODELS = ANTHROPIC_MODELS.map(m => m.id);

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get a model by ID from the registry.
 */
export function getModelById(modelId: string): ModelDefinition | undefined {
  return MODEL_REGISTRY.find(m => m.id === modelId);
}

/**
 * Get display name for a model ID (full name with version).
 */
export function getModelDisplayName(modelId: string): string {
  const model = getModelById(modelId);
  if (model) return model.name;
  // Fallback: strip prefix and date suffix
  return modelId.replace('claude-', '').replace(/-\d{8}$/, '');
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
  // Fallback: strip claude- prefix and date suffix, then capitalize
  const stripped = modelId.replace('claude-', '').replace(/-[\d.-]+$/, '');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
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
 * Handles both direct Anthropic IDs (e.g. "claude-sonnet-4-5-20250929")
 * and provider-prefixed IDs (e.g. "anthropic/claude-sonnet-4" via OpenRouter).
 */
export function isClaudeModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.startsWith('claude-') || lower.includes('/claude');
}

/**
 * Check if a model ID refers to a Codex/OpenAI model.
 * Matches patterns like 'gpt-5.2-codex', 'gpt-5.1-codex-mini', etc.
 */
export function isCodexModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.includes('codex');
}

/**
 * Get the provider for a model ID.
 */
export function getModelProvider(modelId: string): ModelProvider | undefined {
  return getModelById(modelId)?.provider;
}

/**
 * Get the default model ID for a provider.
 */
export function getDefaultModelForProvider(provider: ModelProvider): string {
  return provider === 'openai' ? DEFAULT_CODEX_MODEL : DEFAULT_MODEL;
}

/**
 * Convert registry models to settings dropdown options for a provider.
 */
export function getModelOptionsForProvider(provider: ModelProvider): Array<{ value: string; label: string; description: string }> {
  return getModelsByProvider(provider).map(m => ({
    value: m.id,
    label: m.name,
    description: m.description,
  }));
}
