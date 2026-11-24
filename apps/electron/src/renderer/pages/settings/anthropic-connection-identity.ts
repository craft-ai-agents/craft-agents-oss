import type { LlmConnectionWithStatus } from '../../../shared/types'

type ConnectionIdentity = Pick<LlmConnectionWithStatus, 'slug' | 'oauthAccountUuid' | 'oauthOrganizationUuid'>

export function getDuplicateAnthropicConnectionSlugs(connections: readonly ConnectionIdentity[]): Set<string> {
  const firstByIdentity = new Map<string, string>()
  const duplicates = new Set<string>()
  for (const { slug, oauthAccountUuid, oauthOrganizationUuid } of connections) {
    // A shared account alone does not establish that the grants resolve to the same organization.
    if (!oauthAccountUuid || !oauthOrganizationUuid) continue
    const identity = JSON.stringify([oauthAccountUuid, oauthOrganizationUuid])
    const first = firstByIdentity.get(identity)
    if (first !== undefined) {
      duplicates.add(first)
      duplicates.add(slug)
    } else {
      firstByIdentity.set(identity, slug)
    }
  }
  return duplicates
}
