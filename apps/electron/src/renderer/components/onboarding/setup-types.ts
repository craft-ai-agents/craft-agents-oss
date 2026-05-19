import type { LlmAuthType, LlmProviderType } from "@craft-agent/shared/config/llm-connections"

/**
 * API setup method for the single-step connection form.
 *
 * - 'anthropic_api_key' -> anthropic + api_key
 * - 'pi_api_key' -> pi + api_key
 */
export type ApiSetupMethod =
  | 'anthropic_api_key'
  | 'pi_api_key'

export function apiSetupMethodToConnectionTypes(method: ApiSetupMethod): {
  providerType: LlmProviderType
  authType: LlmAuthType
} {
  switch (method) {
    case 'anthropic_api_key':
      return { providerType: 'anthropic', authType: 'api_key' }
    case 'pi_api_key':
      return { providerType: 'pi', authType: 'api_key' }
  }
}
