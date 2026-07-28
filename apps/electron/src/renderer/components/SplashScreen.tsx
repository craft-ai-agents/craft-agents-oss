import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatedARCHstudioSymbol } from './icons/AnimatedARCHstudioSymbol'

/**
 * Brand splash animation.
 *
 * NOTE: this is no longer part of the app boot path — the app renders its
 * workspace shell (or provider setup, when nothing is configured) directly.
 * The only remaining consumer is the dev playground's on-demand splash tester
 * (`src/renderer/playground.tsx`), which mounts it to review the animation.
 */
interface SplashScreenProps {
  isExiting: boolean
  onExitComplete?: () => void
}

// ─── Ambient particle — a single dot that drifts slowly upward ─────────

interface Particle {
  id: number
  x: number
  y: number
  size: number
  duration: number
  delay: number
  opacity: number
}

function useParticles(count: number): Particle[] {
  return useMemo(() => {
    const p: Particle[] = []
    for (let i = 0; i < count; i++) {
      p.push({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.max(1.5, Math.random() * 3),
        duration: 12 + Math.random() * 20,     // 12–32s drift cycle
        delay: Math.random() * 20,              // staggered start
        opacity: 0.08 + Math.random() * 0.18,   // 0.08–0.26
      })
    }
    return p
  }, [count])
}

// ─── Component ─────────────────────────────────────────────────────────

export function SplashScreen({
  isExiting,
  onExitComplete,
}: SplashScreenProps) {
  const [showContent, setShowContent] = useState(false)
  const particles = useParticles(32)
  const exitOverlayRef = useRef<HTMLDivElement>(null)

  // Stagger the content reveal so the background gradient breathes first
  useEffect(() => {
    const t = setTimeout(() => setShowContent(true), 180)
    return () => clearTimeout(t)
  }, [])

  return (
    <motion.div
      className="fixed inset-0 z-splash flex items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* ── Base: gradient canvas ───────────────────────────────────── */}
      <div className="absolute inset-0" style={{ background: 'var(--background)' }} />

      {/* ── Brand glow: warm light spilling from above ────────────── */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 70% 50% at 50% -10%,
              color-mix(in oklch, var(--brand-purple) 28%, transparent) 0%,
              color-mix(in oklch, var(--brand-lime) 8%, transparent) 40%,
              transparent 75%)
          `,
        }}
        animate={{
          opacity: isExiting ? 0 : [0.7, 1, 0.7],
        }}
        transition={{
          opacity: isExiting
            ? { duration: 0.5, ease: 'easeOut' }
            : { duration: 6, repeat: Infinity, ease: 'easeInOut' },
        }}
      />

      {/* ── Light ray: slow diagonal sweep (like cloud across skylight) ── */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            linear-gradient(
              135deg,
              transparent 30%,
              color-mix(in oklch, oklch(1 0 0) 4%, transparent) 50%,
              transparent 70%
            )
          `,
          backgroundSize: '200% 200%',
          backgroundPosition: '100% 100%',
        }}
        animate={
          isExiting
            ? { opacity: 0 }
            : {
                backgroundPosition: ['100% 100%', '-100% -100%'],
              }
        }
        transition={
          isExiting
            ? { duration: 0.4 }
            : { duration: 10, repeat: Infinity, ease: 'linear' }
        }
      />

      {/* ── Ambient particles ──────────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {particles.map((p) => (
          <motion.div
            key={p.id}
            className="absolute rounded-full"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
              background: 'var(--brand-purple)',
              opacity: p.opacity,
            }}
            animate={
              isExiting
                ? { opacity: 0 }
                : {
                    y: [0, -40, 0],
                    x: [0, Math.random() > 0.5 ? 6 : -6, 0],
                  }
            }
            transition={
              isExiting
                ? { duration: 0.3 }
                : {
                    duration: p.duration,
                    repeat: Infinity,
                    delay: p.delay,
                    ease: 'easeInOut',
                  }
            }
          />
        ))}
      </div>

      {/* ── Content stack ───────────────────────────────────────────── */}
      <motion.div
        className="relative z-10 flex flex-col items-center gap-6 select-none"
        initial={{ opacity: 0, y: 24 }}
        animate={{
          opacity: isExiting ? 0 : showContent ? 1 : 0,
          y: isExiting ? -20 : showContent ? 0 : 24,
          scale: isExiting ? 0.85 : 1,
        }}
        transition={{
          duration: isExiting ? 0.35 : 0.6,
          ease: isExiting
            ? [0.4, 0, 1, 1]
            : [0.16, 1, 0.3, 1],
        }}
      >
        {/* Emblem */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{
            scale: showContent ? 1 : 0.9,
            opacity: showContent ? 1 : 0,
          }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <AnimatedARCHstudioSymbol className="h-16 w-16" />
        </motion.div>

        {/* Wordmark */}
        <div className="text-center">
          <h1
            className="text-[28px] font-semibold tracking-tight leading-none"
            style={{
              background: 'var(--brand-gradient)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            ARCHstudio
          </h1>
        </div>

        {/* Subtitle: decorative rules framing the tagline */}
        <div className="flex items-center gap-3">
          <motion.div
            className="h-px w-8"
            style={{
              background: 'color-mix(in oklch, var(--foreground) 20%, transparent)',
              transformOrigin: 'right center',
            }}
            initial={{ scaleX: 0 }}
            animate={showContent ? { scaleX: 1 } : { scaleX: 0 }}
            transition={{ duration: 0.5, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
          />
          <motion.span
            className="text-[10px] font-semibold uppercase tracking-[0.22em]"
            style={{ color: 'color-mix(in oklch, var(--foreground) 40%, transparent)' }}
            initial={{ opacity: 0 }}
            animate={showContent ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.4, delay: 0.5 }}
          >
            Your Creative AI Studio
          </motion.span>
          <motion.div
            className="h-px w-8"
            style={{
              background: 'color-mix(in oklch, var(--foreground) 20%, transparent)',
              transformOrigin: 'left center',
            }}
            initial={{ scaleX: 0 }}
            animate={showContent ? { scaleX: 1 } : { scaleX: 0 }}
            transition={{ duration: 0.5, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>

        {/* Loading pulse dots */}
        <div className="mt-1 flex gap-2.5">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="rounded-full"
              style={{
                width: 6,
                height: 6,
                background: 'color-mix(in oklch, var(--brand-purple) 60%, transparent)',
              }}
              animate={
                isExiting
                  ? { opacity: 0 }
                  : {
                      opacity: [0.25, 0.9, 0.25],
                      scale: [1, 1.25, 1],
                    }
              }
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: i * 0.2,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>
      </motion.div>

      {/* ── Exit overlay: washes the scene to the app background ──── */}
      <motion.div
        ref={exitOverlayRef}
        className="absolute inset-0 z-20 pointer-events-none"
        style={{ background: 'var(--background)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: isExiting ? 1 : 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        onAnimationComplete={() => {
          if (isExiting && onExitComplete) {
            onExitComplete()
          }
        }}
      />
    </motion.div>
  )
}
