/**
 * Thinking Level Configuration
 *
 * Five-tier thinking system for extended reasoning:
 * - OFF: No extended thinking (disabled)
 * - Low: Light reasoning, faster responses
 * - Medium: Balanced speed and reasoning (default)
 * - High: Deep reasoning for complex tasks
 * - Max: Maximum effort reasoning
 *
 * Session-level setting with workspace defaults.
 *
 * Provider mappings:
 * - Anthropic: adaptive thinking + effort levels (Opus 4.6+)
 * - Pi/OpenAI: reasoning_effort via Pi SDK levels
 */

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

export interface ThinkingLevelDefinition {
  id: ThinkingLevel;
  name: string;
  description: string;
}

/**
 * Available thinking levels with display metadata.
 * Used in UI dropdowns and for validation.
 *
 * Labels are user-facing and should be consistent across all UI surfaces
 * (model dropdown, workspace settings, etc.)
 */
export const THINKING_LEVELS: readonly ThinkingLevelDefinition[] = [
  { id: 'off', name: 'No Thinking', description: 'Fastest responses, no reasoning' },
  { id: 'low', name: 'Low', description: 'Light reasoning, faster responses' },
  { id: 'medium', name: 'Medium', description: 'Balanced speed and reasoning' },
  { id: 'high', name: 'High', description: 'Deep reasoning for complex tasks' },
  { id: 'max', name: 'Max', description: 'Maximum effort reasoning' },
] as const;

/** Default thinking level for new sessions when workspace has no default */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';

/**
 * Map ThinkingLevel to Anthropic SDK effort parameter.
 * Used with adaptive thinking (thinking: { type: 'adaptive' }).
 * Returns null for 'off' (thinking should be disabled entirely).
 */
export const THINKING_TO_EFFORT: Record<ThinkingLevel, 'low' | 'medium' | 'high' | 'max' | null> = {
  off: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'max',
};

/**
 * Token budgets per model family.
 * Used as fallback for models that don't support adaptive thinking
 * (e.g., non-Claude models via OpenRouter/Ollama).
 *
 * Haiku max is 8k per Anthropic docs.
 * Sonnet/Opus can use up to 128k, but Anthropic recommends ≤32k for real-time use
 * (above 32k, batch processing is suggested to avoid timeouts).
 */
const TOKEN_BUDGETS = {
  haiku: {
    off: 0,
    low: 2_000,
    medium: 4_000,
    high: 6_000,
    max: 8_000,
  },
  default: {
    off: 0,
    low: 4_000,
    medium: 10_000,
    high: 20_000,
    max: 32_000,
  },
} as const;

/**
 * Get the thinking token budget for a given level and model.
 * Used as fallback for models that don't support adaptive thinking.
 *
 * @param level - The thinking level
 * @param modelId - The model ID (e.g., 'claude-haiku-4-5-20251001')
 * @returns Number of thinking tokens to allocate
 */
export function getThinkingTokens(level: ThinkingLevel, modelId: string): number {
  const isHaiku = modelId.toLowerCase().includes('haiku');
  const budgets = isHaiku ? TOKEN_BUDGETS.haiku : TOKEN_BUDGETS.default;
  return budgets[level];
}

/**
 * Get display name for a thinking level.
 */
export function getThinkingLevelName(level: ThinkingLevel): string {
  const def = THINKING_LEVELS.find((l) => l.id === level);
  return def?.name ?? level;
}

/**
 * Validate that a value is a valid ThinkingLevel.
 */
export function isValidThinkingLevel(value: unknown): value is ThinkingLevel {
  return value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'max';
}

/**
 * Normalize a persisted thinking level value, handling legacy values.
 * Maps the old 'think' value to 'medium' for backward compatibility.
 *
 * TODO: Remove the legacy 'think' compatibility path after old persisted session
 * and workspace data has realistically aged out across upgrades.
 *
 * @returns The normalized ThinkingLevel, or undefined if the value is invalid
 */
export function normalizeThinkingLevel(value: unknown): ThinkingLevel | undefined {
  if (value === 'think') return 'medium';
  if (isValidThinkingLevel(value)) return value;
  return undefined;
}
