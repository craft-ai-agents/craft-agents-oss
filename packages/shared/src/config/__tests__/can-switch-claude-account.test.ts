import { describe, expect, it } from 'bun:test'
import { canSwitchClaudeAccount, type LlmConnection } from '../llm-connections'

const model = 'claude-opus-5-5'
const personal: LlmConnection = {
  slug: 'personal', name: 'Personal', providerType: 'anthropic', authType: 'oauth', createdAt: 1,
  oauthAccountUuid: 'login-1', oauthOrganizationUuid: 'org-personal',
}
const work: LlmConnection = { ...personal, slug: 'work', name: 'Work', oauthOrganizationUuid: 'org-work' }

describe('canSwitchClaudeAccount', () => {
  it('allows another Claude sign-in that lists the chat\'s model', () => {
    expect(canSwitchClaudeAccount(personal, work, model)).toBe(true)
    expect(canSwitchClaudeAccount(personal, { ...work, oauthAccountUuid: 'login-2' }, model)).toBe(true)
    // Without identity data the accounts can't be compared, so they may differ.
    expect(canSwitchClaudeAccount(personal, { ...work, oauthAccountUuid: undefined, oauthOrganizationUuid: undefined }, model)).toBe(true)
  })

  it('checks the target\'s model list, falling back to the Claude catalog', () => {
    expect(canSwitchClaudeAccount(personal, { ...work, models: [model] }, model)).toBe(true)
    expect(canSwitchClaudeAccount(personal, { ...work, models: ['claude-haiku-5-5'] }, model)).toBe(false)
    expect(canSwitchClaudeAccount(personal, work, 'not-a-claude-model')).toBe(false)
  })

  it('refuses anything that changes more than the credentials', () => {
    expect(canSwitchClaudeAccount(personal, { ...work, authType: 'api_key' }, model)).toBe(false)
    expect(canSwitchClaudeAccount({ ...personal, authType: 'api_key' }, work, model)).toBe(false)
    expect(canSwitchClaudeAccount(personal, { ...work, providerType: 'pi' }, model)).toBe(false)
    expect(canSwitchClaudeAccount(personal, { ...work, baseUrl: 'https://llm.example.com' }, model)).toBe(false)
    expect(canSwitchClaudeAccount({ ...personal, baseUrl: 'https://llm.example.com' }, work, model)).toBe(false)
  })

  it('refuses the same connection, the same account and organization, and missing input', () => {
    expect(canSwitchClaudeAccount(personal, personal, model)).toBe(false)
    expect(canSwitchClaudeAccount(personal, { ...personal, slug: 'personal-copy' }, model)).toBe(false)
    expect(canSwitchClaudeAccount(null, work, model)).toBe(false)
    expect(canSwitchClaudeAccount(personal, work, '')).toBe(false)
  })
})
