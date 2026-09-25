import type { ApiSetupMethod } from '@/components/onboarding'
import type { ElectronAPI } from '../../shared/types'

type OAuthCancelApi = Pick<ElectronAPI, 'clearClaudeOAuthState' | 'cancelChatGptOAuth' | 'cancelCopilotOAuth'>

export function isProviderManagedOAuthMethod(
  method: ApiSetupMethod | null,
): method is 'pi_chatgpt_oauth' | 'pi_copilot_oauth' {
  return method === 'pi_chatgpt_oauth' || method === 'pi_copilot_oauth'
}

export async function cancelOnboardingOAuth(
  method: ApiSetupMethod | null,
  api: OAuthCancelApi,
): Promise<void> {
  switch (method) {
    case 'claude_oauth':
      await api.clearClaudeOAuthState()
      return
    case 'pi_chatgpt_oauth':
      await api.cancelChatGptOAuth()
      return
    case 'pi_copilot_oauth':
      await api.cancelCopilotOAuth()
      return
    default:
      return
  }
}
