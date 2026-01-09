/**
 * InlineCommentInput - Input field for adding a new inline comment
 *
 * Appears below selected text when user clicks "Comment" in the toolbar.
 */

import * as React from 'react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { X } from 'lucide-react'
import { cn } from '../../../lib/utils'

interface InlineCommentInputProps {
  /** The selected text being commented on */
  selectedText: string
  /** Called when user submits comment */
  onSubmit: (text: string) => void
  /** Called when user cancels */
  onCancel: () => void
}

export function InlineCommentInput({
  selectedText,
  onSubmit,
  onCancel,
}: InlineCommentInputProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim()
    if (trimmed) {
      onSubmit(trimmed)
    }
  }, [text, onSubmit])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }, [handleSubmit, onCancel])

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "my-2 ml-4 pl-3 py-2 pr-2 rounded-r-[6px]",
        "border-l-2 border-accent/40 bg-muted/10"
      )}
    >
      {/* Selected text preview */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[10px] text-muted-foreground/50 line-clamp-1 flex-1">
          "{selectedText}"
        </p>
        <button
          onClick={onCancel}
          className="p-0.5 rounded-[4px] text-muted-foreground/30 hover:text-foreground transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Input */}
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add your feedback..."
        className={cn(
          "w-full h-[56px] px-2.5 py-2 text-sm rounded-[6px] resize-none",
          "bg-background/50",
          "placeholder:text-muted-foreground/40",
          "focus:outline-none focus:ring-1 focus:ring-accent/30"
        )}
      />

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/40">
          {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter
        </span>
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className={cn(
            "px-2.5 py-1 text-xs font-medium rounded-[6px] transition-all",
            text.trim()
              ? "bg-foreground/5 text-foreground hover:bg-foreground/10"
              : "bg-muted/30 text-muted-foreground/30 cursor-not-allowed"
          )}
        >
          Add
        </button>
      </div>
    </motion.div>
  )
}
