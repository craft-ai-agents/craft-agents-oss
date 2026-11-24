import { describe, expect, it } from 'bun:test'
import { getDuplicateOAuthConnectionSlugs } from '../duplicate-oauth-connections'

const accountA = '00000000-0000-4000-8000-000000000001'
const accountB = '00000000-0000-4000-8000-000000000002'
const orgA = '00000000-0000-4000-8000-000000000003'
const orgB = '00000000-0000-4000-8000-000000000004'

describe('duplicate OAuth connection badges', () => {
  it('skips badges for the same account in different known organizations', () => {
    expect(getDuplicateOAuthConnectionSlugs([
      { slug: 'first', oauthAccountUuid: accountA, oauthOrganizationUuid: orgA },
      { slug: 'second', oauthAccountUuid: accountA, oauthOrganizationUuid: orgB },
    ])).toEqual(new Set())
  })

  it('only badges the rows that share both the account and organization', () => {
    expect(getDuplicateOAuthConnectionSlugs([
      { slug: 'first', oauthAccountUuid: accountA, oauthOrganizationUuid: orgA },
      { slug: 'same-org', oauthAccountUuid: accountA, oauthOrganizationUuid: orgA },
      { slug: 'other-org', oauthAccountUuid: accountA, oauthOrganizationUuid: orgB },
      { slug: 'other-account', oauthAccountUuid: accountB, oauthOrganizationUuid: orgA },
      { slug: 'unknown-account', oauthOrganizationUuid: orgA },
      { slug: 'another-unknown-account', oauthOrganizationUuid: orgA },
    ])).toEqual(new Set(['first', 'same-org']))
  })

  it.each([
    ['one organization is unknown', orgA],
    ['both organizations are unknown', undefined],
  ] as const)('keeps the account-level warning when %s', (_label, organizationUuid) => {
    expect(getDuplicateOAuthConnectionSlugs([
      { slug: 'first', oauthAccountUuid: accountA, oauthOrganizationUuid: organizationUuid },
      { slug: 'second', oauthAccountUuid: accountA },
    ])).toEqual(new Set(['first', 'second']))
  })
})
