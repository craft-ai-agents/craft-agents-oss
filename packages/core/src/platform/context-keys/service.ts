/**
 * ContextKeyService implementation (S-04 §3.7).
 *
 * Module-level mutable store + pull-based providers; snapshots are computed
 * synchronously on demand. No React, no event loop dependencies.
 */

import type { Disposable } from '../types.ts';
import { evaluateWhen } from './evaluate-when.ts';
import type { ContextKeyProvider, ContextKeys, ContextKeyService, ContextKeySnapshot } from './types.ts';

class ContextKeyServiceImpl implements ContextKeyService {
  private readonly values = new Map<string, unknown>();
  private readonly providers = new Set<ContextKeyProvider>();
  private readonly listeners = new Set<(changedKey: string) => void>();

  get(key: string): unknown {
    return this.snapshot()[key];
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
    for (const listener of this.listeners) listener(key);
  }

  subscribe(listener: (changedKey: string) => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  registerProvider(provider: ContextKeyProvider): Disposable {
    this.providers.add(provider);
    return { dispose: () => this.providers.delete(provider) };
  }

  snapshot(): ContextKeySnapshot {
    const merged: Record<string, unknown> = Object.fromEntries(this.values);
    for (const provider of this.providers) {
      Object.assign(merged, provider.pull());
    }
    return merged;
  }

  evaluateWhen(expression: string | undefined, keys: ContextKeys = this.snapshot()): boolean {
    return evaluateWhen(expression, keys);
  }
}

export function createContextKeyService(): ContextKeyService {
  return new ContextKeyServiceImpl();
}
