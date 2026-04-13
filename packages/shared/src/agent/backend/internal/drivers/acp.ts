/**
 * ACP Provider Driver
 *
 * Minimal ProviderDriver implementation for the ACP (Agent Client Protocol) backend.
 *
 * ACP agents:
 * - Do not have a fixed runtime payload (transport is injected at construction time)
 * - Do not support model fetching (external agents manage their own LLM)
 * - Do not require host runtime initialization
 *
 * The actual AcpAgent is instantiated via createBackendWithTransport() in factory.ts,
 * not through the generic createBackend() path (which requires a transport parameter
 * that isn't available in the generic BackendConfig).
 */

import type { ProviderDriver } from '../driver-types.ts';

export const acpDriver: ProviderDriver = {
  provider: 'acp',

  buildRuntime(_args) {
    // ACP has no runtime payload — transport is provided via constructor injection
    return {};
  },

  // No initializeHostRuntime — ACP doesn't use host-side subprocess infrastructure
  // No fetchModels — ACP agents expose no model list (excluded from FetchableProvider)
  // No testConnection — ACP connections are validated by attempting an initialize handshake
};
