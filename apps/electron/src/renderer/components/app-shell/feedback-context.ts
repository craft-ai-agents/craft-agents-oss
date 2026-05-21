import type { Message } from "../../../shared/types"

export type FeedbackRating = 'like' | 'dislike'

export interface FeedbackConversationContext {
  conversationMessages: Message[]
  userBoundaryMessages: Message[]
}

export interface PersistedFeedbackStateEntry {
  session_id: string
  message_id: string
  isLike: boolean
  feedbackId?: string
}

export interface FeedbackStateValue {
  rating: FeedbackRating
  feedbackId?: string
}

export function clampFeedbackComment(comment: string): string {
  return comment.slice(0, 255)
}

export function resolveNextFeedbackValue(
  currentValue: FeedbackRating | null | undefined,
  selectedValue: FeedbackRating
): FeedbackRating | null {
  return currentValue === selectedValue ? null : selectedValue
}

export function buildFeedbackStateByMessageId(
  entries: PersistedFeedbackStateEntry[],
  sessionId: string
): Record<string, FeedbackStateValue> {
  const feedbackByMessageId: Record<string, FeedbackStateValue> = {}

  for (const entry of entries) {
    if (entry.session_id === sessionId) {
      feedbackByMessageId[entry.message_id] = {
        rating: entry.isLike ? 'like' : 'dislike',
        ...(entry.feedbackId ? { feedbackId: entry.feedbackId } : {}),
      }
    }
  }

  return feedbackByMessageId
}

export function buildFeedbackTurnMessages(context: FeedbackConversationContext): Message[] {
  return [...context.conversationMessages]
}

export function buildFeedbackConversationContext(
  messages: Message[],
  responseMessageId?: string,
  turnId?: string
): FeedbackConversationContext {
  const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp)

  let targetIndex = responseMessageId
    ? sortedMessages.findIndex(message => message.id === responseMessageId)
    : -1

  if (targetIndex === -1 && turnId) {
    targetIndex = sortedMessages.findLastIndex(message => message.turnId === turnId)
  }

  if (targetIndex === -1) {
    return {
      conversationMessages: [],
      userBoundaryMessages: [],
    }
  }

  const previousUserIndex = findPreviousUserIndex(sortedMessages, targetIndex)
  const nextUserIndex = sortedMessages.findIndex((message, index) =>
    index > targetIndex && message.role === 'user'
  )

  const conversationStartIndex = previousUserIndex === -1 ? targetIndex : previousUserIndex
  const conversationEndIndex = nextUserIndex === -1 ? sortedMessages.length : nextUserIndex

  const userBoundaryMessages = [
    previousUserIndex === -1 ? undefined : sortedMessages[previousUserIndex],
    nextUserIndex === -1 ? undefined : sortedMessages[nextUserIndex],
  ].filter((message): message is Message => Boolean(message))

  return {
    conversationMessages: sortedMessages.slice(conversationStartIndex, conversationEndIndex),
    userBoundaryMessages,
  }
}

function findPreviousUserIndex(messages: Message[], targetIndex: number): number {
  for (let index = targetIndex; index >= 0; index--) {
    if (messages[index]?.role === 'user') {
      return index
    }
  }
  return -1
}
