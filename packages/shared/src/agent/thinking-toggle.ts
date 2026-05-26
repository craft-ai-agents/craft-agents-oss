export type ThinkingEnabled = boolean;

export const DEFAULT_THINKING_ENABLED: ThinkingEnabled = true;

export const THINKING_ENABLEDS = [
  { id: true, nameKey: 'thinking.on', descriptionKey: 'thinking.onDesc' },
  { id: false, nameKey: 'thinking.off', descriptionKey: 'thinking.offDesc' },
] as const;

export function normalizeThinkingEnabled(value: unknown): ThinkingEnabled | undefined {
  if (value === undefined) return undefined;
  if (value === false || value === 'off') return false;
  if (value) return true;
  return undefined;
}

export function getThinkingEnabledNameKey(enabled: ThinkingEnabled): string {
  return enabled ? 'thinking.on' : 'thinking.off';
}
