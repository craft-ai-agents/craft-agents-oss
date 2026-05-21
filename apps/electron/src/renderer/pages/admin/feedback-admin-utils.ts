import type {
  FeedbackContentPart,
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

export function textFromPart(part: FeedbackContentPart): string {
  if (typeof part.text === 'string') return part.text
  if (typeof part.file_url === 'string') return part.filename || part.file_url

  const data = part.data
  if (data?.output && typeof data.output === 'string') return data.output
  if (data?.arguments && typeof data.arguments === 'string') return data.arguments
  return ''
}

export function messageText(message: FeedbackTurnMessage): string {
  return message.content
    .map(textFromPart)
    .map(text => text.trim())
    .filter(Boolean)
    .join('\n\n')
}

export function isDisplayableContentPart(part: FeedbackContentPart): boolean {
  if (part.type === 'data') {
    return !!part.data && Object.keys(part.data).length > 0
  }
  if (part.type === 'file') {
    return Boolean(part.filename || part.file_url)
  }
  return textFromPart(part).trim().length > 0
}

export function isDisplayableTurnMessage(message: FeedbackTurnMessage): boolean {
  return message.content.some(isDisplayableContentPart)
}

export function firstMessageByRole(record: FeedbackRecord, role: string): FeedbackTurnMessage | undefined {
  return record.turn_messages.find(message => message.role === role)
}

export function finalAssistantMessage(record: FeedbackRecord): FeedbackTurnMessage | undefined {
  return [...record.turn_messages]
    .reverse()
    .find(message => message.role === 'assistant' && message.type === 'message')
}

export function processCount(record: FeedbackRecord): number {
  return record.turn_messages.filter(message => message.type === 'plugin_call').length
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
    reasoningCount: displayMessages.filter(message => message.type === 'reasoning').length,
  }
}
