import type { ProviderDriver } from '../driver-types.ts';
import { buildOpenLlmBaseUrl, buildRuntimeCustomModels, OPENLLM_CUSTOM_ENDPOINT, OPENLLM_PI_AUTH_PROVIDER } from '../../../../config/llm-connections.ts';

export const openllmDriver: ProviderDriver = {
  provider: 'openllm',
  buildRuntime: args => ({
    paths: {
      piServer: args.resolvedPaths.piServerPath,
      interceptor: args.resolvedPaths.interceptorBundlePath,
      node: args.resolvedPaths.nodeRuntimePath,
    },
    piAuthProvider: OPENLLM_PI_AUTH_PROVIDER,
    baseUrl: buildOpenLlmBaseUrl(process.env, args.context.connection?.isEnvironmentConnection === true),
    customEndpoint: OPENLLM_CUSTOM_ENDPOINT,
    customModels: buildRuntimeCustomModels(args.context.connection?.models),
  }),
  validateStoredConnection: async () => ({ success: true }),
};
