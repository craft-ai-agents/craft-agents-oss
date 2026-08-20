/**
 * PanelRegistry implementation (S-03 §3.5).
 *
 * Pure TS store keyed by contribution id. Duplicate id: throw + log
 * (S-03 §3.5 — the first registration wins, the colliding one errors).
 */

import type { Disposable } from '../types.ts';
import { evaluateWhen } from '../context-keys/evaluate-when.ts';
import type { ContextKeys } from '../context-keys/types.ts';
import { orderPanels } from './ordering.ts';
import type { PanelContribution, PanelRegistry, PanelSlot } from './types.ts';

class PanelRegistryImpl implements PanelRegistry {
  private readonly contributions = new Map<string, PanelContribution>();
  private readonly listeners = new Set<() => void>();

  register(contribution: PanelContribution): Disposable {
    if (this.contributions.has(contribution.id)) {
      console.error(`[PanelRegistry] duplicate contribution id: ${contribution.id}`);
      throw new Error(`Panel contribution id already registered: ${contribution.id}`);
    }
    this.contributions.set(contribution.id, contribution);
    this.notify();
    return {
      dispose: () => {
        if (this.contributions.delete(contribution.id)) this.notify();
      },
    };
  }

  list(slot: PanelSlot, ctx: ContextKeys): PanelContribution[] {
    const matching: PanelContribution[] = [];
    for (const contribution of this.contributions.values()) {
      if (contribution.slot !== slot) continue;
      if (!evaluateWhen(contribution.when, ctx)) continue;
      matching.push(contribution);
    }
    return orderPanels(matching);
  }

  get(id: string): PanelContribution | undefined {
    return this.contributions.get(id);
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createPanelRegistry(): PanelRegistry {
  return new PanelRegistryImpl();
}
