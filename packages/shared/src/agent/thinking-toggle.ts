export type ThinkingEnabled = boolean;

export const DEFAULT_THINKING_ENABLED: ThinkingEnabled = true;

export const THINKING_ENABLEDS = [
  { id: true, nameKey: 'thinking.on', descriptionKey: 'thinking.onDesc' },
  { id: false, nameKey: 'thinking.off', descriptionKey: 'thinking.offDesc' },
] as const;

const LEGACY_ENABLED_THINKING_LEVELS = new Set(['think', 'low', 'medium', 'high', 'xhigh', 'max']);

export function normalizeThinkingEnabled(value: unknown): ThinkingEnabled | undefined {
  if (value === undefined) return undefined;
  if (value === true) return true;
  if (value === false) return false;
  if (value === 'off') return false;
  if (typeof value === 'string' && LEGACY_ENABLED_THINKING_LEVELS.has(value)) return true;
  return undefined;
}

export function getThinkingEnabledNameKey(enabled: ThinkingEnabled): string {
  return enabled ? 'thinking.on' : 'thinking.off';
}
