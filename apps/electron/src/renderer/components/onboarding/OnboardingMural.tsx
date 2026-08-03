import { useMemo, useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence, useMotionValue, useSpring } from 'motion/react'
import { AnimatedARCHstudioSymbol } from '@/components/icons/AnimatedARCHstudioSymbol'
import './OnboardingMural.css'

// ─── Types ──────────────────────────────────────────────────────────────

export type MuralScene =
  | 'welcome'
  | 'git-bash'
  | 'provider-select'
  | 'credentials'
  | 'local-model'
  | 'complete'

export interface MuralJourneyStep {
  scene: MuralScene
  label: string
}

const DEFAULT_JOURNEY: MuralJourneyStep[] = [
  { scene: 'welcome', label: 'Welcome' },
  { scene: 'provider-select', label: 'Provider' },
  { scene: 'credentials', label: 'Connect' },
  { scene: 'complete', label: 'Done' },
]

// ─── Ambient particles ──────────────────────────────────────────────────

interface Particle {
  id: number
  x: number
  y: number
  size: number
  duration: number
  delay: number
  opacity: number
  /** Horizontal drift direction: -1 (left) or +1 (right) */
  driftDir: number
}

function useMuralParticles(count: number): Particle[] {
  return useMemo(() => {
    const p: Particle[] = []
    for (let i = 0; i < count; i++) {
      p.push({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.max(1.5, Math.random() * 2.5),
        duration: 14 + Math.random() * 18,
        delay: Math.random() * 16,
        opacity: 0.06 + Math.random() * 0.12,
        // Compute once in factory, not in JSX on every render
        driftDir: Math.random() > 0.5 ? 1 : -1,
      })
    }
    return p
  }, [count])
}

// ─── Mouse parallax ─────────────────────────────────────────────────────

const PARALLAX_RANGE = 10 // max px shift at full deflection

/**
 * Tracks mouse position and exposes smooth spring-animated motion values
 * for x/y offset. Updates are decoupled from React render — the spring
 * interpolates smoothly on the compositor thread.
 */
function useParallaxSpring() {
  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)
  // Soft spring — gentle follow, no bounce
  const springX = useSpring(rawX, { stiffness: 120, damping: 22 })
  const springY = useSpring(rawY, { stiffness: 120, damping: 22 })
  const rafRef = useRef<number>(0)

  const handleMouse = useCallback((e: MouseEvent) => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        const w = window.innerWidth
        const h = window.innerHeight
        // Normalize to [-1, 1] — centered origin, scaled by range
        rawX.set(((e.clientX / w) - 0.5) * 2 * PARALLAX_RANGE)
        rawY.set(((e.clientY / h) - 0.5) * 2 * PARALLAX_RANGE)
        rafRef.current = 0
      })
    }
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouse, { passive: true })
    return () => {
      window.removeEventListener('mousemove', handleMouse)
      cancelAnimationFrame(rafRef.current)
    }
  }, [handleMouse])

  return { x: springX, y: springY }
}

const sceneOrder: MuralScene[] = [
  'welcome',
  'git-bash',
  'provider-select',
  'credentials',
  'local-model',
  'complete',
]

function isStepDone(
  currentScene: MuralScene,
  journeyStep: MuralScene,
): boolean {
  return sceneOrder.indexOf(currentScene) > sceneOrder.indexOf(journeyStep)
}

function isStepActive(
  currentScene: MuralScene,
  journeyStep: MuralScene,
): boolean {
  return currentScene === journeyStep
}

// ─── Component ──────────────────────────────────────────────────────────

interface OnboardingMuralProps {
  /** Current scene identifier */
  scene: MuralScene
  /** Global scene key — changes trigger AnimatePresence exit/enter */
  sceneKey?: string
  /** Custom journey steps (defaults to: Welcome → Provider → Connect → Done) */
  journey?: MuralJourneyStep[]
  /** Scene content */
  children: React.ReactNode
  /** Additional class name */
  className?: string
}

export function OnboardingMural({
  scene,
  sceneKey,
  journey = DEFAULT_JOURNEY,
  children,
  className,
}: OnboardingMuralProps) {
  const isWelcomeScene = scene === 'welcome'
  // Use fewer particles on constrained hardware; 12 is indistinguishable from 16
  // at the mural's scale and reduces DOM nodes + compositor layer count by 25%.
  const particleCount = 12
  const particles = useMuralParticles(particleCount)
  const parallax = useParallaxSpring()
  const [showStage, setShowStage] = useState(false)

  // Stagger the stage reveal so the gradient breathes first
  useEffect(() => {
    const t = setTimeout(() => setShowStage(true), 120)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className={className ? `onboarding-mural ${className}` : 'onboarding-mural'}>
      {/* ── Brand glow ────────────────────────────────────────────── */}
      <div className="onboarding-mural__glow" />

      {/* ── Light ray ─────────────────────────────────────────────── */}
      <div className="onboarding-mural__light-ray" />

      {/* ── Ambient particles ─────────────────────────────────────── */}
      <div className="onboarding-mural__particles">
        {/* Parallax wrapper — shifts the entire particle group via
            spring-animated motion values. The drift animation below
            stays independent and never restarts on mouse move. */}
        <motion.div
          style={{ x: parallax.x, y: parallax.y }}
          className="will-change-transform"
        >
          {particles.map(p => (
            <motion.div
              key={p.id}
              className="onboarding-mural__particle"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: p.size,
                height: p.size,
                opacity: p.opacity,
              }}
              animate={{
                y: [0, -30, 0],
                x: [0, p.driftDir * 4, 0],
              }}
              transition={{
                duration: p.duration,
                repeat: Infinity,
                delay: p.delay,
                ease: 'easeInOut',
              }}
            />
          ))}
        </motion.div>
      </div>

      {/* ── Journey indicator bar ─────────────────────────────────── */}
      <motion.div
        className="onboarding-mural__journey"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        {journey.map((step, i) => {
          const active = isStepActive(scene, step.scene)
          const done = isStepDone(scene, step.scene)
          const last = i === journey.length - 1
          return (
            <div key={step.scene} className="onboarding-mural__step-dot-wrapper" style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <div
                className={`onboarding-mural__step-dot${active ? ' onboarding-mural__step-dot--active' : ''}${done ? ' onboarding-mural__step-dot--done' : ''}`}
              >
                <div className="onboarding-mural__step-dot-circle" />
                <span className="onboarding-mural__step-dot-label">{step.label}</span>
              </div>
              {!last && (
                <div className={`onboarding-mural__step-connector${active || done ? ' onboarding-mural__step-connector--active' : ''}`} />
              )}
            </div>
          )
        })}
      </motion.div>

      {/* ── Content stage ─────────────────────────────────────────── */}
      <div className="onboarding-mural__stage">
        {/* Emblem badge — only on welcome scene to avoid double-branding */}
        {isWelcomeScene && (
          <motion.div
            className="onboarding-mural__emblem"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: showStage ? 1 : 0, scale: showStage ? 1 : 0.9 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <AnimatedARCHstudioSymbol className="h-12 w-12" />
          </motion.div>
        )}

        {/* Animated scene transitions */}
        <div className="onboarding-mural__glass">
          <AnimatePresence mode="wait">
            <motion.div
              key={sceneKey ?? scene}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
