import type { ModelRegistry as PiModelRegistry } from '@earendil-works/pi-coding-agent';

// Re-export from shared so the auth-aware mini-model denylist has a single
// source of truth (also used by `getMiniModel()` at selection time).
export { isDeniedMiniModelId } from '../../shared/src/config/llm-connections.ts';

// Re-export the PiModel type used by callers
type PiModel<T = any> = ReturnType<PiModelRegistry['find']>;

/**
 * Resolve a Pi SDK model from the registry.
 *
 * With `customEndpointOnly` (a custom endpoint is configured), only the endpoint's own
 * models resolve: its credential is labelled with a vendor's provider id ('openai',
 * 'anthropic'), so falling through to that vendor's built-in models would send the
 * endpoint's key, and the conversation, to the vendor's API. Otherwise:
 * 1. Exact provider+model lookup via `piAuthProvider`
 * 2. Full `getAll()` scan by id/name
 * 3. Common provider fallback list (includes 'custom-endpoint')
 */
export function resolvePiModel(
  modelRegistry: PiModelRegistry,
  modelId: string,
  piAuthProvider?: string,
  customEndpointOnly?: boolean,
): PiModel | undefined {
  // Strip Craft's pi/ prefix — Pi SDK uses bare model IDs (e.g. "claude-sonnet-4-6")
  const bareId = modelId.startsWith('pi/') ? modelId.slice(3) : modelId;

  if (customEndpointOnly) {
    return modelRegistry.find('custom-endpoint', bareId) ?? undefined;
  }

  // If we know the auth provider, do an exact provider+model lookup first.
  // This avoids the getAll() ambiguity where the same model ID exists under
  // multiple providers (e.g., "gpt-5.2" under both "openai" and
  // "azure") and the wrong one matches first.
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
  }

  // Fallback: search all available models.
  // When piAuthProvider is set, only return models from the same provider
  // (or 'custom-endpoint'). Without this guard, a model that exists under
  // a different provider (e.g. "gpt-5.4" under "azure"
  // when authed as "github-copilot") would be returned, and the Pi SDK
  // would fail with "No API key found for <wrong-provider>".
  const allModels = modelRegistry.getAll();
  const match = allModels.find(m =>
    (m.id === bareId || m.name === bareId) &&
    (!piAuthProvider || (m as any).provider === piAuthProvider || (m as any).provider === 'custom-endpoint'),
  );
  if (match) return match;

  // Try common providers with the model ID
  const providers = ['custom-endpoint', 'anthropic', 'openai', 'google'];
  for (const provider of providers) {
    // Skip providers incompatible with the authenticated provider
    if (piAuthProvider && provider !== piAuthProvider && provider !== 'custom-endpoint') continue;
    const model = modelRegistry.find(provider, bareId);
    if (model) return model;
  }

  return undefined;
}

/**
 * Whether a resolved model may run under the connection's credential: with a custom
 * endpoint only the endpoint's models; otherwise models of the authenticated provider
 * (any provider without piAuth) and custom-endpoint models.
 */
export function isModelUsableWithAuth(
  resolvedProvider: string | undefined,
  authProvider: string | undefined,
  customEndpointOnly: boolean,
): boolean {
  if (!resolvedProvider) return false;
  if (customEndpointOnly) return resolvedProvider === 'custom-endpoint';
  return !authProvider || resolvedProvider === authProvider || resolvedProvider === 'custom-endpoint';
}

/**
 * Returns true when an error message indicates the requested model is unavailable and a
 * different model should be tried. Matches both the standard OpenAI "model not found"
 * shapes and the ChatGPT-account Codex "… is not supported" refusal.
 */
export function isModelNotFoundError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('model_not_found') ||
    normalized.includes('does not exist') ||
    normalized.includes('no such model') ||
    normalized.includes('is not supported') ||
    (normalized.includes('requested model') && normalized.includes('not') && normalized.includes('exist'))
  );
}

/**
 * Stricter variant of `isModelNotFoundError` for contexts where a 400 can also mean a
 * rejected *tool* or parameter — e.g. the ChatGPT Codex search path, where a hosted-tool
 * refusal ("Hosted tool 'web_search' is not supported") must not be mistaken for a model
 * rejection (that would skip the tool-type retry and burn every candidate model instead).
 * The ambiguous phrasings ("is not supported", "does not exist") only count when the
 * message names the requested model — the known Codex refusal quotes it verbatim
 * ("The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.").
 */
export function isModelRejectionError(message: string, modelId: string): boolean {
  if (!isModelNotFoundError(message)) return false;
  const normalized = message.toLowerCase();
  if (
    normalized.includes('model_not_found') ||
    normalized.includes('no such model') ||
    normalized.includes('requested model')
  ) {
    return true;
  }
  return modelId.length > 0 && normalized.includes(modelId.toLowerCase());
}
