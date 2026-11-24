import { useCallback, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'

/** The panel keeps this far from the display's edges. */
export const EDGE = 12
/** The panel's height range; the free space below it (or above it) decides within it. */
export const PANEL_MIN_HEIGHT = 160
export const PANEL_MAX_HEIGHT = 520

interface Drag {
  pointerId: number
  startX: number
  startY: number
  origin: { x: number; y: number }
  /** The panel's rect when the drag started, to keep it on the display. */
  rect: DOMRect
}

/**
 * Places the panel at (x, y): its top-left corner, or its bottom-left corner when `above`. You can
 * drag it by any element marked `data-drag-handle` (the header), within the display.
 *
 * The offset is this wrapper's state, so a drag re-renders only the wrapper: `children` keeps its
 * identity and React skips the panel and its streaming answer. The panel reads its max height from
 * `--crafty-max-height`, which follows the free space at the new spot.
 *
 * The pointer is captured on the panel element itself. That keeps the panel's pointerleave from
 * firing mid-drag, which would make the window click-through again and drop the drag.
 */
export function PanelAnchor({ x, y, above, children }: { x: number; y: number; above: boolean; children: ReactNode }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<Drag | null>(null)

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (e.button !== 0 || !target.closest('[data-drag-handle]') || target.closest('button, a, input, textarea')) return
    const panel = e.currentTarget.querySelector<HTMLElement>('.crafty-panel')
    if (!panel) return
    // No text selection while dragging, and the input keeps focus
    e.preventDefault()
    panel.setPointerCapture(e.pointerId)
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origin: offset, rect: panel.getBoundingClientRect() }
  }, [offset])

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    // The window covers the display, so client coordinates are display coordinates
    const dx = Math.min(Math.max(e.clientX - d.startX, -d.rect.left), window.innerWidth - d.rect.right)
    const dy = Math.min(Math.max(e.clientY - d.startY, -d.rect.top), window.innerHeight - d.rect.bottom)
    setOffset({ x: d.origin.x + dx, y: d.origin.y + dy })
  }, [])

  const onPointerEnd = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null
  }, [])

  const top = y + offset.y
  const space = above ? top - EDGE : window.innerHeight - top - EDGE
  const maxHeight = Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, space))

  return (
    <div
      className="crafty-panel-anchor"
      style={{ transform: `translate(${x + offset.x}px, ${top}px)`, '--crafty-max-height': `${maxHeight}px` } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <div style={above ? { transform: 'translateY(-100%)' } : undefined}>{children}</div>
    </div>
  )
}
