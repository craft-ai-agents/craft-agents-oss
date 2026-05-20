import type { ProviderDriver } from '../driver-types.ts';
import { buildOpenLlmBaseUrl, OPENLLM_CUSTOM_ENDPOINT, OPENLLM_PI_AUTH_PROVIDER } from '../../../../config/llm-connections.ts';

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
    piAuthProvider: OPENLLM_PI_AUTH_PROVIDER,
    baseUrl: buildOpenLlmBaseUrl(args.context.resolvedModel),
    customEndpoint: OPENLLM_CUSTOM_ENDPOINT,
    customModels: buildCustomModels(args),
  }),
  validateStoredConnection: async () => ({ success: true }),
};
