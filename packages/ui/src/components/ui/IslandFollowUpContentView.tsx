import * as React from 'react'
import { IslandContentView, type IslandMorphTarget } from './Island'

export type IslandFollowUpMode = 'edit' | 'view'

export interface IslandFollowUpContentViewProps {
  id: string
  value: string
  onValueChange: (next: string) => void
  onCancel: () => void
  onSubmit: (value: string) => void
  onDelete?: () => void
  title?: string
  placeholder?: string
  submitLabel?: string
  editLabel?: string
  deleteLabel?: string
  maxInputHeight?: number
  sendMessageKey?: 'enter' | 'cmd-enter'
  morphFrom?: IslandMorphTarget | null
  lockScroll?: boolean
  mode?: IslandFollowUpMode
  onRequestEdit?: () => void
}

/**
 * Reusable Follow-up confirmation view for Island flows.
 *
 * - Uses multiline textarea input
 * - Esc cancels
 * - Cmd/Ctrl+Enter submits
 */
export function IslandFollowUpContentView({
  id,
  value,
  onValueChange,
  onCancel,
  onSubmit,
  onDelete,
  title = 'Follow up',
  placeholder = 'Add comments the agent should consider in the next turn…',
  submitLabel = 'Continue',
  editLabel = 'Edit',
  deleteLabel = 'Delete',
  maxInputHeight = 400,
  sendMessageKey = 'enter',
  morphFrom = null,
  lockScroll = false,
  mode = 'edit',
  onRequestEdit,
}: IslandFollowUpContentViewProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const measureTextareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const isViewMode = mode === 'view'
  const minInputHeight = isViewMode ? 20 : 44
  const [inputHeight, setInputHeight] = React.useState(minInputHeight)
  const [inputOverflow, setInputOverflow] = React.useState(false)

  React.useLayoutEffect(() => {
    const measure = measureTextareaRef.current
    if (!measure) return

    measure.value = value
    const measured = measure.scrollHeight
    const nextHeight = Math.min(Math.max(measured, minInputHeight), maxInputHeight)
    const nextOverflow = measured > maxInputHeight

    setInputHeight((prev) => (prev === nextHeight ? prev : nextHeight))
    setInputOverflow((prev) => (prev === nextOverflow ? prev : nextOverflow))
  }, [value, maxInputHeight, minInputHeight])

  React.useEffect(() => {
    if (isViewMode || typeof window === 'undefined') return

    const raf = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return

      textarea.focus()
      const cursor = textarea.value.length
      textarea.setSelectionRange(cursor, cursor)
    })

    return () => window.cancelAnimationFrame(raf)
  }, [isViewMode])

  return (
    <IslandContentView id={id} anchorX="center" anchorY="top" morphFrom={morphFrom} lockScroll={lockScroll}>
      <div className="w-[330px] px-3 pb-3 pt-3 space-y-2.5 select-none">
        <div className="flex items-center">
          <div className="pl-[4px] text-sm font-medium">{title}</div>
        </div>

        <div className="relative rounded-[8px] px-0 py-1">
          <textarea
            ref={measureTextareaRef}
            aria-hidden="true"
            tabIndex={-1}
            readOnly
            rows={isViewMode ? 1 : 2}
            value={value}
            className="pointer-events-none absolute left-0 right-0 top-1 resize-none overflow-hidden bg-transparent text-sm leading-5 opacity-0 pl-[4px]"
          />

          <textarea
            ref={textareaRef}
            value={value}
            readOnly={isViewMode}
            tabIndex={isViewMode ? -1 : 0}
            onChange={(event) => {
              if (isViewMode) return
              onValueChange(event.target.value)
            }}
            onKeyDown={(event) => {
              if (isViewMode) return

              if (event.key === 'Escape') {
                event.preventDefault()
                onCancel()
                return
              }

              if (event.nativeEvent.isComposing) return

              if (sendMessageKey === 'enter') {
                if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault()
                  onSubmit(value)
                  return
                }

                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  onSubmit(value)
                }

                return
              }

              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                onSubmit(value)
              }
            }}
            placeholder={placeholder}
            rows={isViewMode ? 1 : 2}
            style={{ height: inputHeight, overflowY: inputOverflow ? 'auto' : 'hidden' }}
            className="relative w-full resize-none bg-transparent outline-none text-sm leading-5 select-text pl-[4px]"
          />
        </div>

        <div className="flex justify-between items-center pt-1 shrink-0">
          <div>
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="h-8 px-3 rounded-[8px] text-sm bg-background shadow-minimal text-red-500 inline-flex items-center cursor-pointer hover:bg-foreground/2"
              >
                {deleteLabel}
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-8 px-3 rounded-[8px] text-sm text-foreground/75 hover:bg-foreground/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (isViewMode) {
                  onRequestEdit?.()
                  return
                }

                onSubmit(value)
              }}
              className="h-8 px-3 rounded-[8px] text-sm bg-background shadow-minimal text-foreground inline-flex items-center cursor-pointer hover:bg-foreground/2"
            >
              {isViewMode ? editLabel : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </IslandContentView>
  )
}
