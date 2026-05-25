import type {
  FeedbackRecord,
  FeedbackTurnMessage,
} from '@craft-agent/shared/feedback'

export type FeedbackRatingFilter = 'like' | 'dislike'

export function formatFeedbackTime(value: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function countFeedbackRatings(records: FeedbackRecord[]): { like: number; dislike: number } {
  const like = records.filter(record => record.is_like).length
  return { like, dislike: records.length - like }
}

export function filterFeedbackRecords(
  records: FeedbackRecord[],
  filter: FeedbackRatingFilter,
): FeedbackRecord[] {
  return records.filter(record => filter === 'like' ? record.is_like : !record.is_like)
}

export function formatMessageValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function messageText(message: FeedbackTurnMessage): string {
  return formatMessageValue(message.content).trim()
}

export function hasToolMetadata(message: FeedbackTurnMessage): boolean {
  return Boolean(
    message.role === 'tool'
    || message.toolName
    || message.toolDisplayName
    || message.toolUseId
    || message.toolInput !== undefined
    || message.toolResult !== undefined
  )
}

export function isDisplayableTurnMessage(message: FeedbackTurnMessage): boolean {
  return messageText(message).length > 0 || hasToolMetadata(message)
}

export function firstMessageByRole(record: FeedbackRecord, role: string): FeedbackTurnMessage | undefined {
  return record.turn_messages.find(message => message.role === role && isDisplayableTurnMessage(message))
}

export function finalAssistantMessage(record: FeedbackRecord): FeedbackTurnMessage | undefined {
  const assistantMessages = [...record.turn_messages]
    .reverse()
    .filter(message => message.role === 'assistant' && isDisplayableTurnMessage(message))

  return assistantMessages.find(message => !message.isIntermediate) ?? assistantMessages[0]
}

export function processCount(record: FeedbackRecord): number {
  return record.turn_messages.filter(hasToolMetadata).length
}

export function buildFeedbackDetailSummary(record: FeedbackRecord) {
  const displayMessages = record.turn_messages.filter(isDisplayableTurnMessage)
  const displayRecord = { ...record, turn_messages: displayMessages }
  const user = firstMessageByRole(displayRecord, 'user')
  const final = finalAssistantMessage(displayRecord)

  return {
    userQuestion: user ? messageText(user) : '',
    finalAnswer: final ? messageText(final) : '',
    displayMessages,
    displayableCount: displayMessages.length,
    toolCallCount: processCount(displayRecord),
    reasoningCount: displayMessages.filter(message => message.role === 'assistant' && message.isIntermediate).length,
  }
}
