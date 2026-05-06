import { useState, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { ShikiCodeViewer } from '@/components/shiki/ShikiCodeViewer'
import type { LineComment } from '@/atoms/line-comments'

const LINE_HEIGHT_PX = 13 * 1.6   // font-size 13px × line-height 1.6
const CODE_PADDING_TOP_PX = 16    // pt-4 = 16px
const GUTTER_WIDTH_PX = 60        // matches ShikiCodeViewer's minWidth

export interface LineAnnotatableViewerProps {
  code: string
  filePath: string
  language?: string
  startLine?: number
  className?: string
  onComment: (comment: LineComment) => void
}

interface Widget {
  lineIndex: number
  top: number
}

export function LineAnnotatableViewer({
  code,
  filePath,
  language,
  startLine = 1,
  className,
  onComment,
}: LineAnnotatableViewerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [hoveredLine, setHoveredLine] = useState<number | null>(null)
  const [widget, setWidget] = useState<Widget | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lines = code.split('\n')

  const getLineIndexFromY = useCallback((clientY: number): number | null => {
    const el = wrapperRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const scrollTop = el.scrollTop
    const relY = clientY - rect.top + scrollTop - CODE_PADDING_TOP_PX
    if (relY < 0) return null
    const idx = Math.floor(relY / LINE_HEIGHT_PX)
    return idx < lines.length ? idx : null
  }, [lines.length])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (widget) return
    const idx = getLineIndexFromY(e.clientY)
    setHoveredLine(idx)
  }, [widget, getLineIndexFromY])

  const handleMouseLeave = useCallback(() => {
    setHoveredLine(null)
  }, [])

  const openWidget = useCallback((lineIndex: number) => {
    const top = CODE_PADDING_TOP_PX + lineIndex * LINE_HEIGHT_PX + LINE_HEIGHT_PX
    setWidget({ lineIndex, top })
    setHoveredLine(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const closeWidget = useCallback(() => {
    setWidget(null)
  }, [])

  const handleAnnotate = useCallback(() => {
    if (!widget || !textareaRef.current) return
    const text = textareaRef.current.value.trim()
    if (!text) return
    const lineContent = (lines[widget.lineIndex] ?? '').trim()
    onComment({
      filePath,
      lineNumber: startLine + widget.lineIndex,
      lineContent,
      text,
    })
    closeWidget()
  }, [widget, lines, filePath, startLine, onComment, closeWidget])

  const plusBtnTop =
    hoveredLine !== null
      ? CODE_PADDING_TOP_PX + hoveredLine * LINE_HEIGHT_PX + (LINE_HEIGHT_PX - 20) / 2
      : 0

  return (
    <div
      ref={wrapperRef}
      className={cn('relative h-full w-full overflow-auto', className)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <ShikiCodeViewer
        code={code}
        filePath={filePath}
        language={language}
        startLine={startLine}
        className="h-full text-xs"
      />

      {hoveredLine !== null && !widget && (
        <button
          type="button"
          aria-label="Add line comment"
          className={cn(
            'absolute z-20 flex items-center justify-center',
            'w-5 h-5 rounded border border-border bg-background text-foreground',
            'text-[14px] leading-none cursor-pointer hover:bg-foreground/10',
            'shadow-sm'
          )}
          style={{
            left: GUTTER_WIDTH_PX - 26,
            top: plusBtnTop,
          }}
          onClick={() => openWidget(hoveredLine)}
        >
          +
        </button>
      )}

      {widget && (
        <div
          className={cn(
            'absolute z-30 mx-2 rounded-md border border-border bg-background p-2 shadow-md',
          )}
          style={{
            left: GUTTER_WIDTH_PX + 8,
            top: widget.top,
            right: 8,
          }}
        >
          <textarea
            ref={textareaRef}
            className={cn(
              'w-full min-h-[60px] resize-y rounded border border-border bg-background',
              'px-2 py-1.5 text-[12px] font-mono text-foreground placeholder:text-muted-foreground',
              'outline-none focus:ring-1 focus:ring-ring',
            )}
            placeholder="Add a comment…"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              type="button"
              className="rounded border border-border px-2.5 py-1 text-[12px] hover:bg-foreground/5"
              onClick={closeWidget}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded bg-foreground px-2.5 py-1 text-[12px] text-background hover:opacity-90"
              onClick={handleAnnotate}
            >
              Annotate
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
