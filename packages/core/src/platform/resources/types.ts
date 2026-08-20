/**
 * Resource Provider Registry model — frozen W3 Omnibox contract (S-04 §3.6).
 *
 * Pure TS store: providers register, `search` fans out by prefix, merges and
 * sorts by score. Open/mention routing is host-side via `route` / `data`.
 */

import type { Disposable } from '../types.ts';
import type { ContextKeySnapshot } from '../context-keys/types.ts';

export type ResourceKind =
  | 'session'
  | 'knowledge'
  | 'skill'
  | 'source'
  | 'settings'
  | 'automation'
  | 'cloud-run'
  | 'label'
  | 'file'
  | 'command-hint';

export interface ResourceItem {
  id: string;
  kind: ResourceKind;
  title: string;
  subtitle?: string;
  icon?: string;
  /** Route string or open handler key */
  route?: string;
  /** Extra payload for open/mention */
  data?: Record<string, unknown>;
  score?: number;
}

export interface ResourceSearchContext {
  query: string;
  prefix: '' | '>' | '@' | '/' | '!' | '?' | '#';
  keys: ContextKeySnapshot;
  signal?: AbortSignal;
  limit?: number;
}

export interface ResourceProvider {
  id: string;
  label: string;
  /** Which prefixes this provider participates in (empty prefix = universal) */
  prefixes: Array<ResourceSearchContext['prefix']>;
  search(ctx: ResourceSearchContext): Promise<ResourceItem[]>;
}

export interface ResourceProviderRegistry {
  register(provider: ResourceProvider): Disposable;
  /** Merge + sort by score (desc). Prefix-filters providers first. */
  search(ctx: ResourceSearchContext): Promise<ResourceItem[]>;
  get(id: string): ResourceProvider | undefined;
  onDidChange(listener: () => void): Disposable;
}
