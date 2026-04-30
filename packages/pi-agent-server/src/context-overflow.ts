export const DEFAULT_AUTO_COMPACT_THRESHOLD = 0.90;
export const DEFAULT_PRE_PROMPT_HEADROOM_TOKENS = 32_000;
export const MAX_OVERFLOW_RECOVERY_ATTEMPTS = 1;

export interface PrePromptCompactDecision {
  shouldCompact: boolean;
  reason: 'known_usage_near_limit' | 'projected_usage_exceeds_limit' | null;
  autoCompactLimit: number;
  prePromptLimit: number;
  projectedTokens: number;
}

export interface PrePromptCompactInput {
  contextWindow?: number;
  lastKnownInputTokens: number;
  pendingInputTokens: number;
  threshold?: number;
  headroomTokens?: number;
}

export function isContextOverflowErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('context_length_exceeded') ||
    normalized.includes('exceeds the context window') ||
    (normalized.includes('context window') && normalized.includes('exceed')) ||
    normalized.includes('too many tokens') ||
    normalized.includes('token limit exceeded')
  );
}

export function getAutoCompactTokenLimit(
  contextWindow: number,
  threshold = DEFAULT_AUTO_COMPACT_THRESHOLD,
): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 0;
  if (!Number.isFinite(threshold) || threshold <= 0) return contextWindow;
  return Math.floor(contextWindow * Math.min(threshold, 1));
}

export function shouldPrePromptCompact(input: PrePromptCompactInput): PrePromptCompactDecision {
  const contextWindow = input.contextWindow ?? 0;
  const autoCompactLimit = getAutoCompactTokenLimit(contextWindow, input.threshold);
  const lastKnownInputTokens = Math.max(0, input.lastKnownInputTokens || 0);
  const pendingInputTokens = Math.max(0, input.pendingInputTokens || 0);
  const projectedTokens = lastKnownInputTokens + pendingInputTokens;
  const requestedHeadroom = input.headroomTokens ?? DEFAULT_PRE_PROMPT_HEADROOM_TOKENS;
  const boundedHeadroom = Math.min(
    Math.max(0, requestedHeadroom),
    Math.floor(Math.max(0, contextWindow) * 0.25),
  );
  const prePromptLimit = Math.max(0, autoCompactLimit - boundedHeadroom);

  if (!contextWindow || !autoCompactLimit) {
    return {
      shouldCompact: false,
      reason: null,
      autoCompactLimit,
      prePromptLimit,
      projectedTokens,
    };
  }

  if (lastKnownInputTokens >= prePromptLimit) {
    return {
      shouldCompact: true,
      reason: 'known_usage_near_limit',
      autoCompactLimit,
      prePromptLimit,
      projectedTokens,
    };
  }

  if (projectedTokens >= autoCompactLimit) {
    return {
      shouldCompact: true,
      reason: 'projected_usage_exceeds_limit',
      autoCompactLimit,
      prePromptLimit,
      projectedTokens,
    };
  }

  return {
    shouldCompact: false,
    reason: null,
    autoCompactLimit,
    prePromptLimit,
    projectedTokens,
  };
}
