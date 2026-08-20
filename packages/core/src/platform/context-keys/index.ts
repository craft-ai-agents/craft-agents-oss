/**
 * Context Key Service — shared when-language for panels, commands, and the
 * future omnibox (S-04 §3.7, S-03 §3.9).
 */

export type { ContextKeys, ContextKeyProvider, ContextKeyService, ContextKeySnapshot } from './types.ts';
export { evaluateWhen } from './evaluate-when.ts';
export { createContextKeyService } from './service.ts';
