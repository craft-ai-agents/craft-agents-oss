import { describe, expect, it } from 'bun:test'
import { getDuplicateAnthropicConnectionSlugs } from '../anthropic-connection-identity'

const connection = (slug: string, oauthAccountUuid?: string, oauthOrganizationUuid?: string) =>
  ({ slug, oauthAccountUuid, oauthOrganizationUuid })

describe('Anthropic duplicate connection warning', () => {
  it('does not warn on separate organizations under one account', () => {
    expect(getDuplicateAnthropicConnectionSlugs([
      connection('personal', 'account', 'personal-org'),
      connection('work', 'account', 'work-org'),
    ])).toEqual(new Set())
  })

  it('warns on connections that share the account and the organization', () => {
    expect(getDuplicateAnthropicConnectionSlugs([
      connection('personal', 'account', 'personal-org'),
      connection('work', 'account', 'work-org'),
      connection('other-user', 'other-account', 'work-org'),
      connection('work-copy', 'account', 'work-org'),
      connection('work-copy-2', 'account', 'work-org'),
    ])).toEqual(new Set(['work', 'work-copy', 'work-copy-2']))
  })

  it('keeps warning when an organization is unknown, since it may be the same one', () => {
    expect(getDuplicateAnthropicConnectionSlugs([
      connection('work', 'account', 'work-org'),
      connection('no-org', 'account'),
    ])).toEqual(new Set(['work', 'no-org']))
    expect(getDuplicateAnthropicConnectionSlugs([
      connection('no-org', 'account'),
      connection('no-org-copy', 'account'),
    ])).toEqual(new Set(['no-org', 'no-org-copy']))
  })

  it('ignores connections without an account and different accounts', () => {
    expect(getDuplicateAnthropicConnectionSlugs([
      connection('api-key'),
      connection('api-key-2'),
      connection('no-account', undefined, 'work-org'),
      connection('one', 'account-one', 'work-org'),
      connection('two', 'account-two', 'work-org'),
    ])).toEqual(new Set())
  })
})
