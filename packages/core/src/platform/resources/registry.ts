/**
 * ResourceProviderRegistry implementation (S-04 §3.6 / W3 frozen contract).
 *
 * Fan-out search across prefix-eligible providers; merge + sort by score desc.
 * Per-provider failures are isolated (logged, empty contribution). AbortSignal
 * short-circuits remaining work when already aborted.
 */

import type { Disposable } from '../types.ts';
import type {
  ResourceItem,
  ResourceProvider,
  ResourceProviderRegistry,
  ResourceSearchContext,
} from './types.ts';

const DEFAULT_LIMIT = 50;

function sortByScoreDesc(items: ResourceItem[]): ResourceItem[] {
  return items.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

class ResourceProviderRegistryImpl implements ResourceProviderRegistry {
  private readonly providers = new Map<string, ResourceProvider>();
  private readonly listeners = new Set<() => void>();

  register(provider: ResourceProvider): Disposable {
    if (this.providers.has(provider.id)) {
      console.error(`[ResourceProviderRegistry] duplicate provider id: ${provider.id}`);
      throw new Error(`Resource provider id already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    this.notify();
    return {
      dispose: () => {
        if (this.providers.delete(provider.id)) this.notify();
      },
    };
  }

  get(id: string): ResourceProvider | undefined {
    return this.providers.get(id);
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async search(ctx: ResourceSearchContext): Promise<ResourceItem[]> {
    if (ctx.signal?.aborted) return [];

    const limit = ctx.limit ?? DEFAULT_LIMIT;
    const eligible = [...this.providers.values()].filter((provider) =>
      provider.prefixes.includes(ctx.prefix),
    );

    const settled = await Promise.all(
      eligible.map(async (provider) => {
        if (ctx.signal?.aborted) return [] as ResourceItem[];
        try {
          const items = await provider.search(ctx);
          if (ctx.signal?.aborted) return [] as ResourceItem[];
          return items.map((item) => ({
            ...item,
            // Stamp provider for host diagnostics without changing contract.
            data: { ...item.data, providerId: provider.id },
          }));
        } catch (err) {
          console.error(
            `[ResourceProviderRegistry] provider "${provider.id}" search failed:`,
            err,
          );
          return [] as ResourceItem[];
        }
      }),
    );

    if (ctx.signal?.aborted) return [];
    return sortByScoreDesc(settled.flat()).slice(0, limit);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createResourceProviderRegistry(): ResourceProviderRegistry {
  return new ResourceProviderRegistryImpl();
}
