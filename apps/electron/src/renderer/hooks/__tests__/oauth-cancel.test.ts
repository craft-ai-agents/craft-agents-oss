import { describe, expect, it, mock } from 'bun:test'
import { cancelOnboardingOAuth, isProviderManagedOAuthMethod } from '../oauth-cancel'

function createApi() {
  return {
    clearClaudeOAuthState: mock(async () => ({ success: true })),
    cancelChatGptOAuth: mock(async () => ({ success: true })),
    cancelCopilotOAuth: mock(async () => ({ success: true })),
  }
}

describe('cancelOnboardingOAuth', () => {
  it('cancels Claude OAuth through the Claude state cleanup path', async () => {
    const api = createApi()
    await cancelOnboardingOAuth('claude_oauth', api)

    expect(api.clearClaudeOAuthState).toHaveBeenCalledTimes(1)
    expect(api.cancelChatGptOAuth).not.toHaveBeenCalled()
    expect(api.cancelCopilotOAuth).not.toHaveBeenCalled()
  })

  it('cancels ChatGPT OAuth through the ChatGPT cancel API', async () => {
    const api = createApi()
    await cancelOnboardingOAuth('pi_chatgpt_oauth', api)

    expect(api.cancelChatGptOAuth).toHaveBeenCalledTimes(1)
    expect(api.clearClaudeOAuthState).not.toHaveBeenCalled()
    expect(api.cancelCopilotOAuth).not.toHaveBeenCalled()
  })

  it('cancels Copilot OAuth through the Copilot cancel API', async () => {
    const api = createApi()
    await cancelOnboardingOAuth('pi_copilot_oauth', api)

    expect(api.cancelCopilotOAuth).toHaveBeenCalledTimes(1)
    expect(api.clearClaudeOAuthState).not.toHaveBeenCalled()
    expect(api.cancelChatGptOAuth).not.toHaveBeenCalled()
  })
})

describe('isProviderManagedOAuthMethod', () => {
  it('identifies external provider OAuth methods', () => {
    expect(isProviderManagedOAuthMethod('pi_chatgpt_oauth')).toBe(true)
    expect(isProviderManagedOAuthMethod('pi_copilot_oauth')).toBe(true)
    expect(isProviderManagedOAuthMethod('claude_oauth')).toBe(false)
    expect(isProviderManagedOAuthMethod('anthropic_api_key')).toBe(false)
  })
})
