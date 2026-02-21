import { homedir } from 'node:os';
import type { ModelDefinition } from '../../../../config/models.ts';
import type { ProviderDriver } from '../driver-types.ts';
import { applyOpenAiRuntimeBootstrap } from '../runtime-resolver.ts';

export const openaiDriver: ProviderDriver = {
  provider: 'openai',
  initializeHostRuntime: ({ hostRuntime }) => {
    applyOpenAiRuntimeBootstrap(hostRuntime);
  },
  prepareRuntime: ({ hostRuntime }) => {
    applyOpenAiRuntimeBootstrap(hostRuntime);
  },
  buildRuntime: ({ resolvedPaths }) => ({
    paths: {
      sessionServer: resolvedPaths.sessionServerPath,
      bridgeServer: resolvedPaths.bridgeServerPath,
      node: resolvedPaths.nodeRuntimePath,
    },
  }),
  fetchModels: async ({ connection, credentials, timeoutMs }) => {
    const { AppServerClient, getCodexPath } = await import('../../../../codex/index.ts');
    const codexPath = await getCodexPath();
    const client = new AppServerClient({
      codexPath,
      workDir: homedir(),
    });

    try {
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(
          'Codex app-server failed to start within 15 seconds.',
        )), timeoutMs)),
      ]);

      if (connection.authType === 'oauth') {
        if (!credentials.oauthIdToken || !credentials.oauthAccessToken) {
          throw new Error('OAuth id/access tokens missing for Codex connection');
        }
        await client.accountLoginWithChatGptTokens({
          idToken: credentials.oauthIdToken,
          accessToken: credentials.oauthAccessToken,
        });
      } else if (
        connection.authType === 'api_key' ||
        connection.authType === 'api_key_with_endpoint' ||
        connection.authType === 'bearer_token'
      ) {
        if (!credentials.apiKey) {
          throw new Error('API key missing for Codex connection');
        }
        await client.accountLoginWithApiKey(credentials.apiKey);
      }

      const models = await Promise.race([
        client.modelList(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(
          'Codex model listing timed out after 15 seconds.',
        )), timeoutMs)),
      ]);

      if (!models || models.length === 0) {
        throw new Error('No models returned from Codex model/list');
      }

      const modelDefs: ModelDefinition[] = models.map(m => ({
        id: m.model,
        name: m.displayName,
        shortName: m.displayName.replace(/^GPT-[\d.]+ /, ''),
        description: m.description,
        provider: 'openai' as const,
        contextWindow: 128_000,
        supportsThinking: m.supportedReasoningEfforts.length > 0,
      }));

      const serverDefault = models.find(m => m.isDefault);
      return { models: modelDefs, serverDefault: serverDefault?.model };
    } finally {
      try { await client.disconnect(); } catch { /* ignore cleanup errors */ }
    }
  },
  validateStoredConnection: async ({ slug, connection, credentialManager }) => {
    if (connection.providerType === 'openai_compat' && !connection.defaultModel) {
      return { success: false, error: 'Default model is required for OpenAI-compatible providers.' };
    }

    if (connection.authType === 'oauth') {
      const oauth = await credentialManager.getLlmOAuth(slug);
      if (!oauth?.refreshToken) {
        return { success: false, error: 'No refresh token available. Please re-authenticate.' };
      }

      try {
        const { refreshChatGptTokens } = await import('../../../../auth/chatgpt-oauth.ts');
        const refreshed = await refreshChatGptTokens(oauth.refreshToken);
        await credentialManager.setLlmOAuth(slug, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
          idToken: refreshed.idToken,
        });
        return { success: true, shouldRefreshModels: true };
      } catch {
        return { success: false, error: 'ChatGPT authentication expired. Please re-authenticate.' };
      }
    }

    const apiKey = (
      connection.authType === 'api_key' ||
      connection.authType === 'api_key_with_endpoint' ||
      connection.authType === 'bearer_token'
    )
      ? await credentialManager.getLlmApiKey(slug)
      : null;

    if (!apiKey && connection.authType !== 'none') {
      return { success: false, error: 'Could not retrieve credentials' };
    }

    const modelList = (connection.models ?? []).map(m => (typeof m === 'string' ? m : m.id)).filter(Boolean);
    if (modelList.length > 0 && connection.defaultModel && !modelList.includes(connection.defaultModel)) {
      return { success: false, error: `Default model "${connection.defaultModel}" is not in the configured model list.` };
    }

    const effectiveBaseUrl = (connection.baseUrl || 'https://api.openai.com').replace(/\/$/, '');
    const modelsUrl = `${effectiveBaseUrl}/v1/models`;
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      if (modelList.length > 0) {
        try {
          const payload = await response.json() as { data?: Array<{ id?: string }> };
          const available = new Set((payload?.data ?? []).map((item: { id?: string }) => item.id).filter(Boolean));
          const missing = modelList.filter(model => !available.has(model));
          if (missing.length > 0) {
            return { success: false, error: `Model "${missing[0]}" not found. Check the model name and try again.` };
          }
        } catch (parseError) {
          const msg = parseError instanceof Error ? parseError.message : String(parseError);
          return { success: false, error: `Failed to parse model list: ${msg.slice(0, 200)}` };
        }
      }
      return { success: true, shouldRefreshModels: true };
    }

    if (response.status === 401) {
      return { success: false, error: 'Invalid API key' };
    }
    if (response.status === 403) {
      return { success: false, error: 'API key does not have permission to access this resource' };
    }
    if (response.status === 404) {
      return { success: false, error: 'API endpoint not found. Check the base URL.' };
    }
    if (response.status === 429) {
      return { success: false, error: 'Rate limit exceeded. Please try again.' };
    }

    try {
      const errorData = await response.json() as { error?: { message?: string } };
      const errorMessage = errorData?.error?.message || `API error: ${response.status}`;
      return { success: false, error: errorMessage };
    } catch {
      return { success: false, error: `API error: ${response.status} ${response.statusText}` };
    }
  },
};
