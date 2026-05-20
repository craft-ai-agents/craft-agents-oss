import type { StoredMessage, StoredSession } from './types.ts'

type DynamicContextRefLike = Record<string, unknown>

const USER_PROFILE_EXPORT_SUMMARY = 'User profile context redacted for export'
const TEAM_KNOWLEDGE_EXPORT_SUMMARY = 'Team public knowledge reference redacted for export'

function isRecord(value: unknown): value is DynamicContextRefLike {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function copyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function copyNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getExportSummary(type: string, ref: DynamicContextRefLike): string | undefined {
  switch (type) {
    case 'user_profile':
      return USER_PROFILE_EXPORT_SUMMARY
    case 'team_public_knowledge':
      return TEAM_KNOWLEDGE_EXPORT_SUMMARY
    default:
      return copyString(ref.summary)
  }
}

/**
 * Redacts a stored dynamic context reference for external exports and shares.
 */
export function redactDynamicContextRefForExternal(ref: unknown): StoredMessage['dynamicContextRef'] | undefined {
  if (!isRecord(ref)) return undefined

  const type = copyString(ref.type)
  if (!type) return undefined

  const redacted: NonNullable<StoredMessage['dynamicContextRef']> = { type }
  const status = copyString(ref.status)
  const fetchedAt = copyNumber(ref.fetchedAt)
  if (status) redacted.status = status
  if (fetchedAt !== undefined) redacted.fetchedAt = fetchedAt

  const summary = getExportSummary(type, ref)
  if (summary) redacted.summary = summary

  return redacted
}

/**
 * Returns a copy of a stored message with dynamic context details removed.
 */
export function redactMessageDynamicContextForExternal(message: StoredMessage): StoredMessage {
  if (!('dynamicContextRef' in message)) return message

  const redactedRef = redactDynamicContextRefForExternal(message.dynamicContextRef)
  const redactedMessage: StoredMessage = { ...message }
  if (redactedRef) {
    redactedMessage.dynamicContextRef = redactedRef
  } else {
    delete redactedMessage.dynamicContextRef
  }
  return redactedMessage
}

/**
 * Returns a copy of a stored session suitable for external viewers or bundles.
 */
export function redactStoredSessionForExternal(session: StoredSession): StoredSession {
  return {
    ...session,
    messages: session.messages.map(redactMessageDynamicContextForExternal),
  }
}
