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

export function redactDynamicContextRefForExternal(ref: unknown): StoredMessage['dynamicContextRef'] | undefined {
  if (!isRecord(ref)) return undefined

  const type = copyString(ref.type)
  if (!type) return undefined

  const redacted: NonNullable<StoredMessage['dynamicContextRef']> = { type }
  const status = copyString(ref.status)
  const fetchedAt = copyNumber(ref.fetchedAt)
  if (status) redacted.status = status
  if (fetchedAt !== undefined) redacted.fetchedAt = fetchedAt

  if (type === 'user_profile') {
    redacted.summary = USER_PROFILE_EXPORT_SUMMARY
  } else if (type === 'team_public_knowledge') {
    redacted.summary = TEAM_KNOWLEDGE_EXPORT_SUMMARY
  } else {
    const summary = copyString(ref.summary)
    if (summary) redacted.summary = summary
  }

  return redacted
}

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

export function redactStoredSessionForExternal(session: StoredSession): StoredSession {
  return {
    ...session,
    messages: session.messages.map(redactMessageDynamicContextForExternal),
  }
}
