import type { LlmConnectionWithStatus } from '../../../shared/types'

type ConnectionIdentity = Pick<LlmConnectionWithStatus, 'slug' | 'oauthAccountUuid' | 'oauthOrganizationUuid'>

/**
 * Slugs of Claude connections that sign in to the same Anthropic account as another one
 * (issue #838), shown with a duplicate warning in Settings → AI.
 *
 * One login can belong to several organizations, each with its own subscription, so two
 * connections of the same account are duplicates only when they aren't known to use
 * different organizations (OSS #1150). When either organization is unknown the warning
 * stays, as before.
 */
export function getDuplicateAnthropicConnectionSlugs(connections: readonly ConnectionIdentity[]): Set<string> {
  const byAccount = new Map<string, ConnectionIdentity[]>()
  for (const connection of connections) {
    if (!connection.oauthAccountUuid) continue
    const group = byAccount.get(connection.oauthAccountUuid)
    if (group) group.push(connection)
    else byAccount.set(connection.oauthAccountUuid, [connection])
  }

  const duplicates = new Set<string>()
  for (const group of byAccount.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!
        const b = group[j]!
        const differentOrganizations = !!a.oauthOrganizationUuid && !!b.oauthOrganizationUuid
          && a.oauthOrganizationUuid !== b.oauthOrganizationUuid
        if (differentOrganizations) continue
        duplicates.add(a.slug)
        duplicates.add(b.slug)
      }
    }
  }
  return duplicates
}
