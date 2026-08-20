/**
 * Command Registry model — verbatim contract from S-04 §3.5.
 *
 * Execution routing (Craft native RPC / SiYuan bridge / extension host /
 * skill-automation) is host-side; the registry is a pure store with
 * context-aware query.
 */

import type { Disposable } from '../types.ts';
import type { ContextKeys, ContextKeySnapshot } from '../context-keys/types.ts';

/** Verbatim S-04 §3.5. */
export interface CommandContribution {
  id: string;
  title: string;
  category: string;
  source: 'craft' | 'siyuan' | 'siyuan-plugin' | 'extension' | 'skill' | 'automation';
  when?: string;
  keywords?: string[];
  defaultHotkey?: string;
  permissions?: string[];
  execute(context: CommandContext): Promise<void>;
}

/**
 * Given to execute() (S-04 §3.5): a snapshot of context keys plus
 * host-provided service handles for dispatch.
 */
export interface CommandContext {
  /** Snapshot from the Context Key Service at execution time (S-04 §3.7). */
  keys: ContextKeySnapshot;
  /** Host-provided dispatch handles (RPC, bridges); untyped in W1. */
  services?: Record<string, unknown>;
}

/** Query filter for CommandRegistry.query. */
export interface CommandQuery {
  /** Matches (case-insensitive substring) against title, category, keywords. */
  text?: string;
  source?: CommandContribution['source'];
}

export interface CommandRegistry {
  register(contribution: CommandContribution): Disposable;
  /**
   * Context-aware lookup: a command is eligible only when its `when`
   * expression evaluates true against `keys` (S-04 §3.5), then the optional
   * text/source filters apply. Registration order is preserved.
   */
  query(query: CommandQuery, keys: ContextKeys): CommandContribution[];
  get(id: string): CommandContribution | undefined;
  onDidChange(listener: () => void): Disposable;
}
