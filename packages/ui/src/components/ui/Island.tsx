import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '../../lib/utils'

export type AnchorX = 'left' | 'center' | 'right'
export type AnchorY = 'top' | 'center' | 'bottom'

export type IslandMorphTarget = {
  x: number
  y: number
  width?: number
  height?: number
}

export interface IslandContentViewProps {
  id: string
  anchorX?: AnchorX
  anchorY?: AnchorY
  className?: string
  morphFrom?: IslandMorphTarget | null
  /** Locks document scrolling while this view is active and visible (dialog-like behavior). */
  lockScroll?: boolean
  children: React.ReactNode
}

/**
 * Marker component for Island child views.
 *
 * Usage:
 * <Island activeViewId="compact">
 *   <IslandContentView id="compact">...</IslandContentView>
 *   <IslandContentView id="confirm">...</IslandContentView>
 * </Island>
 */
export function IslandContentView({ children }: IslandContentViewProps) {
  return <>{children}</>
}
IslandContentView.displayName = 'IslandContentView'

export interface IslandTransitionConfig {
  /** Master duration used by both shell and content animations */
  duration?: number
  /** Spring bounce for the shell layout animation */
  bounce?: number
  /** Enter/exit blur radius in px for content crossfade */
  blurPx?: number
  /** Direction in degrees for directional enter/exit offset (0 = from right, 90 = from bottom). */
  entryAngleDeg?: number
  /** Directional travel distance in pixels for enter/exit offset. */
  entryDistancePx?: number
  /** Start scale used when no morph target scale is available. */
  entryStartScale?: number
}

export interface IslandActiveViewSize {
  id: string
  width: number
  height: number
}

export interface IslandProps {
  activeViewId: string
  children: React.ReactNode
  className?: string
  radius?: number
  transitionConfig?: IslandTransitionConfig
  onActiveViewSizeChange?: (size: IslandActiveViewSize) => void
  /** Controls shell presence animation. Defaults to true for backward compatibility. */
  isVisible?: boolean
  /** Called after hide animation settles. Parent can unmount safely here. */
  onExitComplete?: () => void
  /** Calls onRequestClose when pointer-down happens outside the island shell while visible. */
  dismissOnPointerDownOutside?: boolean
  /** Consumer callback for close/dismiss requests (outside tap, future escape key support, etc.). */
  onRequestClose?: () => void
  /** Locks document scrolling while the island is visible, regardless of active view-level lockScroll flags. */
  lockScrollWhileVisible?: boolean
}

const DEFAULT_TRANSITION: Required<IslandTransitionConfig> = {
  duration: 0.4,
  bounce: 0.2,
  blurPx: 7,
  entryAngleDeg: 0,
  entryDistancePx: 0,
  entryStartScale: 0.25,
}

const IslandAnimationContext = React.createContext<Required<IslandTransitionConfig>>(DEFAULT_TRANSITION)

export function useIslandAnimationConfig(): Required<IslandTransitionConfig> {
  return React.useContext(IslandAnimationContext)
}

const CONTENT_EASE = [0.2, 0.8, 0.2, 1] as const

let bodyScrollLockCount = 0
let previousBodyOverflow: string | null = null
let previousBodyTouchAction: string | null = null

function acquireBodyScrollLock(): void {
  if (typeof document === 'undefined') return

  if (bodyScrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow
    previousBodyTouchAction = document.body.style.touchAction
    document.body.style.overflow = 'hidden'
    document.body.style.touchAction = 'none'
  }

  bodyScrollLockCount += 1
}

function releaseBodyScrollLock(): void {
  if (typeof document === 'undefined' || bodyScrollLockCount <= 0) return

  bodyScrollLockCount -= 1

  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow ?? ''
    document.body.style.touchAction = previousBodyTouchAction ?? ''
    previousBodyOverflow = null
    previousBodyTouchAction = null
  }
}

function resolveAlignClass(anchorX: AnchorX = 'center', anchorY: AnchorY = 'top'): string {
  const x = anchorX === 'left' ? 'justify-start' : anchorX === 'right' ? 'justify-end' : 'justify-center'
  const y = anchorY === 'top' ? 'items-start' : anchorY === 'bottom' ? 'items-end' : 'items-center'
  return `${x} ${y}`
}

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0.06, Math.min(4, value))
}

function computeDirectionalOffset(angleDeg: number, distancePx: number): { x: number; y: number } {
  if (!Number.isFinite(distancePx) || distancePx === 0) return { x: 0, y: 0 }

  const angleRad = (Number.isFinite(angleDeg) ? angleDeg : 0) * (Math.PI / 180)
  return {
    x: Math.cos(angleRad) * distancePx,
    y: Math.sin(angleRad) * distancePx,
  }
}

function computeMorphDelta(
  elementRect: DOMRect,
  target: IslandMorphTarget,
  elementLayoutWidth: number,
  elementLayoutHeight: number,
): {
  x: number
  y: number
  scaleX: number
  scaleY: number
} {
  const elementCenterX = elementRect.left + elementRect.width / 2
  const elementCenterY = elementRect.top + elementRect.height / 2
  const targetWidth = target.width ?? 1
  const targetHeight = target.height ?? 1
  const targetCenterX = target.x + targetWidth / 2
  const targetCenterY = target.y + targetHeight / 2

  const baseWidth = elementLayoutWidth > 0 ? elementLayoutWidth : elementRect.width
  const baseHeight = elementLayoutHeight > 0 ? elementLayoutHeight : elementRect.height

  return {
    x: targetCenterX - elementCenterX,
    y: targetCenterY - elementCenterY,
    scaleX: clampScale(target.width != null && baseWidth > 0 ? target.width / baseWidth : 0.16),
    scaleY: clampScale(target.height != null && baseHeight > 0 ? target.height / baseHeight : 0.16),
  }
}

/**
 * Animated shell that morphs between registered IslandContentView children.
 *
 * - Outer shell: layout spring + optional morph from/to target
 * - Inner content: parallel enter/exit crossfade + blur
 */
export function Island({
  activeViewId,
  children,
  className,
  radius = 12,
  transitionConfig,
  onActiveViewSizeChange,
  isVisible = true,
  onExitComplete,
  dismissOnPointerDownOutside = false,
  onRequestClose,
}: IslandProps) {
  const shellRef = React.useRef<HTMLDivElement | null>(null)
  const activeViewRef = React.useRef<HTMLDivElement | null>(null)
  const lastSizeRef = React.useRef<{ id: string; width: number; height: number } | null>(null)
  const [isTransitionSettling, setIsTransitionSettling] = React.useState(true)
  const [morphDelta, setMorphDelta] = React.useState<{ x: number; y: number; scaleX: number; scaleY: number } | null>(null)
  const warmedViewIdsRef = React.useRef<Set<string>>(new Set())
  const [isMorphWarmReady, setIsMorphWarmReady] = React.useState(true)
  const hasRenderedVisibleRef = React.useRef<boolean>(false)
  const spawnHiddenPoseRef = React.useRef<{ opacity: number; x: number; y: number; scaleX: number; scaleY: number } | null>(null)
  const prevIsVisibleRef = React.useRef<boolean>(isVisible)
  const cfg = React.useMemo(
    () => ({ ...DEFAULT_TRANSITION, ...(transitionConfig ?? {}) }),
    [transitionConfig]
  )

  const layoutTransition = React.useMemo(
    () => ({ type: 'spring' as const, duration: cfg.duration, bounce: cfg.bounce }),
    [cfg.duration, cfg.bounce]
  )

  const contentTransition = React.useMemo(
    () => ({ duration: cfg.duration, ease: CONTENT_EASE }),
    [cfg.duration]
  )

  type ResolvedView = {
    id: string
    anchorX?: AnchorX
    anchorY?: AnchorY
    className?: string
    morphFrom?: IslandMorphTarget | null
    lockScroll?: boolean
    node: React.ReactNode
  }

  const contentViews = React.useMemo(() => {
    const entries: ResolvedView[] = []

    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return

      // Primary path: explicit IslandContentView marker component
      if (child.type === IslandContentView) {
        const props = child.props as IslandContentViewProps
        entries.push({
          id: props.id,
          anchorX: props.anchorX,
          anchorY: props.anchorY,
          className: props.className,
          morphFrom: props.morphFrom,
          lockScroll: props.lockScroll,
          node: props.children,
        })
        return
      }

      // Flexible path: wrapped view components pass id/anchor props and render their own content.
      const props = child.props as Partial<IslandContentViewProps>
      if (typeof props.id === 'string') {
        entries.push({
          id: props.id,
          anchorX: props.anchorX,
          anchorY: props.anchorY,
          className: props.className,
          morphFrom: props.morphFrom,
          lockScroll: props.lockScroll,
          node: child,
        })
      }
    })

    return entries
  }, [children])

  const activeView = React.useMemo(
    () => contentViews.find((v) => v.id === activeViewId) ?? contentViews[0],
    [contentViews, activeViewId]
  )

  const shouldMorph = Boolean(activeView?.morphFrom)

  React.useLayoutEffect(() => {
    const target = activeView?.morphFrom
    const shell = shellRef.current

    if (!target || !shell) {
      setMorphDelta(null)
      return
    }

    const rect = shell.getBoundingClientRect()
    const layoutWidth = shell.offsetWidth
    const layoutHeight = shell.offsetHeight

    // Keep last valid delta during transient zero-size frames (mount/layout handoff).
    // This keeps enter/exit symmetry instead of collapsing to fallback scale only on show.
    if (rect.width <= 0 || rect.height <= 0 || layoutWidth <= 0 || layoutHeight <= 0) {
      return
    }

    setMorphDelta(computeMorphDelta(rect, target, layoutWidth, layoutHeight))
  }, [
    activeView?.id,
    activeView?.morphFrom?.x,
    activeView?.morphFrom?.y,
    activeView?.morphFrom?.width,
    activeView?.morphFrom?.height,
  ])

  React.useEffect(() => {
    if (!activeView) {
      setIsMorphWarmReady(true)
      return
    }

    if (!shouldMorph) {
      setIsMorphWarmReady(true)
      warmedViewIdsRef.current.add(activeView.id)
      return
    }

    if (!isVisible) {
      setIsMorphWarmReady(false)
      return
    }

    if (warmedViewIdsRef.current.has(activeView.id)) {
      setIsMorphWarmReady(true)
      return
    }

    if (!morphDelta) {
      setIsMorphWarmReady(false)
      return
    }

    if (typeof window === 'undefined') {
      warmedViewIdsRef.current.add(activeView.id)
      setIsMorphWarmReady(true)
      return
    }

    setIsMorphWarmReady(false)

    let raf1 = 0
    let raf2 = 0

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        warmedViewIdsRef.current.add(activeView.id)
        setIsMorphWarmReady(true)
      })
    })

    return () => {
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
    }
  }, [activeView, shouldMorph, isVisible, morphDelta])

  React.useEffect(() => {
    if (!activeView) return
    setIsTransitionSettling(true)
  }, [activeView?.id])

  React.useEffect(() => {
    if (!activeView?.lockScroll || !isVisible) return

    acquireBodyScrollLock()
    return () => {
      releaseBodyScrollLock()
    }
  }, [activeView?.id, activeView?.lockScroll, isVisible])

  React.useEffect(() => {
    if (!dismissOnPointerDownOutside || !isVisible || !onRequestClose) return
    if (typeof window === 'undefined') return

    const onPointerDown = (event: PointerEvent) => {
      const shell = shellRef.current
      const target = event.target as Node | null
      if (!shell || !target) return
      if (shell.contains(target)) return
      onRequestClose()
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [dismissOnPointerDownOutside, isVisible, onRequestClose])

  React.useEffect(() => {
    if (!isTransitionSettling) return

    if (typeof window === 'undefined') {
      setIsTransitionSettling(false)
      return
    }

    const timeout = window.setTimeout(() => {
      setIsTransitionSettling(false)
    }, Math.max(0, cfg.duration * 1000 + 80))

    return () => {
      window.clearTimeout(timeout)
    }
  }, [isTransitionSettling, cfg.duration])

  React.useEffect(() => {
    if (isVisible || !onExitComplete) return

    if (typeof window === 'undefined') {
      onExitComplete()
      return
    }

    const timeout = window.setTimeout(() => {
      onExitComplete()
    }, Math.max(120, cfg.duration * 1000 + 40))

    return () => {
      window.clearTimeout(timeout)
    }
  }, [isVisible, onExitComplete, cfg.duration])

  React.useEffect(() => {
    if (!activeView || !onActiveViewSizeChange) return

    const element = activeViewRef.current
    if (!element) return

    const emitIfChanged = () => {
      if (isTransitionSettling) return

      const rect = element.getBoundingClientRect()
      const next = {
        id: activeView.id,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }

      if (next.width <= 0 || next.height <= 0) return

      const prev = lastSizeRef.current
      if (prev && prev.id === next.id && prev.width === next.width && prev.height === next.height) return

      lastSizeRef.current = next
      onActiveViewSizeChange(next)
    }

    emitIfChanged()

    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      emitIfChanged()
    })

    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [activeView, onActiveViewSizeChange, isTransitionSettling])

  if (!activeView) return null

  const FALLBACK_HIDDEN_SCALE = clampScale(cfg.entryStartScale)
  const isPreShowWarmup = shouldMorph && isVisible && !isMorphWarmReady
  const directionalOffset = React.useMemo(
    () => computeDirectionalOffset(cfg.entryAngleDeg, cfg.entryDistancePx),
    [cfg.entryAngleDeg, cfg.entryDistancePx]
  )

  const hasUsableMorphDelta = React.useMemo(() => {
    if (!shouldMorph || !morphDelta) return false
    if (typeof window === 'undefined') return true

    // Guard against transiently bad frame calculations on first open.
    // If delta is implausibly large, prefer in-place scale morph for that frame.
    const maxX = window.innerWidth * 0.75
    const maxY = window.innerHeight * 0.75
    return Math.abs(morphDelta.x) <= maxX && Math.abs(morphDelta.y) <= maxY
  }, [shouldMorph, morphDelta])

  const hasEntryTranslation = Math.abs(cfg.entryDistancePx) > 0.0001
  const hasEntryScale = transitionConfig?.entryStartScale != null && Math.abs(cfg.entryStartScale - 1) > 0.0001
  const shouldAnimateFromHiddenOnMount = shouldMorph || hasEntryTranslation || hasEntryScale
  const shouldUseConfiguredStartScale = transitionConfig?.entryStartScale != null

  const hiddenPose = {
    opacity: 0,
    x: (hasUsableMorphDelta ? (morphDelta?.x ?? 0) : 0) + directionalOffset.x,
    y: (hasUsableMorphDelta ? (morphDelta?.y ?? 0) : 0) + directionalOffset.y,
    scaleX: (hasUsableMorphDelta && !shouldUseConfiguredStartScale)
      ? (morphDelta?.scaleX ?? FALLBACK_HIDDEN_SCALE)
      : FALLBACK_HIDDEN_SCALE,
    scaleY: (hasUsableMorphDelta && !shouldUseConfiguredStartScale)
      ? (morphDelta?.scaleY ?? FALLBACK_HIDDEN_SCALE)
      : FALLBACK_HIDDEN_SCALE,
  }

  const visiblePose = {
    opacity: 1,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
  }

  React.useEffect(() => {
    const isFirstVisibleFrame = isVisible && spawnHiddenPoseRef.current == null
    const becameVisible = !prevIsVisibleRef.current && isVisible
    if (isFirstVisibleFrame || becameVisible) {
      // Remember the original spawn rectangle/pose so hide can always animate back to it
      // even if content/view dimensions changed while the island was open.
      spawnHiddenPoseRef.current = { ...hiddenPose }
    }

    if (!isVisible) {
      // Keep last captured spawn pose for exit animation.
      prevIsVisibleRef.current = false
      return
    }

    prevIsVisibleRef.current = true
  }, [isVisible, hiddenPose])

  const shouldHideForWarmup = shouldMorph && isVisible && !isMorphWarmReady && !hasRenderedVisibleRef.current
  const effectiveVisible = isVisible && !shouldHideForWarmup
  const exitHiddenPose = spawnHiddenPoseRef.current ?? hiddenPose

  React.useEffect(() => {
    if (effectiveVisible) {
      hasRenderedVisibleRef.current = true
      return
    }

    if (!isVisible) {
      hasRenderedVisibleRef.current = false
    }
  }, [effectiveVisible, isVisible])

  const shellTransition = React.useMemo(
    () => (isPreShowWarmup
      ? ({ type: 'tween' as const, duration: 0 })
      : layoutTransition),
    [isPreShowWarmup, layoutTransition]
  )

  return (
    <IslandAnimationContext.Provider value={cfg}>
      <motion.div
        ref={shellRef}
        layout
        initial={shouldAnimateFromHiddenOnMount ? hiddenPose : false}
        animate={effectiveVisible ? visiblePose : exitHiddenPose}
        transition={shellTransition}
        style={{ borderRadius: radius, transformOrigin: '50% 50%' }}
        className={cn('mx-auto w-fit overflow-hidden border border-border/50 bg-background shadow-strong', className)}
      >
        <div className="relative">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={activeView.id}
              layout
              initial={{ opacity: 0, filter: `blur(${cfg.blurPx}px)` }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, filter: `blur(${cfg.blurPx}px)` }}
              transition={contentTransition}
              onAnimationComplete={() => setIsTransitionSettling(false)}
              onLayoutAnimationComplete={() => setIsTransitionSettling(false)}
            >
              <div
                ref={activeViewRef}
                className={cn('flex', resolveAlignClass(activeView.anchorX, activeView.anchorY), activeView.className)}
              >
                {activeView.node}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </IslandAnimationContext.Provider>
  )
}
