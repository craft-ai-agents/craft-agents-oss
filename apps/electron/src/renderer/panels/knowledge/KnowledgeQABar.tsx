import React, { useState } from 'react'
import { Send, Loader2 } from 'lucide-react'
import './KnowledgeQABar.css'

interface KnowledgeQABarProps {
  workspaceId: string | null
  onAnswer: (answer: string, nodeIds: number[]) => void
  loading?: boolean
}

export function KnowledgeQABar({ workspaceId, onAnswer, loading = false }: KnowledgeQABarProps) {
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleAsk = async () => {
    if (!workspaceId || !query.trim() || isLoading) return

    setIsLoading(true)
    try {
      // Call IPC handler
      const response = await window.electronAPI?.ask?.(workspaceId, query)
      if (response) {
        onAnswer(response.answer, response.nodeIds)
        setQuery('')
      }
    } catch (err) {
      console.error('Failed to get answer:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="knowledge-qa-bar">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isLoading) {
            handleAsk()
          }
        }}
        placeholder="Ask your workspace..."
        disabled={isLoading || loading}
        className="knowledge-qa-bar__input"
      />
      <button
        onClick={handleAsk}
        disabled={isLoading || loading || !query.trim()}
        className="knowledge-qa-bar__button"
      >
        {isLoading || loading ? (
          <Loader2 size={16} className="knowledge-qa-bar__spinner" />
        ) : (
          <Send size={16} />
        )}
      </button>
    </div>
  )
}
