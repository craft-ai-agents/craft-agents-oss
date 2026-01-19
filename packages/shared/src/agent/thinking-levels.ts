/**
 * Thinking Level Configuration
 *
 * Three-tier thinking system for extended reasoning:
 * - OFF: No extended thinking (0 tokens)
 * - Think: Standard reasoning (moderate token budget)
 * - Max Think: Deep reasoning (maximum token budget)
 *
 * Session-level setting with workspace defaults.
 * Ultrathink override can boost to Max Think for a single message.
 */

export type ThinkingLevel = 'off' | 'think' | 'max';

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
  { id: 'think', name: 'Thinking', description: 'Balanced speed and reasoning' },
  { id: 'max', name: 'Max Thinking', description: 'Deepest reasoning for complex tasks' },
] as const;

/** Default thinking level for new sessions when workspace has no default */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'think';

/**
 * Token budgets per model family.
 *
 * Haiku has a lower max (8k per Anthropic docs).
 * Sonnet/Opus: max_tokens limit is 64k total (thinking + output combined).
 * We use 32k for max thinking to leave room for output tokens.
 *
 * "Think" level matches Claude Code's `think` trigger word budget.
 * "Max Think" uses half the budget to leave room for output.
 */
const TOKEN_BUDGETS = {
  haiku: {
    off: 0,
    think: 4_000,
    max: 8_000,
  },
  default: {
    off: 0,
    think: 10_000,
    max: 32_000,
  },
} as const;

/**
 * Get the thinking token budget for a given level and model.
 *
 * @param level - The thinking level (off, think, max)
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
  return value === 'off' || value === 'think' || value === 'max';
}
