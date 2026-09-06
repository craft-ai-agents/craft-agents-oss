/**
 * Shared usability gate for page action executors (mcp + api).
 *
 * Pages need a STABLE, machine-matchable error when a granted source has
 * lost authentication, so page JS can disable its buttons and point the
 * user at the host's reconnect banner instead of showing an opaque failure.
 * The prefix below is a documented part of the page authoring contract
 * (resources/docs/pages.md) — change it only with a migration note.
 */

import { isSourceUsable, type LoadedSource } from '@craft-agent/shared/sources'

export const PAGE_SOURCE_AUTH_REQUIRED_PREFIX = 'source-auth-required'

/**
 * Throws when the source cannot serve page actions right now. Auth problems
 * get the stable `source-auth-required` prefix; a deliberately disabled
 * source stays a plain (non-retryable) error.
 */
export function assertPageSourceUsable(source: LoadedSource): void {
  if (isSourceUsable(source)) return
  if (source.config.enabled === false) {
    throw new Error(`Source "${source.config.slug}" is disabled`)
  }
  throw new Error(
    `${PAGE_SOURCE_AUTH_REQUIRED_PREFIX}: reconnect "${source.config.slug}" in the app`,
  )
}
