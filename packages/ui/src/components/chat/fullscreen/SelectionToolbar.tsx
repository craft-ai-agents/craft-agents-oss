/**
 * SelectionToolbar - Floating toolbar above selected text
 *
 * Appears above text selection with Comment and Copy actions.
 * Follows common text editor patterns (like formatting toolbars).
 */

import * as React from 'react'
import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { MessageSquarePlus, Copy, Check } from 'lucide-react'
import { cn } from '../../../lib/utils'
import type { SelectionState } from './hooks/useTextSelection'

interface SelectionToolbarProps {
  /** Current text selection */
  selection: SelectionState | null
  /** Called when user clicks comment button */
  onComment: () => void
  /** Called when user copies text */
  onCopy: (text: string) => void
}

const TOOLBAR_HEIGHT = 32
const TOOLBAR_OFFSET = 8

export function SelectionToolbar({
  selection,
  onComment,
  onCopy,
}: SelectionToolbarProps) {
  const [copied, setCopied] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  // Calculate position based on selection rect
  useEffect(() => {
    if (!selection) {
      setPosition(null)
      setCopied(false)
      return
    }

    const { rect } = selection

    // Center toolbar above selection
    let left = rect.left + rect.width / 2
    let top = rect.top - TOOLBAR_HEIGHT - TOOLBAR_OFFSET

    // Keep within viewport bounds
    const toolbarWidth = 80 // Approximate width
    const padding = 8

    // Horizontal bounds
    if (left - toolbarWidth / 2 < padding) {
      left = padding + toolbarWidth / 2
    } else if (left + toolbarWidth / 2 > window.innerWidth - padding) {
      left = window.innerWidth - padding - toolbarWidth / 2
    }

    // If not enough space above, show below
    if (top < padding) {
      top = rect.bottom + TOOLBAR_OFFSET
    }

    setPosition({ left, top })
  }, [selection])

  const handleCopy = useCallback(async () => {
    if (!selection) return
    try {
      await navigator.clipboard.writeText(selection.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [selection, onCopy])

  if (!selection || !position) return null

  return (
    <AnimatePresence>
      <motion.div
        key="selection-toolbar"
        initial={{ opacity: 0, scale: 0.9, y: 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 4 }}
        transition={{ duration: 0.12 }}
        className={cn(
          "fixed z-[70] flex items-center gap-0.5 p-1 rounded-[8px]",
          "bg-background shadow-middle",
          "[-webkit-app-region:no-drag]"
        )}
        style={{
          left: position.left,
          top: position.top,
          transform: 'translateX(-50%)',
        }}
      >
        {/* Comment button */}
        <button
          onClick={onComment}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-[6px] transition-colors",
            "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
          title="Add comment"
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">Comment</span>
        </button>

        {/* Divider */}
        <div className="w-px h-4 bg-border/50" />

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-[6px] transition-colors",
            copied
              ? "text-success"
              : "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
          title={copied ? "Copied!" : "Copy"}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          <span className="text-xs font-medium">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
