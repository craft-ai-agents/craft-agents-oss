/**
 * Tutorial Overlay
 *
 * Full-screen overlay with spotlight effect and positioned tooltip.
 * Renders when a tutorial is running and target element is found.
 *
 * Features:
 * - SVG mask for spotlight cutout (transparent area over target)
 * - Glow ring around spotlight
 * - Animated tooltip with arrow
 * - Click on spotlight executes underlying action and advances tutorial
 * - Visual feedback (green success animation) on step completion
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Check, Sparkles } from 'lucide-react'
import { useTutorial } from './TutorialContext'
import { cn } from '@/lib/utils'
import type { TooltipPosition } from './types'

/**
 * Spring animation preset for snappy UI
 */
const springTransition = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
  mass: 0.8,
}

/**
 * Circular progress indicator for auto-advance timer
 * Shows a reverse progress (countdown) animation
 */
function CircularProgress({
  duration,
  startedAt,
  size = 16,
}: {
  duration: number
  startedAt: number
  size?: number
}) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const updateProgress = () => {
      const elapsed = Date.now() - startedAt
      const newProgress = Math.min(elapsed / duration, 1)
      setProgress(newProgress)

      if (newProgress < 1) {
        requestAnimationFrame(updateProgress)
      }
    }

    const animationId = requestAnimationFrame(updateProgress)
    return () => cancelAnimationFrame(animationId)
  }, [duration, startedAt])

  const strokeWidth = 2
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  // Reverse progress: start full, end empty
  const strokeDashoffset = circumference * progress

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="transform -rotate-90"
    >
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-foreground/10"
      />
      {/* Progress circle (countdown) */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        className="text-accent transition-none"
      />
    </svg>
  )
}

/**
 * Calculate tooltip position styles based on target rect and desired position
 * Ensures tooltip stays within viewport bounds
 */
function getTooltipStyles(
  targetRect: DOMRect,
  position: TooltipPosition,
  padding: number
): React.CSSProperties {
  const gap = 16 // Space between spotlight and tooltip
  const tooltipWidth = 280
  const tooltipHeight = 160 // Approximate max height
  const viewportPadding = 16 // Minimum distance from viewport edges

  // Calculate spotlight bounds
  const spotlightLeft = targetRect.left - padding
  const spotlightTop = targetRect.top - padding
  const spotlightRight = targetRect.right + padding
  const spotlightBottom = targetRect.bottom + padding
  const spotlightCenterX = spotlightLeft + (spotlightRight - spotlightLeft) / 2
  const spotlightCenterY = spotlightTop + (spotlightBottom - spotlightTop) / 2

  // Clamp horizontal position to viewport
  const clampX = (x: number) => Math.min(
    Math.max(viewportPadding, x),
    window.innerWidth - tooltipWidth - viewportPadding
  )

  // Clamp vertical position to viewport
  const clampY = (y: number) => Math.min(
    Math.max(viewportPadding, y),
    window.innerHeight - tooltipHeight - viewportPadding
  )

  switch (position) {
    case 'top': {
      const desiredLeft = spotlightCenterX - tooltipWidth / 2
      const desiredBottom = window.innerHeight - spotlightTop + gap
      // Check if tooltip would overflow top of viewport
      const topPosition = spotlightTop - gap - tooltipHeight
      if (topPosition < viewportPadding) {
        // Flip to bottom if not enough space on top
        return {
          left: clampX(desiredLeft),
          top: clampY(spotlightBottom + gap),
        }
      }
      return {
        left: clampX(desiredLeft),
        bottom: Math.max(viewportPadding, desiredBottom),
      }
    }
    case 'bottom': {
      const desiredLeft = spotlightCenterX - tooltipWidth / 2
      const desiredTop = spotlightBottom + gap
      // Check if tooltip would overflow bottom of viewport
      if (desiredTop + tooltipHeight > window.innerHeight - viewportPadding) {
        // Flip to top if not enough space on bottom
        return {
          left: clampX(desiredLeft),
          bottom: Math.max(viewportPadding, window.innerHeight - spotlightTop + gap),
        }
      }
      return {
        left: clampX(desiredLeft),
        top: clampY(desiredTop),
      }
    }
    case 'left': {
      const desiredRight = window.innerWidth - spotlightLeft + gap
      const desiredTop = spotlightCenterY - 60
      // Check if tooltip would overflow left of viewport
      const leftPosition = spotlightLeft - gap - tooltipWidth
      if (leftPosition < viewportPadding) {
        // Flip to right if not enough space on left
        return {
          left: clampX(spotlightRight + gap),
          top: clampY(desiredTop),
        }
      }
      return {
        right: Math.max(viewportPadding, desiredRight),
        top: clampY(desiredTop),
      }
    }
    case 'right': {
      const desiredLeft = spotlightRight + gap
      const desiredTop = spotlightCenterY - 60
      // Check if tooltip would overflow right of viewport
      if (desiredLeft + tooltipWidth > window.innerWidth - viewportPadding) {
        // Flip to left if not enough space on right
        return {
          right: Math.max(viewportPadding, window.innerWidth - spotlightLeft + gap),
          top: clampY(desiredTop),
        }
      }
      return {
        left: clampX(desiredLeft),
        top: clampY(desiredTop),
      }
    }
    case 'center':
    default:
      return {
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
      }
  }
}

/**
 * Arrow component pointing from tooltip to target
 */
function TooltipArrow({ position }: { position: TooltipPosition }) {
  const arrowClasses = cn(
    'absolute w-3 h-3 bg-background border border-border/50 rotate-45',
    position === 'top' && 'bottom-[-7px] left-1/2 -translate-x-1/2 border-t-0 border-l-0',
    position === 'bottom' && 'top-[-7px] left-1/2 -translate-x-1/2 border-b-0 border-r-0',
    position === 'left' && 'right-[-7px] top-1/2 -translate-y-1/2 border-l-0 border-b-0',
    position === 'right' && 'left-[-7px] top-1/2 -translate-y-1/2 border-r-0 border-t-0'
  )

  if (position === 'center') return null

  return <div className={arrowClasses} />
}

/**
 * Cool green success animation shown when step completes
 */
function SuccessAnimation({
  x,
  y,
  width,
  height,
  radius,
  onComplete,
}: {
  x: number
  y: number
  width: number
  height: number
  radius: number
  onComplete: () => void
}) {
  const centerX = x + width / 2
  const centerY = y + height / 2

  return (
    <>
      {/* Expanding ring effect */}
      <motion.div
        className="absolute pointer-events-none border-2 border-emerald-400"
        style={{
          left: x,
          top: y,
          width,
          height,
          borderRadius: radius,
        }}
        initial={{ scale: 1, opacity: 1 }}
        animate={{ scale: 1.3, opacity: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />

      {/* Second ring with delay */}
      <motion.div
        className="absolute pointer-events-none border border-emerald-300"
        style={{
          left: x,
          top: y,
          width,
          height,
          borderRadius: radius,
        }}
        initial={{ scale: 1, opacity: 0.8 }}
        animate={{ scale: 1.5, opacity: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
      />

      {/* Glowing background */}
      <motion.div
        className="absolute pointer-events-none"
        style={{
          left: x,
          top: y,
          width,
          height,
          borderRadius: radius,
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.3) 0%, rgba(52, 211, 153, 0.2) 100%)',
          boxShadow: '0 0 40px rgba(16, 185, 129, 0.5), inset 0 0 20px rgba(52, 211, 153, 0.3)',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0] }}
        transition={{ duration: 0.5, times: [0, 0.3, 1] }}
        onAnimationComplete={onComplete}
      />

      {/* Center checkmark with particles */}
      <motion.div
        className="absolute pointer-events-none"
        style={{
          left: centerX - 24,
          top: centerY - 24,
          width: 48,
          height: 48,
        }}
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      >
        <div className="w-full h-full rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/50">
          <Check className="w-6 h-6 text-white" strokeWidth={3} />
        </div>
      </motion.div>

      {/* Sparkle particles */}
      {[...Array(6)].map((_, i) => {
        const angle = (i / 6) * Math.PI * 2
        const distance = 50
        const endX = Math.cos(angle) * distance
        const endY = Math.sin(angle) * distance

        return (
          <motion.div
            key={i}
            className="absolute pointer-events-none"
            style={{
              left: centerX - 6,
              top: centerY - 6,
              width: 12,
              height: 12,
            }}
            initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
            animate={{
              x: endX,
              y: endY,
              scale: [0, 1, 0],
              opacity: [1, 1, 0]
            }}
            transition={{
              duration: 0.5,
              delay: 0.1 + i * 0.03,
              ease: 'easeOut'
            }}
          >
            <Sparkles className="w-3 h-3 text-emerald-400" />
          </motion.div>
        )
      })}
    </>
  )
}

export function TutorialOverlay() {
  const { state, currentStep, currentTutorial, completeStep, skipTutorial } = useTutorial()
  const [showSuccess, setShowSuccess] = useState(false)
  const [successPosition, setSuccessPosition] = useState<{
    x: number
    y: number
    width: number
    height: number
    radius: number
  } | null>(null)

  // Track if we're in the middle of handling a click to prevent double triggers
  const isHandlingClickRef = useRef(false)
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Store current values in refs for stable click handler
  // This prevents the click listener from being recreated on every targetRect change
  const currentStepRef = useRef(currentStep)
  const targetRectRef = useRef(state.targetRect)
  const showSuccessRef = useRef(showSuccess)
  const completeStepRef = useRef(completeStep)

  // Keep refs in sync
  useEffect(() => {
    currentStepRef.current = currentStep
    targetRectRef.current = state.targetRect
    showSuccessRef.current = showSuccess
    completeStepRef.current = completeStep
  })

  // Reset animation state when step changes
  useEffect(() => {
    setShowSuccess(false)
    setSuccessPosition(null)
    isHandlingClickRef.current = false
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current)
      animationTimeoutRef.current = null
    }
  }, [currentStep?.id])

  /**
   * Trigger step completion with animation
   * Called when target element is clicked (for 'click' completion events)
   *
   * IMPORTANT: Uses refs to access current values, making this callback stable
   * and preventing the click listener from being recreated on every render.
   *
   * Uses requestAnimationFrame to delay animation until after the click event
   * has fully propagated. This ensures cmdk/Radix UI components process the
   * click before we change React state.
   */
  const triggerStepCompletion = useCallback(() => {
    const step = currentStepRef.current
    const rect = targetRectRef.current

    if (!step || !rect) return
    if (showSuccessRef.current || isHandlingClickRef.current) return // Prevent double triggers

    isHandlingClickRef.current = true
    console.log('[Tutorial] Target clicked for step:', step.id)

    const padding = step.spotlightPadding ?? 8
    const radius = step.spotlightRadius ?? 8

    // Store position for success animation
    const animationPosition = {
      x: rect.left - padding,
      y: rect.top - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
      radius,
    }

    // Delay animation to let the click event fully propagate first
    // This ensures cmdk/Radix UI components process the click before we change React state
    requestAnimationFrame(() => {
      // Show success animation
      setSuccessPosition(animationPosition)
      setShowSuccess(true)

      // After animation duration, complete step
      const ANIMATION_DURATION = 400
      animationTimeoutRef.current = setTimeout(() => {
        console.log('[Tutorial] Animation complete - advancing step:', step.id)
        completeStepRef.current()
        isHandlingClickRef.current = false
        animationTimeoutRef.current = null
      }, ANIMATION_DURATION)
    })
  }, []) // Empty deps - uses refs for all values

  /**
   * Listen for clicks anywhere on the document and check if they match our target
   *
   * This approach is more robust than attaching listeners to specific elements because:
   * - Works with React's synthetic event system
   * - Catches clicks on dynamically rendered elements (portals, dropdowns)
   * - Doesn't require the element to exist when we set up the listener
   *
   * Note: triggerStepCompletion is stable (empty deps) so this effect only re-runs
   * when step or status changes, not on every targetRect update.
   */
  useEffect(() => {
    if (state.status !== 'running' || !currentStep) return
    if (currentStep.completionEvent !== 'click') return
    if (currentStep.nextButton) return // nextButton steps don't use click detection

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target) return

      // Check if the clicked element or any of its ancestors matches our selector
      const matchingElement = target.closest(currentStep.target)
      if (matchingElement) {
        console.log('[Tutorial] Detected click on target:', currentStep.target, 'element:', matchingElement)
        triggerStepCompletion()
      }
    }

    // Use capture phase to catch the event before it might be stopped
    document.addEventListener('click', handleDocumentClick, { capture: true })
    console.log('[Tutorial] Document click listener attached for:', currentStep.target)

    return () => {
      document.removeEventListener('click', handleDocumentClick, { capture: true })
    }
  }, [currentStep, state.status, triggerStepCompletion])

  /**
   * Handle click on the "next" button in tooltip
   * Just advances the step without clicking the target
   * Uses refs for stability (same pattern as triggerStepCompletion)
   */
  const handleNextButtonClick = useCallback(() => {
    const step = currentStepRef.current
    const rect = targetRectRef.current

    if (!step || !rect) return
    if (showSuccessRef.current || isHandlingClickRef.current) return

    isHandlingClickRef.current = true
    console.log('[Tutorial] Next button clicked for step:', step.id)

    const padding = step.spotlightPadding ?? 8
    const radius = step.spotlightRadius ?? 8

    // Store position for success animation
    setSuccessPosition({
      x: rect.left - padding,
      y: rect.top - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
      radius,
    })

    // Show success animation
    setShowSuccess(true)

    // After animation duration, complete step
    const ANIMATION_DURATION = 400
    animationTimeoutRef.current = setTimeout(() => {
      console.log('[Tutorial] Next button animation complete - advancing step:', step.id)
      completeStepRef.current()
      isHandlingClickRef.current = false
      animationTimeoutRef.current = null
    }, ANIMATION_DURATION)
  }, []) // Empty deps - uses refs for all values

  /**
   * Called when success animation completes visually
   * Step progression already happened via setTimeout, this just cleans up visual state
   */
  const handleSuccessComplete = useCallback(() => {
    // Only reset if we're still showing success (might have been reset by step change)
    if (showSuccessRef.current) {
      setShowSuccess(false)
      setSuccessPosition(null)
    }
  }, []) // Empty deps - uses ref

  // Only render when running and we have a target
  if (state.status !== 'running' || !currentStep || !state.targetRect) {
    return null
  }

  const { targetRect } = state
  const padding = currentStep.spotlightPadding ?? 8
  const radius = currentStep.spotlightRadius ?? 8

  // Calculate spotlight dimensions
  const spotlightX = targetRect.left - padding
  const spotlightY = targetRect.top - padding
  const spotlightWidth = targetRect.width + padding * 2
  const spotlightHeight = targetRect.height + padding * 2

  // Calculate tooltip position
  const tooltipStyles = getTooltipStyles(targetRect, currentStep.position, padding)

  return (
    <AnimatePresence mode="wait">
      <div key={currentStep.id} className="fixed inset-0 z-[9998] pointer-events-none">
        {/* Backdrop with spotlight cutout - visual only, no click blocking */}
        <motion.svg
          className="absolute inset-0 w-full h-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <defs>
            <mask id="tutorial-spotlight-mask">
              {/* White = visible backdrop */}
              <rect width="100%" height="100%" fill="white" />
              {/* Black = transparent spotlight area */}
              <rect
                x={spotlightX}
                y={spotlightY}
                width={spotlightWidth}
                height={spotlightHeight}
                rx={radius}
                fill="black"
              />
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.7)"
            mask="url(#tutorial-spotlight-mask)"
          />
        </motion.svg>

        {/* Spotlight glow ring */}
        {!showSuccess && (
          <motion.div
            className="absolute pointer-events-none border-2 border-accent/60 shadow-[0_0_24px_rgba(var(--accent-rgb,99,102,241),0.4)]"
            style={{
              left: spotlightX,
              top: spotlightY,
              width: spotlightWidth,
              height: spotlightHeight,
              borderRadius: radius,
            }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={springTransition}
          />
        )}

        {/* Success animation */}
        {showSuccess && successPosition && (
          <SuccessAnimation
            x={successPosition.x}
            y={successPosition.y}
            width={successPosition.width}
            height={successPosition.height}
            radius={successPosition.radius}
            onComplete={handleSuccessComplete}
          />
        )}

        {/* Tooltip */}
        {!showSuccess && (
          <motion.div
            className="absolute pointer-events-auto"
            style={tooltipStyles}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ ...springTransition, delay: 0.1 }}
          >
            <div className="relative bg-background/95 backdrop-blur-xl border border-border/50 rounded-lg shadow-xl p-4 w-[280px]">
              {/* Arrow */}
              {currentStep.showArrow && <TooltipArrow position={currentStep.position} />}

              {/* Content */}
              <h3 className="font-semibold text-sm mb-1.5">{currentStep.title}</h3>
              <p className="text-sm text-foreground/70 mb-3 leading-relaxed whitespace-pre-line">
                {currentStep.description}
              </p>

              {/* Next button (when configured) */}
              {currentStep.nextButton && (
                <button
                  onClick={handleNextButtonClick}
                  className="w-full mb-3 px-3 py-2 text-sm font-medium rounded-md bg-accent text-accent-foreground hover:bg-accent/90 transition-colors"
                >
                  {currentStep.nextButton}
                </button>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between">
                <button
                  onClick={skipTutorial}
                  className="text-xs text-foreground/40 hover:text-foreground/60 transition-colors"
                >
                  Skip tutorial
                </button>
                <div className="flex items-center gap-2">
                  {/* Circular countdown timer when auto-advancing */}
                  {state.autoAdvanceTimer && (
                    <CircularProgress
                      duration={state.autoAdvanceTimer.duration}
                      startedAt={state.autoAdvanceTimer.startedAt}
                      size={14}
                    />
                  )}
                  {/* Step dots */}
                  <div className="flex items-center gap-1.5">
                    {currentTutorial?.steps.map((_, index) => (
                      <div
                        key={index}
                        className={cn(
                          'w-1.5 h-1.5 rounded-full transition-colors',
                          index === state.currentStepIndex
                            ? 'bg-accent'
                            : index < state.currentStepIndex
                              ? 'bg-emerald-500'
                              : 'bg-foreground/10'
                        )}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Spotlight area - pointer-events: none so clicks pass through to actual elements */}
        {!showSuccess && (
          <motion.div
            className="absolute pointer-events-none"
            style={{
              left: spotlightX,
              top: spotlightY,
              width: spotlightWidth,
              height: spotlightHeight,
              borderRadius: radius,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </div>
    </AnimatePresence>
  )
}
