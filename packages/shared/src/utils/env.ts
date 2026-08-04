/**
 * Child-process environment helpers.
 */

/**
 * Copy an environment map while dropping missing values and the literal
 * "undefined" sentinel that can leak into Windows environments.
 */
export function sanitizeChildProcessEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== 'undefined',
    ),
  )
}
