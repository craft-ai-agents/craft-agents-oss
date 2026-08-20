/**
 * CommandRegistry implementation (S-04 §3.5).
 *
 * Pure TS store keyed by command id. Duplicate id: throw + log (same
 * discipline as PanelRegistry, S-03 §3.5).
 */

import type { Disposable } from '../types.ts';
import { evaluateWhen } from '../context-keys/evaluate-when.ts';
import type { ContextKeys } from '../context-keys/types.ts';
import type { CommandContribution, CommandQuery, CommandRegistry } from './types.ts';

function matchesText(command: CommandContribution, text: string): boolean {
  const needle = text.toLowerCase();
  if (command.title.toLowerCase().includes(needle)) return true;
  if (command.category.toLowerCase().includes(needle)) return true;
  return command.keywords?.some((keyword) => keyword.toLowerCase().includes(needle)) ?? false;
}

class CommandRegistryImpl implements CommandRegistry {
  private readonly contributions = new Map<string, CommandContribution>();
  private readonly listeners = new Set<() => void>();

  register(contribution: CommandContribution): Disposable {
    if (this.contributions.has(contribution.id)) {
      console.error(`[CommandRegistry] duplicate contribution id: ${contribution.id}`);
      throw new Error(`Command contribution id already registered: ${contribution.id}`);
    }
    this.contributions.set(contribution.id, contribution);
    this.notify();
    return {
      dispose: () => {
        if (this.contributions.delete(contribution.id)) this.notify();
      },
    };
  }

  query(query: CommandQuery, keys: ContextKeys): CommandContribution[] {
    const text = query.text?.trim();
    const result: CommandContribution[] = [];
    for (const contribution of this.contributions.values()) {
      if (!evaluateWhen(contribution.when, keys)) continue;
      if (query.source !== undefined && contribution.source !== query.source) continue;
      if (text !== undefined && text !== '' && !matchesText(contribution, text)) continue;
      result.push(contribution);
    }
    return result;
  }

  get(id: string): CommandContribution | undefined {
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

export function createCommandRegistry(): CommandRegistry {
  return new CommandRegistryImpl();
}
