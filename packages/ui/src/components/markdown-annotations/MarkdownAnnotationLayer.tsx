/**
 * MarkdownAnnotationLayer — Wraps markdown content to detect text selection,
 * manage CSS Custom Highlights, render numbered margin markers, and handle
 * bidirectional hover/click interactions between markers and highlighted text.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Pencil } from 'lucide-react'
import { useMarkdownAnnotations, pathToNode, restoreRange, type Annotation } from './MarkdownAnnotationContext'
import { cn } from '../../lib/utils'

const HL_BASE = 'md-annotation'
const HL_HOVER = 'md-annotation-hover'
const HL_PENDING = 'md-annotation-pending'

// Injected at runtime because Tailwind CSS v4 doesn't reliably process ::highlight() rules.
let highlightStylesInjected = false
function ensureHighlightStyles() {
  if (highlightStylesInjected) return
  highlightStylesInjected = true
  const style = document.createElement('style')
  style.textContent = `
    ::highlight(${HL_BASE}) {
      background-color: oklch(from var(--accent) l c h / 0.25);
    }
    ::highlight(${HL_HOVER}) {
      background-color: oklch(from var(--accent) l c h / 0.40);
    }
    ::highlight(${HL_PENDING}) {
      background-color: oklch(from var(--accent) l c h / 0.35);
    }
  `
  document.head.appendChild(style)
}

function syncHighlights(
  annotations: Annotation[],
  hoveredId: string | null,
  pendingRange: Range | null,
  root: Node | null,
) {
  if (!root || typeof CSS === 'undefined' || !('highlights' in CSS)) return
  ensureHighlightStyles()

  const baseRanges: Range[] = []
  const hoverRanges: Range[] = []

  for (const ann of annotations) {
    const r = restoreRange(ann.rangeInfo, root)
    if (!r) continue
    baseRanges.push(r)
    if (ann.id === hoveredId) {
      hoverRanges.push(r)
    }
  }

  if (baseRanges.length > 0) {
    // @ts-expect-error — Highlight API types not yet in lib.dom
    CSS.highlights.set(HL_BASE, new Highlight(...baseRanges))
  } else {
    // @ts-expect-error
    CSS.highlights.delete(HL_BASE)
  }

  if (hoverRanges.length > 0) {
    // @ts-expect-error
    CSS.highlights.set(HL_HOVER, new Highlight(...hoverRanges))
  } else {
    // @ts-expect-error
    CSS.highlights.delete(HL_HOVER)
  }

  if (pendingRange) {
    // @ts-expect-error
    CSS.highlights.set(HL_PENDING, new Highlight(pendingRange))
  } else {
    // @ts-expect-error
    CSS.highlights.delete(HL_PENDING)
  }
}

function annotationAtPoint(
  x: number,
  y: number,
  annotations: Annotation[],
  root: Node,
): string | null {
  for (const ann of annotations) {
    const range = restoreRange(ann.rangeInfo, root)
    if (!range) continue
    const rects = range.getClientRects()
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]!
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return ann.id
      }
    }
  }
  return null
}

interface MarkerPosition {
  annotation: Annotation
  index: number
  top: number
  rightOffset: number
}

function computeMarkerPositions(annotations: Annotation[], root: Node | null): MarkerPosition[] {
  if (!root) return []

  const positions: MarkerPosition[] = annotations.map((ann, i) => ({
    annotation: ann,
    index: i,
    top: computeTop(ann.rangeInfo, root),
    rightOffset: 0,
  }))

  // Group by top (within 6px tolerance) and assign horizontal offsets
  const used = new Set<number>()
  for (let i = 0; i < positions.length; i++) {
    if (used.has(i)) continue
    const group = [i]
    for (let j = i + 1; j < positions.length; j++) {
      if (used.has(j)) continue
      if (Math.abs(positions[j]!.top - positions[i]!.top) < 6) {
        group.push(j)
      }
    }
    group.forEach((idx, slot) => {
      positions[idx]!.rightOffset = (group.length - 1 - slot) * 24
      used.add(idx)
    })
  }

  return positions
}

const MARKER_SIZE = 20

function computeTop(rangeInfo: Annotation['rangeInfo'], root: Node): number {
  try {
    const startNode = pathToNode(rangeInfo.startContainerPath, root)
    const endNode = pathToNode(rangeInfo.endContainerPath, root)
    if (!startNode || !endNode) return 0
    const r = document.createRange()
    r.setStart(startNode, rangeInfo.startOffset)
    r.setEnd(endNode, rangeInfo.endOffset)
    const rects = r.getClientRects()
    if (rects.length === 0) return 0
    const firstRect = rects[0]!
    const rootRect = (root as HTMLElement).getBoundingClientRect()
    return firstRect.top + firstRect.height / 2 - rootRect.top - MARKER_SIZE / 2
  } catch {
    return 0
  }
}

function AnnotationMarker({
  index,
  top,
  rightOffset,
  isHovered,
  onHover,
  onLeave,
  onClick,
}: {
  index: number
  top: number
  rightOffset: number
  isHovered: boolean
  onHover: () => void
  onLeave: () => void
  onClick: () => void
}) {
  return (
    <button
      aria-label={`Comment ${index + 1}`}
      className={cn(
        "absolute w-5 h-5 rounded-full flex items-center justify-center overflow-hidden",
        "bg-accent text-white text-[10px] font-semibold leading-none",
        "cursor-pointer select-none shadow-sm",
        "transition-transform duration-100 will-change-transform",
        isHovered && "scale-110"
      )}
      style={{ top, right: rightOffset }}
      title={`Comment #${index + 1}`}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={(e) => { e.stopPropagation(); onClick() }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {isHovered ? (
          <motion.span
            key="edit"
            className="flex items-center justify-center"
            initial={{ scale: 0.7, filter: 'blur(2px)', opacity: 0 }}
            animate={{ scale: 1, filter: 'blur(0px)', opacity: 1 }}
            exit={{ scale: 0.7, filter: 'blur(2px)', opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <Pencil className="w-2.5 h-2.5" />
          </motion.span>
        ) : (
          <motion.span
            key="number"
            className="flex items-center justify-center"
            initial={{ scale: 0.7, filter: 'blur(2px)', opacity: 0 }}
            animate={{ scale: 1, filter: 'blur(0px)', opacity: 1 }}
            exit={{ scale: 0.7, filter: 'blur(2px)', opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {index + 1}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}

export function MarkdownAnnotationLayer({ children }: { children: ReactNode }) {
  const {
    annotations,
    pendingSelection,
    hoveredAnnotationId,
    editingAnnotation,
    setPendingSelection,
    setEditingAnnotation,
    setHoveredAnnotationId,
    contentRef,
  } = useMarkdownAnnotations()

  const localRef = useRef<HTMLDivElement>(null)

  // Stack-based ref management: last mounted layer wins.
  // When this layer unmounts the previous layer's DOM is restored,
  // ensuring addAnnotation serializes ranges against the correct root.
  useLayoutEffect(() => {
    const prev = contentRef.current
    contentRef.current = localRef.current
    return () => {
      contentRef.current = prev
    }
  }, [contentRef])

  // No dependency array — re-syncs on every render. Necessary because when the
  // fullscreen layer unmounts (clearing highlights), the inline layer must
  // immediately re-apply highlights from its own DOM.
  useLayoutEffect(() => {
    if (!localRef.current) return
    syncHighlights(annotations, hoveredAnnotationId, pendingSelection?.range ?? null, localRef.current)
    return () => {
      if (typeof CSS !== 'undefined' && 'highlights' in CSS) {
        // @ts-expect-error
        CSS.highlights.delete(HL_BASE)
        // @ts-expect-error
        CSS.highlights.delete(HL_HOVER)
        // @ts-expect-error
        CSS.highlights.delete(HL_PENDING)
      }
    }
  })

  const [markerPositions, setMarkerPositions] = useState<MarkerPosition[]>([])
  useLayoutEffect(() => {
    setMarkerPositions(computeMarkerPositions(annotations, localRef.current))
  }, [annotations])

  // Listen on document so we catch mouseup even when the cursor drifts outside the layer
  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-annotation-marker]')) return

      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !localRef.current) return

      const text = sel.toString().trim()
      if (!text) return

      const range = sel.getRangeAt(0)
      if (!localRef.current.contains(range.commonAncestorContainer)) return

      const rect = range.getBoundingClientRect()
      setEditingAnnotation(null)
      setPendingSelection({ rect, citation: text, range: range.cloneRange() })
      sel.removeAllRanges()
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [setPendingSelection, setEditingAnnotation])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-annotation-marker]')) return
    if (!localRef.current || annotations.length === 0) return
    if (!editingAnnotation && !pendingSelection) return

    const hitId = annotationAtPoint(e.clientX, e.clientY, annotations, localRef.current)
    if (hitId) {
      e.preventDefault()
    }
  }, [annotations, editingAnnotation, pendingSelection])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-annotation-marker]')) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return

    if (!localRef.current || annotations.length === 0) return

    const hitId = annotationAtPoint(e.clientX, e.clientY, annotations, localRef.current)
    if (hitId) {
      const ann = annotations.find(a => a.id === hitId)
      if (!ann) return
      const range = restoreRange(ann.rangeInfo, localRef.current)
      if (!range) return
      const rect = range.getBoundingClientRect()
      setEditingAnnotation({ id: hitId, rect })
    }
  }, [annotations, setEditingAnnotation])

  const hoveredIdRef = useRef(hoveredAnnotationId)
  hoveredIdRef.current = hoveredAnnotationId

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!localRef.current || annotations.length === 0) {
      if (hoveredIdRef.current) setHoveredAnnotationId(null)
      return
    }

    if ((e.target as HTMLElement).closest('[data-annotation-marker]')) return

    const hitId = annotationAtPoint(e.clientX, e.clientY, annotations, localRef.current)
    if (hitId !== hoveredIdRef.current) {
      setHoveredAnnotationId(hitId)
    }
  }, [annotations, setHoveredAnnotationId])

  const handleMouseLeave = useCallback(() => {
    if (hoveredIdRef.current) setHoveredAnnotationId(null)
  }, [setHoveredAnnotationId])

  const handleMarkerClick = useCallback((ann: Annotation) => {
    if (!localRef.current) return
    const range = restoreRange(ann.rangeInfo, localRef.current)
    if (!range) return
    const rect = range.getBoundingClientRect()
    setEditingAnnotation({ id: ann.id, rect })
  }, [setEditingAnnotation])

  return (
    <div
      ref={localRef}
      className={cn(
        "relative pr-7",
        annotations.length > 0 && "cursor-text",
      )}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onMouseMove={annotations.length > 0 ? handleMouseMove : undefined}
      onMouseLeave={annotations.length > 0 ? handleMouseLeave : undefined}
    >
      {children}

      {markerPositions.map(({ annotation, index, top, rightOffset }) => (
        <div key={annotation.id} data-annotation-marker>
          <AnnotationMarker
            index={index}
            top={top}
            rightOffset={rightOffset}
            isHovered={hoveredAnnotationId === annotation.id}
            onHover={() => setHoveredAnnotationId(annotation.id)}
            onLeave={() => setHoveredAnnotationId(null)}
            onClick={() => handleMarkerClick(annotation)}
          />
        </div>
      ))}
    </div>
  )
}
