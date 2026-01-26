/**
 * Access Control for Telegram Integration
 *
 * Layered access control with DM policies, group policies, and allowlists.
 * Supports pairing mode for unknown users and fine-grained permission control.
 */

export type DMPolicy = 'disabled' | 'pairing' | 'allowlist' | 'open'
export type GroupPolicy = 'disabled' | 'allowlist' | 'open'

export interface AccessCheckResult {
  allowed: boolean
  reason?: string
  pairingCode?: string  // For pairing mode
}

/**
 * Check if a user is allowed to send direct messages to the bot.
 *
 * @param params.userId - Telegram user ID
 * @param params.policy - DM policy: disabled, pairing, allowlist, or open
 * @param params.allowlist - Array of allowed user IDs (as numbers)
 * @returns AccessCheckResult with allowed status and optional reason/pairing code
 */
export function checkDMAccess(params: {
  userId: number
  policy: DMPolicy
  allowlist: number[]
}): AccessCheckResult {
  if (params.policy === 'disabled') {
    return { allowed: false, reason: 'DMs are disabled' }
  }
  if (params.policy === 'open') {
    return { allowed: true }
  }

  const isAllowed = params.allowlist.includes(params.userId)

  if (params.policy === 'allowlist') {
    return isAllowed
      ? { allowed: true }
      : { allowed: false, reason: 'You are not authorized to use this bot' }
  }

  if (params.policy === 'pairing') {
    if (isAllowed) return { allowed: true }
    // Generate pairing code for approval flow
    const code = generatePairingCode(params.userId)
    return {
      allowed: false,
      pairingCode: code,
      reason: 'Pairing required. Share this code with the bot owner.'
    }
  }

  return { allowed: false }
}

/**
 * Check if a user is allowed to send group messages to the bot.
 *
 * @param params.chatId - Telegram chat ID
 * @param params.userId - Telegram user ID
 * @param params.groupPolicy - Group policy: disabled, allowlist, or open
 * @param params.allowedGroups - Array of allowed chat IDs (as numbers)
 * @param params.allowedUsers - Array of allowed user IDs (as numbers)
 * @returns AccessCheckResult with allowed status and optional reason
 */
export function checkGroupAccess(params: {
  chatId: number
  userId: number
  groupPolicy: GroupPolicy
  allowedGroups: number[]
  allowedUsers: number[]
}): AccessCheckResult {
  if (params.groupPolicy === 'disabled') {
    return { allowed: false, reason: 'Group messages are disabled' }
  }
  if (params.groupPolicy === 'open') {
    return { allowed: true }
  }

  // Allowlist: check both group and user
  const groupAllowed = params.allowedGroups.length === 0 ||
                       params.allowedGroups.includes(params.chatId)
  const userAllowed = params.allowedUsers.length === 0 ||
                      params.allowedUsers.includes(params.userId)

  if (!groupAllowed) {
    return { allowed: false, reason: 'This group is not authorized' }
  }
  if (!userAllowed) {
    return { allowed: false, reason: 'You are not authorized in this group' }
  }

  return { allowed: true }
}

/**
 * Generate a pairing code for an unknown user.
 * Format: PAIR-{last4DigitsOfUserId}-{randomAlphanumeric}
 *
 * @param userId - Telegram user ID
 * @returns Pairing code string
 */
function generatePairingCode(userId: number): string {
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `PAIR-${userId.toString().slice(-4)}-${random}`
}
