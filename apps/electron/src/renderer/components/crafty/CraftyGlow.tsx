import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PulsingBorder } from '@paper-design/shaders-react'
import { DURATION, prefersReducedMotion } from '@craft-agent/ui/motion'
import { isCraftyTarget, useCraftyTarget } from '@/hooks/useCraftyTarget'
import { craftyGlowColors } from './glow-colors'

/**
 * `CraftyGlow`'s props for a composer. `active`: its session is Crafty's target, so the glow stays
 * until Crafty is sent elsewhere or stopped. `playKey`: a new value each time the session becomes
 * the target while it shows, which plays the glow moving; not for main's first answer, and not for
 * opening a session that already is the target (that one just shows the glow).
 */
export function useCraftyGlow(sessionId: string | undefined, workspaceId: string | undefined): { active: boolean; playKey: number } {
  const { loaded, target } = useCraftyTarget()
  const isTarget = isCraftyTarget(target, workspaceId, sessionId)
  const [playKey, setPlayKey] = useState(0)
  const last = useRef({ loaded, sessionId, isTarget })
  useEffect(() => {
    const previous = last.current
    last.current = { loaded, sessionId, isTarget }
    if (isTarget && !previous.isTarget && previous.loaded && previous.sessionId === sessionId) setPlayKey(key => key + 1)
  }, [isTarget, loaded, sessionId])
  return { active: loaded && isTarget, playKey }
}

/** How long the glow moves when a session becomes Crafty's target. */
const GLOW_MS = 2400
/** Ultrathink's speed. At 0 the shader stops its frame loop and draws only when a prop or its size changes. */
const SPEED = 0.96
/** The composer card's corner radius (`rounded-xl`). */
const CORNER_RADIUS = 12

interface GlowLook {
  colors: string[]
  roundness: number
}

/**
 * Ultrathink's pulsing border (the removed `UltrathinkGlow`, same shader and settings) over the
 * composer, in the theme accent's colors. Each new `playKey` plays it moving for GLOW_MS (0 never
 * plays; not under reduced motion). While `active` it then stays, still: a held glow draws only
 * when the card's size changes, so hours as Crafty's target cost nothing per frame, unlike
 * Ultrathink's steady glow. Without `active` it fades out once it has played. Colors are read when
 * it appears, so a theme switch shows the next time.
 */
export function CraftyGlow({ playKey, active = false }: { playKey: number; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [moving, setMoving] = useState(false)
  const [look, setLook] = useState<GlowLook | null>(null)
  const shown = active || moving

  useEffect(() => {
    if (!playKey || prefersReducedMotion()) return
    setMoving(true)
    const timer = window.setTimeout(() => setMoving(false), GLOW_MS)
    return () => window.clearTimeout(timer)
  }, [playKey])

  // Before paint, so it never shows another time's colors: the card's corners follow its size
  useLayoutEffect(() => {
    const box = ref.current?.parentElement
    if (!shown || !box) return
    const colors = craftyGlowColors(getComputedStyle(document.documentElement).getPropertyValue('--accent-raw'))
    const measure = () => {
      const { width, height } = box.getBoundingClientRect()
      const roundness = Math.round(Math.min(1, CORNER_RADIUS / (Math.max(1, Math.min(width, height)) / 2)) * 1000) / 1000
      setLook(previous => (previous?.colors === colors && previous.roundness === roundness ? previous : { colors, roundness }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [shown])

  return (
    <>
      {/* Marks where the card is, for the size; the glow itself mounts only while it shows */}
      <div ref={ref} hidden />
      <AnimatePresence>
        {shown && look && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.slow }}
          >
            <PulsingBorder
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              colors={look.colors}
              colorBack="#00000000"
              roundness={look.roundness}
              thickness={0.015}
              softness={0.5}
              intensity={0.15}
              bloom={0.15}
              spotSize={0.5}
              spots={4}
              pulse={0.2}
              smoke={0.2}
              smokeSize={0}
              speed={moving ? SPEED : 0}
              scale={1}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
