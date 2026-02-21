import type { ProviderDriver } from '../driver-types.ts';
import { applyAnthropicRuntimeBootstrap } from '../runtime-resolver.ts';
import { validateAnthropicConnection } from '../../../../config/llm-validation.ts';

export const anthropicDriver: ProviderDriver = {
  provider: 'anthropic',
  initializeHostRuntime: ({ hostRuntime, resolvedPaths }) => {
    applyAnthropicRuntimeBootstrap(hostRuntime, resolvedPaths);
  },
  prepareRuntime: ({ hostRuntime, resolvedPaths }) => {
    applyAnthropicRuntimeBootstrap(hostRuntime, resolvedPaths);
  },
  buildRuntime: () => ({}),
  fetchModels: async ({ connection, credentials }) => {
    if (connection.providerType === 'bedrock' || connection.providerType === 'vertex') {
      throw new Error('Dynamic model discovery not available for Bedrock/Vertex connections; using fallback chain.');
    }
    if (connection.authType === 'iam_credentials') {
      throw new Error('Dynamic model discovery does not support iam_credentials auth; using fallback chain.');
    }
    if (connection.authType === 'service_account_file') {
      throw new Error('Dynamic model discovery does not support service_account_file auth; using fallback chain.');
    }

    const apiKey = credentials.apiKey;
    const oauthAccessToken = credentials.oauthAccessToken;

    if (!apiKey && !oauthAccessToken) {
      throw new Error('Anthropic credentials required to fetch models');
    }

    const baseUrl = connection.baseUrl || 'https://api.anthropic.com';
    const headers: Record<string, string> = {
      'anthropic-version': '2023-06-01',
    };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    } else {
      headers.authorization = `Bearer ${oauthAccessToken}`;
    }

    const allRawModels: Array<{
      id: string;
      display_name: string;
      created_at: string;
      type: string;
    }> = [];
    let afterId: string | undefined;

    do {
      const params = new URLSearchParams({ limit: '100' });
      if (afterId) params.set('after_id', afterId);

      const response = await fetch(`${baseUrl}/v1/models?${params}`, { headers });
      if (!response.ok) {
        throw new Error(`Anthropic /v1/models failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        data: Array<{ id: string; display_name: string; created_at: string; type: string }>;
        has_more: boolean;
        first_id: string;
        last_id: string;
      };
      if (data.data) allRawModels.push(...data.data);

      if (data.has_more && data.last_id) {
        afterId = data.last_id;
      } else {
        break;
      }
    } while (true);

    if (allRawModels.length === 0) {
      throw new Error('No models returned from Anthropic API');
    }

    const models = allRawModels
      .filter(m => m.id.startsWith('claude-') && !m.id.startsWith('claude-2') && !m.id.startsWith('claude-instant') && !m.id.startsWith('claude-1'))
      .map(m => ({
        id: m.id,
        name: m.display_name,
        shortName: (() => {
          const stripped = m.id
            .replace('claude-', '')
            .replace(/-\d{8}$/, '')
            .replace(/-latest$/, '');
          const variant = stripped
            .replace(/^[\d.-]+/, '')
            .replace(/-[\d.]+$/, '')
            .replace(/^-/, '');
          return variant ? variant.charAt(0).toUpperCase() + variant.slice(1) : stripped;
        })(),
        description: '',
        provider: 'anthropic' as const,
        contextWindow: 200_000,
      }));

    return { models };
  },
  validateStoredConnection: async ({ slug, connection, credentialManager }) => {
    const isAnthropicProvider =
      connection.providerType === 'anthropic' || connection.providerType === 'anthropic_compat';

    if (isAnthropicProvider && connection.authType === 'oauth') {
      const { getValidClaudeOAuthToken } = await import('../../../../auth/state.ts');
      const tokenResult = await getValidClaudeOAuthToken(slug);
      if (!tokenResult.accessToken) {
        const errorMsg = tokenResult.migrationRequired?.message || 'OAuth token expired. Please re-authenticate.';
        return { success: false, error: errorMsg };
      }
      return { success: true };
    }

    if (connection.providerType === 'anthropic_compat' && !connection.defaultModel) {
      return { success: false, error: 'Default model is required for Anthropic-compatible providers.' };
    }

    if (connection.authType === 'iam_credentials') {
      return { success: true };
    }
    if (connection.authType === 'service_account_file') {
      return { success: true };
    }

    let apiKey: string | null = null;
    let oauthToken: string | null = null;

    if (connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint') {
      apiKey = await credentialManager.getLlmApiKey(slug);
    } else if (connection.authType === 'bearer_token') {
      oauthToken = await credentialManager.getLlmApiKey(slug);
    } else if (connection.authType === 'environment') {
      apiKey = process.env.ANTHROPIC_API_KEY || null;
      if (!apiKey) {
        return { success: false, error: 'ANTHROPIC_API_KEY environment variable not set' };
      }
    } else if (connection.authType === 'none') {
      apiKey = 'ollama';
    }

    if (!apiKey && !oauthToken && connection.authType !== 'none') {
      return { success: false, error: 'Could not retrieve credentials' };
    }

    const modelIds = (connection.models ?? []).map(m => (typeof m === 'string' ? m : m.id)).filter(Boolean);

    if (connection.providerType === 'anthropic_compat' && modelIds.length > 0) {
      if (connection.defaultModel && !modelIds.includes(connection.defaultModel)) {
        return { success: false, error: `Default model "${connection.defaultModel}" is not in the configured model list.` };
      }

      for (const modelId of modelIds) {
        const result = await validateAnthropicConnection({
          model: modelId,
          apiKey: apiKey || undefined,
          oauthToken: oauthToken || undefined,
          baseUrl: connection.baseUrl || undefined,
        });
        if (!result.success) {
          return { success: false, error: `Model "${modelId}" failed validation: ${result.error}` };
        }
      }

      return { success: true };
    }

    const testModel = connection.defaultModel!;
    const validationResult = await validateAnthropicConnection({
      model: testModel,
      apiKey: apiKey || undefined,
      oauthToken: oauthToken || undefined,
      baseUrl: connection.baseUrl || undefined,
    });

    if (!validationResult.success) {
      return { success: false, error: validationResult.error };
    }

    return { success: true };
  },
};
