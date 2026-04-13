/**
 * ACP Provider Driver
 *
 * Minimal ProviderDriver implementation for the ACP (Agent Client Protocol) backend.
 *
 * ACP agents:
 * - Do not have a fixed runtime payload (transport is injected at construction time)
 * - Support model fetching via a probe initialize+session/new call
 * - Do not require host runtime initialization
 *
 * The actual AcpAgent is instantiated via createBackendWithTransport() in factory.ts,
 * not through the generic createBackend() path (which requires a transport parameter
 * that isn't available in the generic BackendConfig).
 */

import type { ProviderDriver } from '../driver-types.ts';
import { StdioAcpTransport, _buildSafeEnv } from '../../../acp-transport.ts';
import type { ModelDefinition } from '../../../../config/models.ts';

export const acpDriver: ProviderDriver = {
  provider: 'acp',

  buildRuntime(_args) {
    // ACP has no runtime payload — transport is provided via constructor injection
    return {};
  },

  /**
   * Fetch available models by probing the ACP server with initialize + session/new.
   * Models are returned in the session/new response (models.availableModels or configOptions[category=model]).
   * The probe transport is disposed immediately after.
   */
  async fetchModels({ connection, timeoutMs }) {
    const acpCommand = (connection as any).acpCommand as string[] | undefined;
    const acpEnv = (connection as any).acpEnv as Record<string, string> | undefined;

    if (!acpCommand?.length) {
      return { models: [] };
    }

    const transport = new StdioAcpTransport(acpCommand, acpEnv);

    try {
      const timer = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('ACP fetchModels timeout')), timeoutMs)
      );

      const probe = async () => {
        await transport.sendRequest('initialize', {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
          clientInfo: { name: 'craft-agents', version: '1.0.0' },
        });

        const result = await transport.sendRequest('session/new', {
          cwd: (typeof process !== 'undefined' ? process.cwd() : undefined),
        }) as {
          sessionId: string;
          models?: { currentModelId?: string; availableModels?: Array<{ modelId: string; name: string; description?: string }> };
          configOptions?: Array<{ id: string; category?: string; currentValue?: string; options?: Array<{ value: string; name: string; description?: string }> }>;
        };

        return result;
      };

      const result = await Promise.race([probe(), timer]);
      const models = extractModels(result);
      return { models };
    } catch {
      return { models: [] };
    } finally {
      await transport.dispose().catch(() => {});
    }
  },
};

function extractModels(result: {
  models?: { availableModels?: Array<{ modelId: string; name: string; description?: string }> };
  configOptions?: Array<{ id: string; category?: string; options?: Array<{ value: string; name: string; description?: string }> }>;
}): ModelDefinition[] {
  // New format: configOptions[category=model]
  if (result.configOptions) {
    const modelOpt = result.configOptions.find(o => o.category === 'model' || o.id === 'model');
    if (modelOpt?.options?.length) {
      return modelOpt.options.map(o => ({
        id: o.value,
        name: o.name,
        shortName: o.name,
        description: o.description ?? '',
        provider: 'acp' as never,
        contextWindow: 0,
      }));
    }
  }
  // Legacy format: models.availableModels
  if (result.models?.availableModels?.length) {
    return result.models.availableModels.map(m => ({
      id: m.modelId,
      name: m.name,
      shortName: m.name,
      description: m.description ?? '',
      provider: 'acp' as never,
      contextWindow: 0,
    }));
  }
  return [];
}
