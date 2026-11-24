import type { LlmConnectionWithStatus } from '../../../shared/types'

type OAuthConnectionIdentity = Pick<LlmConnectionWithStatus, 'slug' | 'oauthAccountUuid' | 'oauthOrganizationUuid'>

export function getDuplicateOAuthConnectionSlugs(connections: readonly OAuthConnectionIdentity[]): Set<string> {
  const duplicates = connections.filter(({ slug, oauthAccountUuid, oauthOrganizationUuid }) =>
    oauthAccountUuid && connections.some(other =>
      other.slug !== slug &&
      other.oauthAccountUuid === oauthAccountUuid &&
      // Keep the account-level warning when either organization is unknown.
      (!oauthOrganizationUuid || !other.oauthOrganizationUuid || oauthOrganizationUuid === other.oauthOrganizationUuid),
    ),
  )
  return new Set(duplicates.map(connection => connection.slug))
}
