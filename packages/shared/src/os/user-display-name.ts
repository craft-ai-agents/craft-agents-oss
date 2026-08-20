/**
 * Resolve a human-friendly display name for the current OS user.
 * Used as the default first-run workspace name.
 *
 * Priority:
 * 1. macOS directory RealName (dscl)
 * 2. os.userInfo().username
 * 3. hard-coded "User"
 */

import { execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'

/**
 * Parse `dscl . -read /Users/<user> RealName` output.
 * Handles both single-line (`RealName: Jane Doe`) and multi-line forms:
 *
 *   RealName:
 *    Jane Doe
 */
export function parseDsclRealName(output: string): string | null {
  const text = output.replace(/\r\n/g, '\n').trim()
  if (!text) return null

  // Multi-line: "RealName:" on its own line, value on following lines
  const multi = text.match(/^RealName:\s*\n([\s\S]+)$/i)
  if (multi?.[1]) {
    const name = multi[1]
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ')
      .trim()
    return name.length > 0 ? name : null
  }

  // Single-line: "RealName: Jane Doe"
  const single = text.match(/^RealName:\s*(.+)$/im)
  if (single?.[1]) {
    const name = single[1].trim()
    // Reject the bare key echo / empty
    if (!name || /^RealName:?$/i.test(name)) return null
    return name
  }

  return null
}

function resolveDarwinRealName(username: string): string | null {
  try {
    const output = execFileSync(
      'dscl',
      ['.', '-read', `/Users/${username}`, 'RealName'],
      {
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
    return parseDsclRealName(output)
  } catch {
    return null
  }
}

function resolveOsUsername(): string | null {
  try {
    const name = userInfo().username?.trim()
    return name && name.length > 0 ? name : null
  } catch {
    return null
  }
}

/**
 * Resolve the best available display name for the current user.
 * Sync — safe to call during Electron main first-run bootstrap.
 */
export function resolveUserDisplayName(): string {
  const username = resolveOsUsername()

  if (process.platform === 'darwin' && username) {
    const realName = resolveDarwinRealName(username)
    if (realName) return realName
  }

  if (username) return username
  return 'User'
}
