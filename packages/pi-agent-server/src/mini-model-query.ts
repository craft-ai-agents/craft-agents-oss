import type { ModelRegistry as PiModelRegistry } from '@earendil-works/pi-coding-agent';
import type { LLMQueryResult } from '../../shared/src/agent/llm-tool.ts';
import { getDefaultSummarizationModel } from '../../shared/src/config/models.ts';
import { PI_PREFERRED_DEFAULTS } from '../../shared/src/config/llm-connections.ts';
import { stripPiPrefix } from './custom-endpoint-models.ts';
import { isDeniedMiniModelId, isModelRejectionError, isModelUsableWithAuth, resolvePiModel } from './model-resolution.ts';

interface MiniModelQueryOptions {
  model: string;
  miniModel?: string;
  sessionModel?: string;
  authProvider?: string;
  modelRegistry: PiModelRegistry;
  /** A custom endpoint is configured: only its own models may be retried. */
  customEndpointOnly: boolean;
  onFallback?: (rejectedModel: string, retryModel: string) => void;
}

/**
 * Run a utility query, retrying only model rejections within the authenticated provider.
 * A catalog entry can resolve locally yet be unavailable to a ChatGPT account (notably
 * gpt-5.4-mini). Keep cheap fallbacks first, then the selected session model and provider
 * defaults; never assume the first locally resolvable model is accepted by the account.
 * The caller retains the single request deadline/cancellation scope across all attempts.
 */
export async function queryMiniModel(
  options: MiniModelQueryOptions,
  runQuery: (model: string) => Promise<string>,
): Promise<LLMQueryResult> {
  const fallbackCandidates = [
    'pi/gpt-5-mini',
    options.miniModel,
    getDefaultSummarizationModel(),
    options.sessionModel,
    ...(options.authProvider ? PI_PREFERRED_DEFAULTS[options.authProvider] ?? [] : []),
  ].filter((candidate): candidate is string => !!candidate && !isDeniedMiniModelId(candidate, options.authProvider));

  const triedModels = new Set<string>();
  let currentModel = options.model;

  while (true) {
    triedModels.add(stripPiPrefix(currentModel));
    try {
      const text = await runQuery(currentModel);
      return { text, model: currentModel };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isModelRejectionError(message, stripPiPrefix(currentModel))) throw error;

      const retryModel = fallbackCandidates.find(candidate => {
        if (triedModels.has(stripPiPrefix(candidate))) return false;
        const resolved = resolvePiModel(options.modelRegistry, candidate, options.authProvider, options.customEndpointOnly);
        return isModelUsableWithAuth(resolved?.provider, options.authProvider, options.customEndpointOnly);
      });
      if (!retryModel) throw error;

      options.onFallback?.(currentModel, retryModel);
      currentModel = retryModel;
    }
  }
}
