import type { ModelRegistry as PiModelRegistry } from '@mariozechner/pi-coding-agent';
import { resolvePiModel, isDeniedMiniModelId } from './model-resolution.ts';
import { PI_PREFERRED_DEFAULTS } from '../../shared/src/config/llm-connections.ts';

/**
 * Pick an auth-provider-appropriate default mini model.
 *
 * `getDefaultSummarizationModel()` returns `claude-haiku-4-5`, which only resolves
 * under `anthropic` auth. For `openai` / `openai-codex` / `google` /
 * `github-copilot` / `amazon-bedrock` / `zai` we need a model from that provider's
 * preferred list — otherwise the ephemeral session ends up with no explicit
 * model and Pi SDK's internal default (post-0.70.0 an openai model) is used,
 * surfacing as a misleading "No API key found for openai" error when the user
 * is authenticated under a different provider.
 *
 * Resolution order:
 * 1. Walk `PI_PREFERRED_DEFAULTS[authProvider]` and return the first candidate
 *    that is not denied by `isDeniedMiniModelId` and resolves via `resolvePiModel`.
 * 2. If no preferred defaults exist for this provider (e.g. 'zai' or a future
 *    provider), scan the model registry for any model under that provider.
 *
 * Returns `undefined` when there is no resolvable candidate; callers should
 * fall back to `getDefaultSummarizationModel()` in that case — but only if
 * the provider is 'anthropic' (where Haiku resolves). For other providers,
 * callers should treat an undefined return as a hard failure.
 */
export function pickProviderAppropriateMiniModel(
  authProvider: string,
  modelRegistry: PiModelRegistry,
  preferCustomEndpoint: boolean,
): string | undefined {
  // 1. Try the curated preferred defaults list
  const preferred = PI_PREFERRED_DEFAULTS[authProvider];
  if (preferred && preferred.length > 0) {
    for (const candidate of preferred) {
      if (isDeniedMiniModelId(candidate, authProvider)) continue;
      const resolved = resolvePiModel(modelRegistry, candidate, authProvider, preferCustomEndpoint);
      if (resolved) return candidate;
    }
  }

  // 2. Registry scan fallback: when the provider has no preferred defaults entry
  //    (or all entries failed to resolve), scan the model registry for any
  //    available model under this provider. This covers providers like 'zai'
  //    or newly-added providers that haven't been added to PI_PREFERRED_DEFAULTS yet.
  const allModels = modelRegistry.getAll();
  const providerModels = allModels.filter(
    (m: any) => m.provider === authProvider
  );
  // Pick the first non-denied model, preferring cheaper/smaller models
  // (heuristic: sort by name length — shorter names tend to be base/pro models)
  const sorted = providerModels.sort((a: any, b: any) => {
    // Prefer non-reasoning models (cheaper for call_llm)
    if (a.reasoning !== b.reasoning) return a.reasoning ? 1 : -1;
    return (a.id?.length ?? 0) - (b.id?.length ?? 0);
  });
  for (const model of sorted) {
    const id = model.id as string;
    if (isDeniedMiniModelId(id, authProvider)) continue;
    return id;
  }

  return undefined;
}