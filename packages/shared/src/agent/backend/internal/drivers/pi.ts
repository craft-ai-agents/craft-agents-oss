import { existsSync } from 'node:fs';
import type { ProviderDriver } from '../driver-types.ts';
import type { ModelDefinition } from '../../../../config/models.ts';
import { getAllPiModels, getPiModelsForAuthProvider } from '../../../../config/models-pi.ts';

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
  validateStoredConnection: async () => ({ success: true }),
};
