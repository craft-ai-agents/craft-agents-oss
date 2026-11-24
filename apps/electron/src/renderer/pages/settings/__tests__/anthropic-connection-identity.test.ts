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

  it('warns only on connections that share both IDs', () => {
    expect(getDuplicateAnthropicConnectionSlugs([
      connection('personal', 'account', 'personal-org'),
      connection('work', 'account', 'work-org'),
      connection('other-user', 'other-account', 'work-org'),
      connection('work-copy', 'account', 'work-org'),
      connection('work-copy-2', 'account', 'work-org'),
    ])).toEqual(new Set(['work', 'work-copy', 'work-copy-2']))
  })

  it('does not assert duplication when either ID is unavailable', () => {
    expect(getDuplicateAnthropicConnectionSlugs([
      connection('work', 'account', 'work-org'),
      connection('legacy', 'account'),
      connection('legacy-copy', 'account'),
      connection('no-account', undefined, 'work-org'),
    ])).toEqual(new Set())
  })
})
