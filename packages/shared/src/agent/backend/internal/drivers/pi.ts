import { existsSync } from 'node:fs';
import type { ProviderDriver, DriverTestConnectionArgs } from '../driver-types.ts';
import type { ModelDefinition } from '../../../../config/models.ts';
import { getAllPiModels, getPiModelsForAuthProvider } from '../../../../config/models-pi.ts';
import { getPiProviderBaseUrl } from '../../../../config/models-pi.ts';

/**
 * Fetch models dynamically from the GitHub Copilot API using @github/copilot-sdk.
 * Requires a valid OAuth access token from the Copilot device flow.
 */
async function fetchCopilotModels(
  accessToken: string,
  copilotCliPath: string | undefined,
  timeoutMs: number,
): Promise<ModelDefinition[]> {
  const { CopilotClient } = await import('@github/copilot-sdk');

  const prevToken = process.env.COPILOT_GITHUB_TOKEN;
  process.env.COPILOT_GITHUB_TOKEN = accessToken;

  const client = new CopilotClient({
    useStdio: true,
    autoStart: true,
    logLevel: 'debug',
    ...(copilotCliPath && existsSync(copilotCliPath) ? { cliPath: copilotCliPath } : {}),
  });

  const restoreEnv = () => {
    if (prevToken !== undefined) {
      process.env.COPILOT_GITHUB_TOKEN = prevToken;
    } else {
      delete process.env.COPILOT_GITHUB_TOKEN;
    }
  };

  let models: Array<{ id: string; name: string; supportedReasoningEfforts?: string[]; policy?: { state: string } }>;
  try {
    await Promise.race([
      client.start(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(
        'Copilot client failed to start within timeout. Check your network connection and GitHub Copilot subscription.',
      )), timeoutMs)),
    ]);

    models = await Promise.race([
      client.listModels(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(
        'Copilot model listing timed out. Your GitHub token may be invalid or expired.',
      )), timeoutMs)),
    ]);
  } catch (error) {
    restoreEnv();
    try { await client.stop(); } catch { /* ignore cleanup errors */ }
    throw error;
  }

  try { await client.stop(); } catch { /* ignore cleanup errors */ }
  restoreEnv();

  if (!models || models.length === 0) {
    throw new Error('No models returned from Copilot API.');
  }

  // Only include models the user has enabled in their Copilot settings.
  // Models without policy info are kept (API may not always report policy).
  const enabledModels = models.filter(m => !m.policy || m.policy.state === 'enabled');

  if (enabledModels.length === 0) {
    throw new Error('No enabled models found. Enable models in your GitHub Copilot settings.');
  }

  return enabledModels.map(m => ({
    id: m.id,
    name: m.name,
    shortName: m.name,
    description: '',
    provider: 'pi' as const,
    contextWindow: 200_000,
    supportsThinking: !!(m.supportedReasoningEfforts && m.supportedReasoningEfforts.length > 0),
  }));
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
