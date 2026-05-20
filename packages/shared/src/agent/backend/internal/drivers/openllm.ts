import type { ProviderDriver } from '../driver-types.ts';
import { buildOpenLlmBaseUrl } from '../../../../config/llm-connections.ts';

function buildCustomModels(args: Parameters<ProviderDriver['buildRuntime']>[0]) {
  return args.context.connection?.models?.map(m => {
    if (typeof m === 'string') return m;
    const supportsImages = typeof m.supportsImages === 'boolean'
      ? m.supportsImages
      : undefined;
    if (m.contextWindow || supportsImages !== undefined) {
      return {
        id: m.id,
        ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
        ...(supportsImages !== undefined ? { supportsImages } : {}),
      };
    }
    return m.id;
  });
}

export const openllmDriver: ProviderDriver = {
  provider: 'openllm',
  buildRuntime: args => ({
    paths: {
      piServer: args.resolvedPaths.piServerPath,
      interceptor: args.resolvedPaths.interceptorBundlePath,
      node: args.resolvedPaths.nodeRuntimePath,
    },
    piAuthProvider: 'anthropic',
    baseUrl: buildOpenLlmBaseUrl(args.context.resolvedModel),
    customEndpoint: { api: 'anthropic-messages' },
    customModels: buildCustomModels(args),
  }),
  validateStoredConnection: async () => ({ success: true }),
};
