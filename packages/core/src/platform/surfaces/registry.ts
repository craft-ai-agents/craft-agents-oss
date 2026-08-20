/**
 * SurfaceRegistry implementation (S-02 §3.3).
 *
 * One contribution per SurfaceTab kind. Duplicate kind: throw + log (same
 * discipline as PanelRegistry, S-03 §3.5). Resolution order is registration
 * order; null resolution = legacy renderer fallback.
 */

import type { Disposable } from '../types.ts';
import type { SurfaceContribution, SurfaceRegistry, SurfaceTabKind } from './types.ts';

class SurfaceRegistryImpl<TNav = unknown> implements SurfaceRegistry<TNav> {
  private readonly contributions = new Map<SurfaceTabKind, SurfaceContribution<TNav>>();
  private readonly listeners = new Set<() => void>();

  register(contribution: SurfaceContribution<TNav>): Disposable {
    if (this.contributions.has(contribution.kind)) {
      console.error(`[SurfaceRegistry] duplicate contribution kind: ${contribution.kind}`);
      throw new Error(`Surface contribution kind already registered: ${contribution.kind}`);
    }
    this.contributions.set(contribution.kind, contribution);
    this.notify();
    return {
      dispose: () => {
        this.unregister(contribution.kind);
      },
    };
  }

  unregister(kind: SurfaceTabKind): void {
    if (this.contributions.delete(kind)) this.notify();
  }

  get(kind: SurfaceTabKind): SurfaceContribution<TNav> | undefined {
    return this.contributions.get(kind);
  }

  list(): SurfaceContribution<TNav>[] {
    return [...this.contributions.values()];
  }

  resolve(navState: TNav): SurfaceContribution<TNav> | null {
    for (const contribution of this.contributions.values()) {
      if (contribution.match(navState) !== null) return contribution;
    }
    return null;
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createSurfaceRegistry<TNav = unknown>(): SurfaceRegistry<TNav> {
  return new SurfaceRegistryImpl<TNav>();
}
