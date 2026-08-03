import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import { motion, AnimatePresence, useReducedMotion } from "motion/react"
import * as React from "react"

// Radix primitives (unchanged)
const Collapsible = CollapsiblePrimitive.Root
const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger
const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent

// Spring config - snappy, no bounce
const springTransition = {
  type: "spring" as const,
  stiffness: 1400,
  damping: 75,
}

interface AnimatedCollapsibleContentProps {
  isOpen: boolean
  children: React.ReactNode
  className?: string
}

/**
 * AnimatedCollapsibleContent - Motion-powered collapsible content
 *
 * Uses spring physics to animate height (0 → auto) and opacity.
 * Motion handles height: "auto" natively, which CSS cannot do.
 */
function AnimatedCollapsibleContent({
  isOpen,
  children,
  className
}: AnimatedCollapsibleContentProps) {
  // Respect prefers-reduced-motion: collapse the spring to an instant
  // state change (AnimatePresence still mounts/unmounts, just without
  // animating). useReducedMotion updates reactively when the setting
  // changes, so this also works mid-session.
  const shouldReduceMotion = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : springTransition}
          className={className}
          style={{ clipPath: "inset(0 -20px)" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  AnimatedCollapsibleContent,
  springTransition,
}
