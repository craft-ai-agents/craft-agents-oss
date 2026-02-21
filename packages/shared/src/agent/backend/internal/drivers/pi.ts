import type { ProviderDriver } from '../driver-types.ts';
import { getAllPiModels, getPiModelsForAuthProvider } from '../../../../config/models-pi.ts';

export const piDriver: ProviderDriver = {
  provider: 'pi',
  buildRuntime: ({ context, providerOptions, resolvedPaths }) => ({
    paths: {
      piServer: resolvedPaths.piServerPath,
      interceptor: resolvedPaths.interceptorBundlePath,
      node: resolvedPaths.nodeRuntimePath,
    },
    piAuthProvider: providerOptions?.piAuthProvider || context.connection?.piAuthProvider,
  }),
  fetchModels: async ({ connection }) => {
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
