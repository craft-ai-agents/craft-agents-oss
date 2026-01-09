/**
 * InlineComment - GitHub-style inline comment display
 *
 * Shows a comment card inline with the content, positioned below
 * the highlighted text it references.
 */

import * as React from 'react'
import { motion } from 'motion/react'
import { Trash2 } from 'lucide-react'
import { cn } from '../../../lib/utils'
import type { Comment } from './hooks/useComments'

interface InlineCommentProps {
  /** The comment to display */
  comment: Comment
  /** Called when user deletes the comment */
  onDelete: (id: string) => void
}

export function InlineComment({ comment, onDelete }: InlineCommentProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "my-2 ml-4 pl-3 py-2 pr-2 rounded-r-[6px]",
        "border-l-2 border-accent/40 bg-muted/10",
        "group"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Selected text preview */}
          <p className="text-[10px] text-muted-foreground/50 line-clamp-1 mb-1">
            "{comment.selectedText}"
          </p>
          {/* Comment text */}
          <p className="text-sm text-foreground/90 leading-relaxed">
            {comment.commentText}
          </p>
        </div>
        {/* Delete button - visible on hover */}
        <button
          onClick={() => onDelete(comment.id)}
          className={cn(
            "p-1 rounded-[4px] transition-all shrink-0",
            "opacity-0 group-hover:opacity-100",
            "text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10"
          )}
          title="Delete comment"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  )
}
