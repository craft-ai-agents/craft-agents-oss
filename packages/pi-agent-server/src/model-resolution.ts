import type { ModelRegistry as PiModelRegistry } from '@mariozechner/pi-coding-agent';

// Re-export the PiModel type used by callers
type PiModel<T = any> = ReturnType<PiModelRegistry['find']>;

/**
 * Resolve a Pi SDK model from the registry, with optional custom-endpoint precedence.
 *
 * Resolution order:
 * 1. If `preferCustomEndpoint` is true, try `'custom-endpoint'` provider first
 * 2. Exact provider+model lookup via `piAuthProvider`
 * 3. Full `getAll()` scan by id/name
 * 4. Common provider fallback list (includes 'custom-endpoint')
 */
export function resolvePiModel(
  modelRegistry: PiModelRegistry,
  modelId: string,
  piAuthProvider?: string,
  preferCustomEndpoint?: boolean,
): PiModel | undefined {
  // Strip Craft's pi/ prefix — Pi SDK uses bare model IDs (e.g. "claude-sonnet-4-6")
  const bareId = modelId.startsWith('pi/') ? modelId.slice(3) : modelId;

  // Custom-endpoint takes precedence when configured
  if (preferCustomEndpoint) {
    const custom = modelRegistry.find('custom-endpoint', bareId);
    if (custom) return custom;
  }

  // If we know the auth provider, do an exact provider+model lookup first.
  // This avoids the getAll() ambiguity where the same model ID exists under
  // multiple providers (e.g., "gpt-5.2" under both "openai" and
  // "azure-openai-responses") and the wrong one matches first.
  if (piAuthProvider) {
    const exact = modelRegistry.find(piAuthProvider, bareId);
    if (exact) {
      // MiniMax CN API rejects model IDs with the 'MiniMax-' prefix (e.g. 500 for
      // 'MiniMax-M2.5-highspeed') but accepts bare names ('M2.5-highspeed').
      if (piAuthProvider === 'minimax-cn' && exact.id.startsWith('MiniMax-')) {
        return { ...exact, id: exact.id.slice('MiniMax-'.length) };
      }
      return exact;
    }

    // Model not found in the static catalog for this provider.
    //
    // Synthesize a model entry using a same-provider template rather than
    // falling through to the getAll() scan below, which might match the model
    // under a DIFFERENT provider (e.g. "gpt-5.4" exists under both
    // "github-copilot" in newer pi-ai versions AND "azure-openai-responses" in
    // older ones). If the pi-agent-server bundles an older pi-ai than the main
    // process, getAll() would wrongly pick "azure-openai-responses" → runtime
    // error: "No API key found for azure-openai-responses".
    //
    // By synthesizing from a same-provider template we ensure the correct
    // API type, baseUrl, and auth headers are used regardless of SDK version skew.
    const allModels = modelRegistry.getAll();

    // Look up the model across all providers to get an API-type hint.
    const anyMatch = allModels.find(m => m.id === bareId || m.name === bareId);
    const targetApi = anyMatch?.api;

    // Prefer a template with the same API type (e.g. openai-responses vs anthropic-messages).
    const sameProviderTemplate = targetApi
      ? (allModels.find(m => m.provider === piAuthProvider && m.api === targetApi)
         ?? allModels.find(m => m.provider === piAuthProvider))
      : allModels.find(m => m.provider === piAuthProvider);

    if (sameProviderTemplate) {
      return {
        ...sameProviderTemplate,
        id: bareId,
        name: anyMatch?.name ?? bareId,
      };
    }
  }

  // Fallback: search all available models (only reached when piAuthProvider is unset)
  const allModels = modelRegistry.getAll();
  const match = allModels.find(m => m.id === bareId || m.name === bareId);
  if (match) return match;

  // Try common providers with the model ID
  const providers = ['custom-endpoint', 'anthropic', 'openai', 'google'];
  for (const provider of providers) {
    const model = modelRegistry.find(provider, bareId);
    if (model) return model;
  }

  return undefined;
}
