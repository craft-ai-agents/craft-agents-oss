/**
 * Resource Provider Registry (S-04 §3.6) — pure-TS federated search for the
 * Omnibox navigation section.
 */

export type {
  ResourceKind,
  ResourceItem,
  ResourceSearchContext,
  ResourceProvider,
  ResourceProviderRegistry,
} from './types.ts';
export { createResourceProviderRegistry } from './registry.ts';
