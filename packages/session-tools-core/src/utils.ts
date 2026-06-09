/**
 * Session Tools Core - Utility Functions
 *
 * Shared helpers for session-scoped tools.
 */

/**
 * Extract a bare session ID from a raw value.
 *
 * Handles both bare IDs ("260418-new-marble") and filesystem paths
 * ("C:\...sessions\260418-new-marble" or "/home/.craft-agent/.../sessions/260418-new-marble").
 *
 * Returns the input unchanged when it does not contain path separators.
 */
export function resolveSessionId(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  // Normalize backslashes to forward slashes for cross-platform matching
  const normalized = raw.replace(/\\/g, '/')
  // If it contains any path separator, take the last component
  if (normalized.includes('/')) {
    const lastComponent = normalized.split('/').pop()
    return lastComponent || raw
  }
  return raw
}
