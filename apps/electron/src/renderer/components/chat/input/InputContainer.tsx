import * as React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { FreeFormInput, type FreeFormInputProps } from './FreeFormInput'
import { StructuredInput } from './StructuredInput'
import type { StructuredInputState, StructuredResponse, InputMode } from './structured/types'

interface InputContainerProps extends Omit<FreeFormInputProps, 'textareaRef'> {
  /** Structured input state - when present, shows structured UI instead of freeform */
  structuredInput?: StructuredInputState
  /** Callback when user responds to structured input */
  onStructuredResponse?: (response: StructuredResponse) => void
  /** External ref for the textarea (for focus control) */
  textareaRef?: React.RefObject<HTMLTextAreaElement>
}

// Animation timing - synced across height and opacity
const TRANSITION_DURATION = 0.25
const TRANSITION_EASE = [0.4, 0, 0.2, 1] as const

// Fallback heights (used on first render before measurement)
const FALLBACK_HEIGHTS: Record<InputMode | string, number> = {
  freeform: 120,
  permission: 200,
  clarification: 280,
  plan_review: 300,
}

/**
 * InputContainer - Main orchestrator for FreeFormInput and StructuredInput
 *
 * Animation approach:
 * - Uses a hidden measuring div to get the natural height of content
 * - Container animates to measured height
 * - Content crossfades inside using AnimatePresence mode="sync"
 * - All visible children use absolute positioning to stack during transition
 */
export function InputContainer({
  structuredInput,
  onStructuredResponse,
  textareaRef,
  ...freeFormProps
}: InputContainerProps) {
  const mode: InputMode = structuredInput ? 'structured' : 'freeform'
  const measureRef = React.useRef<HTMLDivElement>(null)
  const [measuredHeight, setMeasuredHeight] = React.useState<number | null>(null)
  const hasInitializedRef = React.useRef(false)

  // Create a stable key for the current content
  const contentKey = mode === 'freeform' ? 'freeform' : `structured-${structuredInput?.type}`

  // Use ResizeObserver to continuously watch content height
  React.useEffect(() => {
    const measureEl = measureRef.current
    if (!measureEl) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height
        if (height > 0) {
          setMeasuredHeight(height)
          // Mark as initialized after first measurement
          if (!hasInitializedRef.current) {
            requestAnimationFrame(() => {
              hasInitializedRef.current = true
            })
          }
        }
      }
    })

    observer.observe(measureEl)
    return () => observer.disconnect()
  }, [contentKey])

  // Use measured height, or fallback if not yet measured
  const targetHeight = React.useMemo(() => {
    if (measuredHeight !== null) return measuredHeight
    if (mode === 'freeform') return FALLBACK_HEIGHTS.freeform
    if (structuredInput?.type) return FALLBACK_HEIGHTS[structuredInput.type] ?? FALLBACK_HEIGHTS.freeform
    return FALLBACK_HEIGHTS.freeform
  }, [measuredHeight, mode, structuredInput?.type])

  const handleStructuredResponse = (response: StructuredResponse) => {
    onStructuredResponse?.(response)
  }

  // Render the current content (used for both measuring and display)
  const renderContent = (forMeasuring: boolean) => {
    if (mode === 'freeform') {
      return (
        <FreeFormInput
          {...freeFormProps}
          textareaRef={forMeasuring ? undefined : textareaRef}
          unstyled
        />
      )
    }
    return (
      <StructuredInput
        state={structuredInput!}
        onResponse={forMeasuring ? () => {} : handleStructuredResponse}
        unstyled
      />
    )
  }

  return (
    <div className="relative">
      {/* Hidden measuring div - renders content off-screen to measure natural height */}
      <div
        ref={measureRef}
        className="absolute top-0 left-0 right-0 invisible pointer-events-none"
        aria-hidden="true"
      >
        <div className="rounded-[8px] bg-background overflow-hidden">
          {renderContent(true)}
        </div>
      </div>

      {/* Visible animated container */}
      <motion.div
        className="relative rounded-[8px] bg-background shadow-middle overflow-hidden"
        initial={false}
        animate={{ height: targetHeight }}
        transition={{ duration: hasInitializedRef.current && measuredHeight !== null ? TRANSITION_DURATION : 0, ease: TRANSITION_EASE }}
      >
        {/* Crossfading content - all children absolute positioned */}
        <AnimatePresence mode="sync" initial={false}>
          <motion.div
            key={contentKey}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: TRANSITION_DURATION, ease: TRANSITION_EASE }}
          >
            {renderContent(false)}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
