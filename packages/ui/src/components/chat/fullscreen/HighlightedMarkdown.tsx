/**
 * HighlightedMarkdown - Markdown with inline comments (GitHub-style)
 *
 * Renders markdown content with:
 * 1. Highlighted text for comments (yellow background)
 * 2. Inline comment cards below each highlighted section
 * 3. Active selection highlight (blue background)
 * 4. Comment input below active selection when adding
 */

import * as React from 'react'
import { useRef, useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { AnimatePresence } from 'motion/react'
import { cn } from '../../../lib/utils'
import { Markdown } from '../../markdown'
import { InlineComment } from './InlineComment'
import { InlineCommentInput } from './InlineCommentInput'
import type { Comment } from './hooks/useComments'
import type { SelectionState } from './hooks/useTextSelection'

interface HighlightedMarkdownProps {
  /** The markdown content */
  content: string
  /** Array of comments to highlight */
  comments: Comment[]
  /** Current active selection (shown as temporary highlight) */
  activeSelection?: SelectionState | null
  /** Whether we're in "adding comment" mode */
  isAddingComment?: boolean
  /** Called when user submits a comment */
  onAddComment?: (text: string) => void
  /** Called when user cancels adding comment */
  onCancelComment?: () => void
  /** Called when user deletes a comment */
  onDeleteComment?: (id: string) => void
  /** Callback when a highlight is clicked */
  onHighlightClick?: (comment: Comment, element: HTMLElement) => void
  /** Callback for URL clicks */
  onUrlClick?: (url: string) => void
  /** Callback for file path clicks */
  onFileClick?: (path: string) => void
  /** Additional className */
  className?: string
}

/**
 * Finds and wraps text ranges with mark elements based on comments.
 * Also injects comment card containers after each highlight.
 */
function applyHighlightsWithInlineComments(
  container: HTMLElement,
  comments: Comment[],
  onHighlightClick?: (comment: Comment, element: HTMLElement) => void
) {
  // Remove existing highlights and comment containers
  container.querySelectorAll('mark[data-comment-id]').forEach(mark => {
    const parent = mark.parentNode
    if (parent) {
      const textNode = document.createTextNode(mark.textContent || '')
      parent.replaceChild(textNode, mark)
      parent.normalize()
    }
  })
  container.querySelectorAll('[data-comment-container]').forEach(el => el.remove())

  if (comments.length === 0) return

  // Sort comments by start offset
  const sortedComments = [...comments].sort((a, b) => a.startOffset - b.startOffset)

  for (const comment of sortedComments) {
    const { selectedText, id } = comment

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    let node: Node | null
    let found = false

    while ((node = walker.nextNode()) && !found) {
      const textContent = node.textContent || ''
      const index = textContent.indexOf(selectedText)

      if (index !== -1) {
        const textNode = node as Text
        const parent = textNode.parentNode

        if (!parent) continue

        const parentElement = parent as HTMLElement
        if (
          parentElement.tagName === 'MARK' ||
          parentElement.tagName === 'CODE' ||
          parentElement.closest('pre')
        ) {
          continue
        }

        const before = textContent.slice(0, index)
        const match = textContent.slice(index, index + selectedText.length)
        const after = textContent.slice(index + selectedText.length)

        // Create mark element
        const mark = document.createElement('mark')
        mark.setAttribute('data-comment-id', id)
        mark.className = cn(
          'bg-accent/20 rounded-[2px] cursor-pointer transition-colors',
          'hover:bg-accent/30'
        )
        mark.textContent = match

        if (onHighlightClick) {
          mark.addEventListener('click', (e) => {
            e.stopPropagation()
            onHighlightClick(comment, mark)
          })
        }

        // Create comment container placeholder (React will render into it)
        const commentContainer = document.createElement('div')
        commentContainer.setAttribute('data-comment-container', id)
        commentContainer.className = 'inline-comment-slot'

        // Build the replacement structure
        const fragment = document.createDocumentFragment()
        if (before) fragment.appendChild(document.createTextNode(before))
        fragment.appendChild(mark)
        if (after) fragment.appendChild(document.createTextNode(after))

        parent.replaceChild(fragment, textNode)

        // Insert comment container after the paragraph/block containing the mark
        const block = mark.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, div') || mark.parentElement
        if (block && block.parentElement) {
          block.parentElement.insertBefore(commentContainer, block.nextSibling)
        }

        found = true
      }
    }
  }
}

/**
 * Applies a temporary highlight for the active selection
 */
function applyActiveSelectionHighlight(
  container: HTMLElement,
  selection: SelectionState | null | undefined,
  isAddingComment: boolean
): HTMLElement | null {
  // Remove existing active selection highlight
  container.querySelectorAll('mark[data-active-selection]').forEach(mark => {
    const parent = mark.parentNode
    if (parent) {
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark)
      }
      parent.removeChild(mark)
      parent.normalize()
    }
  })
  container.querySelectorAll('[data-input-container]').forEach(el => el.remove())

  if (!selection) return null

  const { range } = selection

  if (!range) return null

  try {
    if (!range.commonAncestorContainer || !container.contains(range.commonAncestorContainer)) {
      return null
    }

    const ancestor = range.commonAncestorContainer
    const ancestorElement = ancestor.nodeType === Node.ELEMENT_NODE
      ? ancestor as HTMLElement
      : ancestor.parentElement
    if (ancestorElement?.closest('pre, code')) {
      return null
    }

    // Create mark for active selection
    const mark = document.createElement('mark')
    mark.setAttribute('data-active-selection', 'true')
    mark.className = cn('bg-info/30 rounded-[2px]')

    if (
      range.startContainer === range.endContainer &&
      range.startContainer.nodeType === Node.TEXT_NODE
    ) {
      range.surroundContents(mark)
    } else {
      const contents = range.extractContents()
      mark.appendChild(contents)
      range.insertNode(mark)
    }

    // If adding comment, insert input container placeholder
    if (isAddingComment) {
      const inputContainer = document.createElement('div')
      inputContainer.setAttribute('data-input-container', 'true')
      inputContainer.className = 'inline-input-slot'

      const block = mark.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, div') || mark.parentElement
      if (block && block.parentElement) {
        block.parentElement.insertBefore(inputContainer, block.nextSibling)
      }
    }

    return mark
  } catch (e) {
    console.debug('Could not apply selection highlight:', e)
    return null
  }
}

export function HighlightedMarkdown({
  content,
  comments,
  activeSelection,
  isAddingComment = false,
  onAddComment,
  onCancelComment,
  onDeleteComment,
  onHighlightClick,
  onUrlClick,
  onFileClick,
  className,
}: HighlightedMarkdownProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [commentSlots, setCommentSlots] = useState<Map<string, HTMLElement>>(new Map())
  const [inputSlot, setInputSlot] = useState<HTMLElement | null>(null)

  // Apply comment highlights after render
  useEffect(() => {
    if (!containerRef.current) return

    const timer = setTimeout(() => {
      if (containerRef.current) {
        applyHighlightsWithInlineComments(containerRef.current, comments, onHighlightClick)

        // Collect comment slots
        const slots = new Map<string, HTMLElement>()
        containerRef.current.querySelectorAll('[data-comment-container]').forEach(el => {
          const id = el.getAttribute('data-comment-container')
          if (id) slots.set(id, el as HTMLElement)
        })
        setCommentSlots(slots)
      }
    }, 50)

    return () => clearTimeout(timer)
  }, [content, comments, onHighlightClick])

  // Apply active selection highlight
  useEffect(() => {
    if (!containerRef.current) return

    applyActiveSelectionHighlight(containerRef.current, activeSelection, isAddingComment)

    // Find input slot if adding comment
    if (isAddingComment) {
      const slot = containerRef.current.querySelector('[data-input-container]')
      setInputSlot(slot as HTMLElement | null)
    } else {
      setInputSlot(null)
    }
  }, [activeSelection, isAddingComment])

  return (
    <div ref={containerRef} className={className}>
      <Markdown
        mode="minimal"
        onUrlClick={onUrlClick}
        onFileClick={onFileClick}
      >
        {content}
      </Markdown>

      {/* Render inline comments into their slots using portals */}
      <AnimatePresence>
        {comments.map(comment => {
          const slot = commentSlots.get(comment.id)
          if (!slot) return null

          return (
            <InlineCommentPortal key={comment.id} container={slot}>
              <InlineComment
                comment={comment}
                onDelete={onDeleteComment || (() => {})}
              />
            </InlineCommentPortal>
          )
        })}
      </AnimatePresence>

      {/* Render input into its slot */}
      <AnimatePresence>
        {isAddingComment && inputSlot && activeSelection && onAddComment && onCancelComment && (
          <InlineCommentPortal container={inputSlot}>
            <InlineCommentInput
              selectedText={activeSelection.text}
              onSubmit={onAddComment}
              onCancel={onCancelComment}
            />
          </InlineCommentPortal>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Portal component to render React content into DOM slots
 */
function InlineCommentPortal({
  container,
  children,
}: {
  container: HTMLElement
  children: React.ReactNode
}) {
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  if (!mounted) return null

  return ReactDOM.createPortal(children, container)
}

/**
 * Scroll a highlight into view and briefly pulse it
 */
export function scrollToHighlight(commentId: string, container?: HTMLElement) {
  const target = container || document
  const mark = target.querySelector(`mark[data-comment-id="${commentId}"]`) as HTMLElement

  if (mark) {
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' })

    mark.style.transition = 'background-color 0.2s'
    mark.style.backgroundColor = 'var(--accent)'
    setTimeout(() => {
      mark.style.backgroundColor = ''
    }, 300)
  }
}
