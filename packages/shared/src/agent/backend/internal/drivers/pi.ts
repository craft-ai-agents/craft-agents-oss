import { existsSync } from 'node:fs';
import type { ProviderDriver, DriverTestConnectionArgs } from '../driver-types.ts';
import type { ModelDefinition } from '../../../../config/models.ts';
import { getAllPiModels, getPiModelsForAuthProvider } from '../../../../config/models-pi.ts';
import { getPiProviderBaseUrl } from '../../../../config/models-pi.ts';

// ── Copilot model types ────────────────────────────────────────────────
type RawCopilotModel = {
  id: string;
  name: string;
  supportedReasoningEfforts?: string[];
  policy?: { state: string };
};

/**
 * Spin up a CopilotClient CLI, list models, and shut it down.
 * Returns the raw model array or throws on failure/timeout.
 */
async function listModelsViaCli(
  copilotCliPath: string | undefined,
  timeoutMs: number,
  githubToken?: string,
): Promise<RawCopilotModel[]> {
  const { CopilotClient } = await import('@github/copilot-sdk');

  // When a token is supplied, inject it via env so the CLI uses it
  // instead of its own auth. Restore the env afterwards.
  const prevToken = process.env.COPILOT_GITHUB_TOKEN;
  if (githubToken) {
    process.env.COPILOT_GITHUB_TOKEN = githubToken;
  }

  const restoreEnv = () => {
    if (githubToken) {
      if (prevToken !== undefined) {
        process.env.COPILOT_GITHUB_TOKEN = prevToken;
      } else {
        delete process.env.COPILOT_GITHUB_TOKEN;
      }
    }
  };

  const client = new CopilotClient({
    useStdio: true,
    autoStart: true,
    logLevel: 'debug',
    // Let the CLI use its own auth (gh CLI, stored creds) when no token
    // is injected — this typically returns the best results.
    ...(!githubToken ? { useLoggedInUser: true } : {}),
    ...(copilotCliPath && existsSync(copilotCliPath) ? { cliPath: copilotCliPath } : {}),
  });

  try {
    await Promise.race([
      client.start(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(
        'Copilot client failed to start within timeout.',
      )), timeoutMs)),
    ]);

    const models: RawCopilotModel[] = await Promise.race([
      client.listModels(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(
        'Copilot model listing timed out.',
      )), timeoutMs)),
    ]);

    try { await client.stop(); } catch { /* ignore cleanup errors */ }
    restoreEnv();
    return models;
  } catch (error) {
    try { await client.stop(); } catch { /* ignore cleanup errors */ }
    restoreEnv();
    throw error;
  }
}

/** Filter raw models to only those enabled by policy. */
function filterEnabledModels(models: RawCopilotModel[]): RawCopilotModel[] {
  return models.filter(m => !m.policy || m.policy.state === 'enabled');
}

/** Convert raw Copilot models to our ModelDefinition format. */
function toModelDefinitions(models: RawCopilotModel[]): ModelDefinition[] {
  return models.map(m => ({
    id: m.id,
    name: m.name,
    shortName: m.name,
    description: '',
    provider: 'pi' as const,
    contextWindow: 200_000,
    supportsThinking: !!(m.supportedReasoningEfforts && m.supportedReasoningEfforts.length > 0),
  }));
}

/** Log a breakdown of models by policy state. */
function logModelBreakdown(tag: string, models: RawCopilotModel[]): void {
  const byState = new Map<string, string[]>();
  for (const m of models) {
    const state = m.policy?.state ?? 'no-policy';
    const list = byState.get(state) ?? [];
    list.push(m.id);
    byState.set(state, list);
  }
  const breakdown = [...byState.entries()].map(([s, ids]) => `${s}=${ids.length}(${ids.join(',')})`).join('; ');
  console.warn(`[fetchCopilotModels] ${tag}: total=${models.length} enabled=${filterEnabledModels(models).length} | ${breakdown}`);
}

/**
 * Fetch Copilot models with a 3-tier fallback chain:
 *
 * 1. **useLoggedInUser** – let the CLI use the best available auth on the
 *    machine (gh CLI, VS Code, etc.). This typically returns the most
 *    complete and up-to-date model list.
 * 2. **Pi SDK token** – use the GitHub token from our OAuth device flow.
 *    The Pi SDK's OAuth app has minimal scopes (`read:user`), so the
 *    Copilot API may return a stale/partial model list.
 * 3. **Pi SDK static catalog** – hardcoded model registry shipped with
 *    the Pi SDK. Not filtered by the user's policy but always available.
 */
async function fetchCopilotModels(
  piSdkGitHubToken: string,
  copilotCliPath: string | undefined,
  timeoutMs: number,
): Promise<ModelDefinition[]> {

  // ── Tier 1: CopilotClient with useLoggedInUser ───────────────────
  try {
    const raw = await listModelsViaCli(copilotCliPath, timeoutMs);
    if (raw && raw.length > 0) {
      logModelBreakdown('tier1-loggedInUser', raw);
      const enabled = filterEnabledModels(raw);
      if (enabled.length > 0) {
        return toModelDefinitions(enabled);
      }
    }
  } catch (err) {
    console.warn(`[fetchCopilotModels] tier1-loggedInUser failed: ${(err as Error).message}`);
  }

  // ── Tier 2: CopilotClient with Pi SDK's GitHub token ─────────────
  try {
    const raw = await listModelsViaCli(copilotCliPath, timeoutMs, piSdkGitHubToken);
    if (raw && raw.length > 0) {
      logModelBreakdown('tier2-piToken', raw);
      const enabled = filterEnabledModels(raw);
      if (enabled.length > 0) {
        return toModelDefinitions(enabled);
      }
    }
  } catch (err) {
    console.warn(`[fetchCopilotModels] tier2-piToken failed: ${(err as Error).message}`);
  }

  // ── Tier 3: Pi SDK static catalog ────────────────────────────────
  console.warn('[fetchCopilotModels] tier3-staticCatalog: falling back to Pi SDK model registry');
  const staticModels = getPiModelsForAuthProvider('github-copilot');
  if (staticModels.length > 0) {
    return staticModels;
  }

  throw new Error('No Copilot models available from any source.');
}

/**
 * Lightweight direct HTTP test for Pi providers that expose an Anthropic-compatible
 * messages endpoint. Avoids spawning a full Pi subprocess (which can exceed the
 * 20s test timeout due to SDK initialization overhead).
 */
async function testAnthropicCompatible(
  apiKey: string,
  baseUrl: string,
  model: string,
  timeoutMs: number,
): Promise<{ success: boolean; error?: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Say ok' }],
      }),
    });

    if (res.ok) return { success: true };

    const text = await res.text().catch(() => '');
    return { success: false, error: `${res.status} ${text}`.slice(0, 500) };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { success: false, error: 'Connection test timed out' };
    }
    return { success: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export const piDriver: ProviderDriver = {
  provider: 'pi',
  buildRuntime: ({ context, providerOptions, resolvedPaths }) => ({
    paths: {
      piServer: resolvedPaths.piServerPath,
      interceptor: resolvedPaths.interceptorBundlePath,
      node: resolvedPaths.nodeRuntimePath,
    },
    piAuthProvider: providerOptions?.piAuthProvider || context.connection?.piAuthProvider,
    baseUrl: context.connection?.baseUrl,
    customEndpoint: context.connection?.customEndpoint,
    customModels: context.connection?.models?.map(m => typeof m === 'string' ? m : m.id),
  }),
  fetchModels: async ({ connection, credentials, resolvedPaths, timeoutMs }) => {
    // Copilot OAuth: fetch models dynamically from the Copilot API
    // The CopilotClient CLI binary expects the GitHub OAuth token (our refreshToken),
    // NOT the Copilot API token (our accessToken). The CLI does its own token exchange.
    const copilotGitHubToken = credentials.oauthRefreshToken || credentials.oauthAccessToken;
    if (connection.piAuthProvider === 'github-copilot' && copilotGitHubToken) {
      const models = await fetchCopilotModels(
        copilotGitHubToken,
        resolvedPaths.copilotCliPath,
        timeoutMs,
      );
      return { models };
    }

    // All other Pi providers: use static Pi SDK model registry
    const models = connection.piAuthProvider
      ? getPiModelsForAuthProvider(connection.piAuthProvider)
      : getAllPiModels();

    if (models.length === 0) {
      throw new Error(
        `No Pi models found for provider: ${connection.piAuthProvider ?? 'all'}`,
      );
    }

    return { models };
  },
  testConnection: async (args: DriverTestConnectionArgs): Promise<{ success: boolean; error?: string } | null> => {
    const piAuthProvider = args.connection?.piAuthProvider;
    if (!piAuthProvider) {
      // No provider hint — fall back to generic subprocess path
      return null;
    }

    // Resolve the model's API type from the Pi SDK registry.
    // For anthropic-messages providers, do a lightweight direct HTTP test
    // instead of spawning a full Pi subprocess (which can exceed the timeout).
    let modelApi: string | undefined;
    let modelBaseUrl: string | undefined;
    try {
      const { getModels } = await import('@mariozechner/pi-ai');
      const models = getModels(piAuthProvider as Parameters<typeof getModels>[0]);
      const requestedId = args.model.startsWith('pi/') ? args.model.slice(3) : args.model;
      const match = models.find(m => m.id === requestedId) || models[0];
      if (match) {
        modelApi = (match as { api?: string }).api;
        modelBaseUrl = (match as { baseUrl?: string }).baseUrl;
      }
    } catch { /* ignore — fall through to subprocess */ }

    if (modelApi !== 'anthropic-messages') {
      // Non-Anthropic API types need the full Pi SDK — let factory.ts handle it
      return null;
    }

    const baseUrl = args.baseUrl?.trim() || modelBaseUrl || getPiProviderBaseUrl(piAuthProvider);
    if (!baseUrl) {
      return { success: false, error: 'Could not determine API endpoint for provider' };
    }

    // Strip Pi SDK's 'pi/' prefix — Anthropic-compatible endpoints only accept bare model IDs
    let bareModel = args.model.startsWith('pi/') ? args.model.slice(3) : args.model;
    // MiniMax CN API doesn't accept the 'MiniMax-' prefix on model names
    if (piAuthProvider === 'minimax-cn' && bareModel.startsWith('MiniMax-')) {
      bareModel = bareModel.slice('MiniMax-'.length);
    }
    return testAnthropicCompatible(args.apiKey, baseUrl, bareModel, args.timeoutMs);
  },
  validateStoredConnection: async () => ({ success: true }),
};
