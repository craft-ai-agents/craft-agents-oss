/**
 * Context Key Service contracts (S-04 §3.7, S-03 §3.9).
 *
 * Values form a flat snapshot (dotted keys like `selectedBlocks.count` are
 * first-class; publishers may also provide nested objects — the evaluator
 * resolves both, see evaluate-when.ts). Expressions are evaluated
 * synchronously over a snapshot at keydown/palette-open time: zero React
 * subscriptions, zero re-renders.
 */

import type { Disposable } from '../types.ts';

/** Flat key/value view used by `when` expressions (S-03 §3.5: `ctx: ContextKeys`). */
export type ContextKeys = Readonly<Record<string, unknown>>;

/** Immutable point-in-time view of all context keys. */
export type ContextKeySnapshot = ContextKeys;

/**
 * A source of context key values (S-04 §3.7). Providers are pull-based: the
 * service asks them during `snapshot()` so values are always current.
 */
export interface ContextKeyProvider {
  /** Keys this provider publishes (for introspection/palette hints). */
  keys: string[];
  /** Compute the current values; called on every snapshot(). */
  pull(): Partial<ContextKeySnapshot>;
}

export interface ContextKeyService {
  /** Current value of a key (provider values win over stored ones). */
  get(key: string): unknown;
  /** Store a value and notify subscribers. Stored values are fallback for providers. */
  set(key: string, value: unknown): void;
  /** Fires with the changed key after each set(). */
  subscribe(listener: (changedKey: string) => void): Disposable;
  /** Register a pull-based provider (S-04 §3.7). */
  registerProvider(provider: ContextKeyProvider): Disposable;
  /** Merge stored values with all provider pulls. Providers win on conflict. */
  snapshot(): ContextKeySnapshot;
  /** Evaluate a `when` expression; defaults to the current snapshot. */
  evaluateWhen(expression: string | undefined, keys?: ContextKeys): boolean;
}
