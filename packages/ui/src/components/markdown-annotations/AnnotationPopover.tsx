/**
 * AnnotationPopover — Floating comment input for adding or editing annotations.
 *
 * Two modes:
 * 1. New annotation: shown when pendingSelection is set (user selected text)
 * 2. Edit annotation: shown when editingAnnotation is set (clicked marker/text)
 *
 * Portals to the nearest Radix Dialog (fullscreen) or document.body (inline).
 *
 * The outer `AnnotationPopover` gates visibility; the inner
 * `AnnotationPopoverInner` mounts fresh each time (keyed by annotation id)
 * so `useState` initializes with the correct value — no sync effect needed.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as ReactDOM from 'react-dom'
import { motion } from 'motion/react'
import { Trash2 } from 'lucide-react'
import { useMarkdownAnnotations } from './MarkdownAnnotationContext'
import { cn } from '../../lib/utils'

const POPOVER_GAP = 8
const POPOVER_WIDTH = 320

function getPortalTarget(contentEl: HTMLElement | null): HTMLElement {
  if (!contentEl) return document.body
  const dialog = contentEl.closest('[role="dialog"]')
  return (dialog as HTMLElement) || document.body
}

export function AnnotationPopover() {
  const { pendingSelection, editingAnnotation } = useMarkdownAnnotations()

  const isEditing = !!editingAnnotation
  const isCreating = !!pendingSelection && !editingAnnotation
  const isOpen = isCreating || isEditing

  if (!isOpen) return null

  // Key forces a fresh mount when switching annotations or between create/edit,
  // so useState initializes with the correct comment value on first render.
  return <AnnotationPopoverInner key={editingAnnotation?.id ?? 'new'} />
}

function AnnotationPopoverInner() {
  const {
    pendingSelection,
    editingAnnotation,
    annotations,
    setPendingSelection,
    setEditingAnnotation,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    contentRef,
  } = useMarkdownAnnotations()

  const isEditing = !!editingAnnotation
  const isCreating = !!pendingSelection && !editingAnnotation

  // Find the annotation being edited
  const editedAnnotation = isEditing
    ? annotations.find(a => a.id === editingAnnotation.id)
    : null

  // Lazy initializer: correct value on first render, no sync effect needed.
  const [comment, setComment] = useState(() =>
    isEditing && editedAnnotation ? editedAnnotation.comment : ''
  )

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const commentRef = useRef(comment)
  commentRef.current = comment

  // Focus input when popover opens
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        // Select all text in edit mode for easy replacement
        if (isEditing) {
          inputRef.current?.select()
        }
      })
    })
  }, [isEditing])

  // Sync textarea height to content (avoids rows vs scrollHeight mismatch)
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    // scrollHeight excludes border; add it back for border-box sizing
    const border = el.offsetHeight - el.clientHeight
    const desired = el.scrollHeight + border
    const maxH = parseFloat(getComputedStyle(el).maxHeight) || Infinity
    el.style.height = desired + 'px'
    // Only allow scrolling when content actually exceeds max-height
    el.style.overflowY = desired >= maxH ? 'auto' : 'hidden'
  }, [comment])

  // Dismiss: auto-save non-empty comment, then close
  const dismiss = useCallback(() => {
    const trimmed = commentRef.current.trim()
    if (trimmed) {
      if (isEditing && editingAnnotation) {
        updateAnnotation(editingAnnotation.id, trimmed)
      } else {
        addAnnotation(trimmed)
      }
    }
    setComment('')
    setPendingSelection(null)
    setEditingAnnotation(null)
  }, [isEditing, editingAnnotation, addAnnotation, updateAnnotation, setPendingSelection, setEditingAnnotation])

  // Dismiss on ESC. The parent overlay's Dialog.Content onEscapeKeyDown
  // checks for [data-annotation-popover] and calls preventDefault() to
  // keep the overlay open — so we only need to dismiss ourselves here.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        dismiss()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [dismiss])

  // Dismiss on click outside (but not on markers — their click handler updates the popover)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        if ((e.target as HTMLElement).closest('[data-annotation-marker]')) return
        dismiss()
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 100)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [dismiss])

  const handleSubmit = useCallback(() => {
    const trimmed = comment.trim()
    if (!trimmed) return

    if (isEditing && editingAnnotation) {
      updateAnnotation(editingAnnotation.id, trimmed)
    } else {
      addAnnotation(trimmed)
    }
    setComment('')
  }, [comment, isEditing, editingAnnotation, addAnnotation, updateAnnotation])

  const handleDelete = useCallback(() => {
    if (editingAnnotation) {
      removeAnnotation(editingAnnotation.id)
      setComment('')
    }
  }, [editingAnnotation, removeAnnotation])

  // Compute position from the active rect
  const rect = isEditing ? editingAnnotation!.rect : pendingSelection!.rect
  const citation = isEditing ? editedAnnotation?.citation : pendingSelection!.citation

  let top = rect.bottom + POPOVER_GAP
  let left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2

  // Clamp horizontally
  if (left < 8) left = 8
  if (left + POPOVER_WIDTH > window.innerWidth - 8) {
    left = window.innerWidth - POPOVER_WIDTH - 8
  }

  // If not enough space below, flip above
  if (top + 180 > window.innerHeight - 8) {
    top = rect.top - 180 - POPOVER_GAP
  }

  const portalTarget = getPortalTarget(contentRef.current)

  return ReactDOM.createPortal(
    <motion.div
      ref={popoverRef}
      data-annotation-popover
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className={cn(
        "fixed z-[400] p-3",
        "bg-background rounded-[8px] shadow-strong border border-border/50",
      )}
      style={{ top, left, width: POPOVER_WIDTH }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Truncated citation preview */}
      {citation && (
        <div className="text-[11px] text-muted-foreground mb-2 line-clamp-2 italic">
          &ldquo;{citation.slice(0, 80)}{citation.length > 80 ? '…' : ''}&rdquo;
        </div>
      )}

      <textarea
        ref={inputRef}
        rows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSubmit()
          }
        }}
        placeholder="Add your comment…"
        className={cn(
          "w-full px-2.5 py-1.5 text-sm rounded-[6px] outline-none resize-none",
          "bg-muted/30 border border-border/50",
          "placeholder:text-muted-foreground/50",
          "focus:border-accent/50 focus:ring-1 focus:ring-accent/20",
          "max-h-[calc(6*1.5em)]"
        )}
      />

      <div className="flex items-center justify-between mt-2">
        {/* Delete button (edit mode only) */}
        {isEditing ? (
          <button
            onClick={handleDelete}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-xs rounded-[4px] transition-colors",
              "text-muted-foreground hover:text-destructive"
            )}
          >
            <Trash2 className="w-3 h-3" />
            <span>Delete</span>
          </button>
        ) : (
          <div />
        )}

        <button
          onClick={handleSubmit}
          disabled={!comment.trim()}
          className={cn(
            "px-2.5 py-1 text-xs font-medium rounded-[6px] transition-colors",
            comment.trim()
              ? "bg-accent text-white hover:bg-accent/90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {isEditing ? 'Save' : 'Add'}
        </button>
      </div>
    </motion.div>,
    portalTarget
  )
}
