/**
 * FullscreenOverlay - Unified fullscreen view with inline commenting
 *
 * Features GitHub-style inline comments that appear below
 * highlighted text within the document flow.
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import ReactDOM from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Check, Copy, ListTodo, Send, X } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { useTextSelection } from './hooks/useTextSelection'
import { useComments } from './hooks/useComments'
import { HighlightedMarkdown, scrollToHighlight } from './HighlightedMarkdown'
import { SelectionToolbar } from './SelectionToolbar'
import type { Comment } from './hooks/useComments'

export interface FullscreenOverlayProps {
  /** The content to display (markdown) */
  content: string
  /** Whether the overlay is open */
  isOpen: boolean
  /** Called when overlay should close */
  onClose: () => void
  /** Variant: 'response' (default) or 'plan' (shows header) */
  variant?: 'response' | 'plan'
  /** Callback for URL clicks */
  onOpenUrl?: (url: string) => void
  /** Callback for file path clicks */
  onOpenFile?: (path: string) => void
  /** Callback when user sends feedback (all comments formatted) */
  onSendFeedback?: (feedback: string) => void
}

export function FullscreenOverlay({
  content,
  isOpen,
  onClose,
  variant = 'response',
  onOpenUrl,
  onOpenFile,
  onSendFeedback,
}: FullscreenOverlayProps) {
  // Copy state
  const [copied, setCopied] = useState(false)

  // Comment management
  const { comments, addComment, removeComment, clearComments, formatForLLM, count } = useComments()

  // Comment input state
  const [isAddingComment, setIsAddingComment] = useState(false)

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Text selection
  const { selection, clearSelection } = useTextSelection({ containerRef: contentRef })

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isAddingComment) {
          setIsAddingComment(false)
          clearSelection()
          return
        }
        if (selection) {
          clearSelection()
          return
        }
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, selection, isAddingComment, clearSelection, onClose])

  // Reset state when closing
  useEffect(() => {
    if (!isOpen) {
      clearComments()
      clearSelection()
      setIsAddingComment(false)
    }
  }, [isOpen, clearComments, clearSelection])

  // Copy handler
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [content])

  // Handle toolbar comment button
  const handleToolbarComment = useCallback(() => {
    setIsAddingComment(true)
  }, [])

  // Handle toolbar copy
  const handleToolbarCopy = useCallback(() => {
    // Handled in SelectionToolbar
  }, [])

  // Handle adding a comment
  const handleAddComment = useCallback((commentText: string) => {
    if (selection) {
      addComment(selection, commentText)
      clearSelection()
      setIsAddingComment(false)
    }
  }, [selection, addComment, clearSelection])

  // Handle canceling comment input
  const handleCancelComment = useCallback(() => {
    setIsAddingComment(false)
    clearSelection()
  }, [clearSelection])

  // Handle highlight click (scroll to it)
  const handleHighlightClick = useCallback((comment: Comment, element: HTMLElement) => {
    scrollToHighlight(comment.id, contentRef.current || undefined)
  }, [])

  // Handle sending feedback
  const handleSendFeedback = useCallback(() => {
    if (count > 0 && onSendFeedback) {
      const feedback = formatForLLM()
      onSendFeedback(feedback)
      onClose()
    }
  }, [count, formatForLLM, onSendFeedback, onClose])

  if (!isOpen) return null

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Fixed header buttons */}
      <div className="fixed top-4 right-4 z-[60] flex items-center gap-2 [-webkit-app-region:no-drag]">
        {/* Copy button */}
        <button
          onClick={handleCopy}
          className={cn(
            "p-[5px] rounded-[6px] transition-all",
            "bg-background shadow-minimal",
            copied ? "text-success" : "text-muted-foreground/50 hover:text-foreground",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
          title={copied ? "Copied!" : "Copy all"}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>

        {/* Close button */}
        <button
          onClick={onClose}
          className={cn(
            "p-1 rounded-[6px] transition-all",
            "bg-background shadow-minimal",
            "text-muted-foreground/50 hover:text-foreground",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
          title="Close (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main scrollable area */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 bg-foreground-3 overflow-y-auto"
      >
        <div className="min-h-full flex justify-center pt-16 px-6 pb-24">
          {/* Content card */}
          <div className="bg-background rounded-[16px] shadow-strong w-full max-w-[720px] h-fit">
            {/* Plan header (variant="plan" only) */}
            {variant === 'plan' && (
              <div className="px-4 py-2 border-b border-border/30 flex items-center gap-2 bg-success/5 rounded-t-[16px]">
                <ListTodo className="w-3 h-3 text-success" />
                <span className="text-[13px] font-medium text-success">Plan</span>
              </div>
            )}

            {/* Content area */}
            <div ref={contentRef} className="px-10 pt-8 pb-8">
              <div className="text-sm">
                <HighlightedMarkdown
                  content={content}
                  comments={comments}
                  activeSelection={selection}
                  isAddingComment={isAddingComment}
                  onAddComment={handleAddComment}
                  onCancelComment={handleCancelComment}
                  onDeleteComment={removeComment}
                  onHighlightClick={handleHighlightClick}
                  onUrlClick={onOpenUrl}
                  onFileClick={onOpenFile}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Selection toolbar - appears above selected text */}
      {selection && !isAddingComment && (
        <SelectionToolbar
          selection={selection}
          onComment={handleToolbarComment}
          onCopy={handleToolbarCopy}
        />
      )}

      {/* Floating feedback button */}
      <AnimatePresence>
        {count > 0 && onSendFeedback && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 8 }}
            transition={{ duration: 0.15 }}
            onClick={handleSendFeedback}
            className={cn(
              "fixed bottom-6 right-6 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-full",
              "bg-foreground text-background",
              "shadow-middle hover:shadow-strong transition-shadow",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "[-webkit-app-region:no-drag]"
            )}
          >
            <Send className="w-3.5 h-3.5" />
            <span className="text-sm font-medium">Send Feedback</span>
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-background/20 text-xs font-medium">
              {count}
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>,
    document.body
  )
}
