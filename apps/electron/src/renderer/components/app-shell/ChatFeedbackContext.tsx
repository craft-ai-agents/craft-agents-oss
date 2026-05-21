import * as React from "react"
import type { FeedbackStateValue } from "./feedback-context"

type FeedbackStateByMessageId = Record<string, FeedbackStateValue>

interface ChatFeedbackContextValue {
  feedbackByMessageId: FeedbackStateByMessageId
  setFeedbackByMessageId: React.Dispatch<React.SetStateAction<FeedbackStateByMessageId>>
  resetFeedback: () => void
}

const ChatFeedbackContext = React.createContext<ChatFeedbackContextValue | null>(null)

export function ChatFeedbackProvider({ children }: { children: React.ReactNode }) {
  const [feedbackByMessageId, setFeedbackByMessageId] = React.useState<FeedbackStateByMessageId>({})

  const resetFeedback = React.useCallback(() => {
    setFeedbackByMessageId({})
  }, [])

  const value = React.useMemo(() => ({
    feedbackByMessageId,
    setFeedbackByMessageId,
    resetFeedback,
  }), [feedbackByMessageId, resetFeedback])

  return (
    <ChatFeedbackContext.Provider value={value}>
      {children}
    </ChatFeedbackContext.Provider>
  )
}

export function useChatFeedbackContext(): ChatFeedbackContextValue {
  const context = React.useContext(ChatFeedbackContext)
  if (!context) {
    throw new Error('useChatFeedbackContext must be used within ChatFeedbackProvider')
  }
  return context
}
