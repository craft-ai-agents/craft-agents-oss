/**
 * CommentMargin - Dropbox Paper-style margin commenting
 *
 * Shows a comment button in the margin when text is selected.
 * Comments appear as cards in the margin, aligned with their highlights.
 * Positioned absolutely to the right of the content card.
 */

import * as React from 'react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { MessageSquarePlus, Trash2, X } from 'lucide-react'
import { cn } from '../../../lib/utils'
import type { Comment } from './hooks/useComments'
import type { SelectionState } from './hooks/useTextSelection'

interface CommentMarginProps {
  /** Current text selection */
  selection: SelectionState | null
  /** All comments */
  comments: Comment[]
  /** Ref to the content container (for calculating relative positions) */
  contentRef: React.RefObject<HTMLElement | null>
  /** Ref to the scrollable container */
  scrollRef: React.RefObject<HTMLElement | null>
  /** Called when user submits a new comment */
  onAddComment: (text: string) => void
  /** Called when user deletes a comment */
  onDeleteComment: (id: string) => void
  /** Called when selection should be cleared */
  onClearSelection: () => void
  /** Called when a comment is clicked (to scroll to highlight) */
  onCommentClick?: (comment: Comment) => void
}

interface CommentPosition {
  comment: Comment
  top: number
}

export function CommentMargin({
  selection,
  comments,
  contentRef,
  scrollRef,
  onAddComment,
  onDeleteComment,
  onClearSelection,
  onCommentClick,
}: CommentMarginProps) {
  const [isInputOpen, setIsInputOpen] = useState(false)
  const [inputText, setInputText] = useState('')
  const [selectionTop, setSelectionTop] = useState<number | null>(null)
  const [marginLeft, setMarginLeft] = useState<number>(0)
  const [commentPositions, setCommentPositions] = useState<CommentPosition[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const marginRef = useRef<HTMLDivElement>(null)

  // Calculate margin position (to the right of content card)
  useEffect(() => {
    if (!contentRef.current) return

    const updateMarginPosition = () => {
      const contentRect = contentRef.current!.getBoundingClientRect()
      // Find the content card (parent of contentRef)
      const card = contentRef.current!.parentElement
      if (card) {
        const cardRect = card.getBoundingClientRect()
        // Position margin 16px to the right of the card
        setMarginLeft(cardRect.right + 16)
      }
    }

    updateMarginPosition()
    window.addEventListener('resize', updateMarginPosition)
    return () => window.removeEventListener('resize', updateMarginPosition)
  }, [contentRef])

  // Calculate selection position relative to viewport (since margin is fixed)
  useEffect(() => {
    if (!selection || !contentRef.current || !scrollRef.current) {
      setSelectionTop(null)
      setIsInputOpen(false)
      return
    }

    // Since the margin is position:fixed, we use viewport-relative coordinates directly
    // selection.rect.top is already viewport-relative
    setSelectionTop(selection.rect.top)
  }, [selection, contentRef, scrollRef])

  // Calculate comment positions based on their highlights (viewport-relative for fixed positioning)
  useEffect(() => {
    if (!contentRef.current || !scrollRef.current) return

    const updatePositions = () => {
      const positions: CommentPosition[] = []

      for (const comment of comments) {
        // Find the highlight mark for this comment
        const mark = contentRef.current!.querySelector(
          `mark[data-comment-id="${comment.id}"]`
        )
        if (mark) {
          const markRect = mark.getBoundingClientRect()
          // Use viewport-relative top directly (margin is fixed)
          positions.push({ comment, top: markRect.top })
        }
      }

      // Sort by position and resolve overlaps
      positions.sort((a, b) => a.top - b.top)

      // Ensure minimum spacing between comments (80px minimum for card height)
      const MIN_SPACING = 80
      for (let i = 1; i < positions.length; i++) {
        const prev = positions[i - 1]!
        const curr = positions[i]!
        if (curr.top < prev.top + MIN_SPACING) {
          curr.top = prev.top + MIN_SPACING
        }
      }

      setCommentPositions(positions)
    }

    // Update positions after a short delay (to let highlights render)
    const timer = setTimeout(updatePositions, 100)

    // Also update on scroll since we use fixed positioning
    const scrollEl = scrollRef.current
    scrollEl?.addEventListener('scroll', updatePositions)

    return () => {
      clearTimeout(timer)
      scrollEl?.removeEventListener('scroll', updatePositions)
    }
  }, [comments, contentRef, scrollRef])

  // Handle opening the input
  const handleButtonClick = useCallback(() => {
    setIsInputOpen(true)
    setInputText('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  // Handle submitting a comment
  const handleSubmit = useCallback(() => {
    const trimmed = inputText.trim()
    if (trimmed) {
      onAddComment(trimmed)
      setInputText('')
      setIsInputOpen(false)
    }
  }, [inputText, onAddComment])

  // Handle canceling
  const handleCancel = useCallback(() => {
    setIsInputOpen(false)
    setInputText('')
    onClearSelection()
  }, [onClearSelection])

  // Handle key events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }, [handleSubmit, handleCancel])

  return (
    <div
      ref={marginRef}
      className="fixed top-0 bottom-0 w-[240px] pointer-events-none"
      style={{ left: marginLeft }}
    >
      <AnimatePresence>
        {/* Selection button - appears when text is selected */}
        {selectionTop !== null && !isInputOpen && (
          <motion.button
            key="selection-button"
            initial={{ opacity: 0, scale: 0.9, x: -8 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9, x: -8 }}
            transition={{ duration: 0.15 }}
            onClick={handleButtonClick}
            className={cn(
              "absolute left-0 p-1.5 rounded-[6px] transition-colors pointer-events-auto",
              "bg-background shadow-minimal border border-border/50",
              "text-muted-foreground hover:text-accent hover:border-accent/50",
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            )}
            style={{ top: selectionTop }}
            title="Add comment"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </motion.button>
        )}

        {/* Comment input - appears when button is clicked */}
        {selectionTop !== null && isInputOpen && (
          <motion.div
            key="comment-input"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "absolute left-0 w-full rounded-[8px] pointer-events-auto",
              "bg-background shadow-middle border border-border/50"
            )}
            style={{ top: selectionTop - 4 }}
          >
            {/* Header */}
            <div className="px-3 py-2 border-b border-border/30 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <MessageSquarePlus className="w-3.5 h-3.5 text-accent" />
                <span>Add Comment</span>
              </div>
              <button
                onClick={handleCancel}
                className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Input */}
            <div className="p-2">
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Your feedback..."
                className={cn(
                  "w-full h-[60px] px-2 py-1.5 text-sm rounded-[4px] resize-none",
                  "bg-muted/30 border border-transparent",
                  "placeholder:text-muted-foreground/50",
                  "focus:outline-none focus:border-accent/50"
                )}
              />
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground/50">
                  {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter
                </span>
                <button
                  onClick={handleSubmit}
                  disabled={!inputText.trim()}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-[4px] transition-all",
                    inputText.trim()
                      ? "bg-accent text-accent-foreground hover:bg-accent/90"
                      : "bg-muted text-muted-foreground/50 cursor-not-allowed"
                  )}
                >
                  Add
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Existing comments */}
        {commentPositions.map(({ comment, top }) => (
          <motion.div
            key={comment.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "absolute left-0 w-full rounded-[8px] cursor-pointer pointer-events-auto",
              "bg-background shadow-minimal border border-border/30",
              "hover:border-accent/30 hover:shadow-middle transition-all"
            )}
            style={{ top }}
            onClick={() => onCommentClick?.(comment)}
          >
            {/* Selected text preview */}
            <div className="px-3 py-1.5 border-b border-border/20">
              <p className="text-[11px] text-muted-foreground line-clamp-1 italic">
                "{comment.selectedText}"
              </p>
            </div>

            {/* Comment text */}
            <div className="px-3 py-2">
              <p className="text-xs text-foreground line-clamp-3">
                {comment.commentText}
              </p>
            </div>

            {/* Delete button */}
            <div className="px-3 pb-2">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteComment(comment.id)
                }}
                className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors",
                  "text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10"
                )}
              >
                <Trash2 className="w-2.5 h-2.5" />
                <span>Delete</span>
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
