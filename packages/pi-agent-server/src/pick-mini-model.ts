import type { ModelRegistry as PiModelRegistry } from '@earendil-works/pi-coding-agent';
import { resolvePiModel, isDeniedMiniModelId } from './model-resolution.ts';
import { PI_PREFERRED_DEFAULTS, PI_PREFERRED_MINI_MODELS } from '../../shared/src/config/llm-connections.ts';

/**
 * Pick an auth-provider-appropriate default mini model.
 *
 * `getDefaultSummarizationModel()` returns a Claude Haiku, which only resolves
 * under `anthropic` auth. For `openai` / `openai-codex` / `google` /
 * `github-copilot` / `amazon-bedrock` we need a model from that provider's
 * preferred list — otherwise the ephemeral session ends up with no explicit
 * model and Pi SDK's internal default (post-0.70.0 an openai model) is used,
 * surfacing as a misleading "No API key found for openai" error when the user
 * is authenticated under a different provider.
 *
 * Walks `PI_PREFERRED_MINI_MODELS[authProvider]` (the provider's utility tier),
 * then `PI_PREFERRED_DEFAULTS[authProvider]` (best first, so its most capable
 * model only as a last resort), and returns the first candidate that is not
 * denied by `isDeniedMiniModelId` and resolves via `resolvePiModel`.
 *
 * Returns `undefined` when there is no resolvable candidate; callers should
 * fall back to `getDefaultSummarizationModel()` in that case.
 */
export function pickProviderAppropriateMiniModel(
  authProvider: string,
  modelRegistry: PiModelRegistry,
  customEndpointOnly: boolean,
): string | undefined {
  const preferred = [...(PI_PREFERRED_MINI_MODELS[authProvider] ?? []), ...(PI_PREFERRED_DEFAULTS[authProvider] ?? [])];
  for (const candidate of preferred) {
    if (isDeniedMiniModelId(candidate, authProvider)) continue;
    const resolved = resolvePiModel(modelRegistry, candidate, authProvider, customEndpointOnly);
    if (resolved) return candidate;
  }
  return undefined;
}
