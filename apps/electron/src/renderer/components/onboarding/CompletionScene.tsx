import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProviderDetail } from './OnboardingWizard'

// ─── Checkmark particle burst ────────────────────────────────────────────

interface BurstParticle {
  /** Angle in degrees from center */
  angle: number
  /** Distance the particle travels (px) */
  distance: number
  /** Stagger delay (ms) */
  delay: number
  /** Size in px */
  size: number
  /** Color (lime or purple tint) */
  color: string
}

function useBurstParticles(count: number): BurstParticle[] {
  return useMemo(() => {
    const p: BurstParticle[] = []
    for (let i = 0; i < count; i++) {
      p.push({
        angle: (360 / count) * i + Math.random() * 15, // spread around circle
        distance: 14 + Math.random() * 18,              // 14–32px outward
        delay: Math.random() * 0.12,                    // 0–120ms stagger
        size: 2 + Math.random() * 2.5,                  // 2–4.5px
        color: Math.random() > 0.4
          ? 'var(--brand-lime)'
          : 'var(--brand-purple)',
      })
    }
    return p
  }, [count])
}

function CheckmarkParticles() {
  const particles = useBurstParticles(10)
  const rad = (deg: number) => (deg * Math.PI) / 180

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ top: '50%', left: '50%', zIndex: 2 }}
    >
      {particles.map((p, i) => {
        const dx = Math.cos(rad(p.angle)) * p.distance
        const dy = Math.sin(rad(p.angle)) * p.distance
        return (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              width: p.size,
              height: p.size,
              background: p.color,
              // Center the dot on the origin point
              marginLeft: -p.size / 2,
              marginTop: -p.size / 2,
            }}
            initial={{ opacity: 0, scale: 0 }}
            animate={{
              opacity: [0, 1, 1, 0],
              scale: [0, 1.2, 1, 0],
              x: [0, dx],
              y: [0, dy],
            }}
            transition={{
              duration: 0.9,
              delay: 0.7 + p.delay, // ~0.7s after checkmark animation starts
              ease: [0.16, 1, 0.3, 1],
            }}
          />
        )
      })}
    </div>
  )
}

// ─── Component ──────────────────────────────────────────────────────────

interface CompletionSceneProps {
  /** Saving state while config persists, then complete */
  status: 'saving' | 'complete'
  /** Name of the connected provider (optional) */
  providerName?: string
  /** Validated provider details shown with green checkmarks */
  connectionDetails?: ProviderDetail[]
  /** Called when user clicks Enter Studio */
  onFinish: () => void
}

function ProviderCheckRow({ detail, index }: { detail: ProviderDetail; index: number }) {
  const isOk = detail.passed
  const accentColor = isOk ? 'var(--brand-lime)' : 'var(--ds-error)'

  return (
    <motion.div
      className="flex items-center gap-2.5"
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: 0.35 + index * 0.08, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Animated icon: green circle-checkmark or red circle-X */}
      <motion.svg
        viewBox="0 0 20 20"
        className="w-4 h-4 shrink-0"
        style={{ overflow: 'visible' }}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.3, delay: 0.35 + index * 0.08 + 0.15 }}
      >
        {/* Circle outline */}
        <motion.circle
          cx="10" cy="10" r="9"
          fill="none"
          stroke={accentColor}
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.25, delay: 0.35 + index * 0.08 + 0.15, ease: 'easeOut' }}
        />
        {isOk ? (
          /* Checkmark */
          <motion.path
            d="M6 10.5l2.5 2.5 5-5"
            fill="none"
            stroke={accentColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.2, delay: 0.35 + index * 0.08 + 0.25, ease: 'easeOut' }}
          />
        ) : (
          /* X cross: two intersecting lines drawn simultaneously */
          <motion.g
            stroke={accentColor}
            strokeWidth="2"
            strokeLinecap="round"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15, delay: 0.35 + index * 0.08 + 0.25 }}
          >
            <motion.path
              d="M7 7l6 6"
              fill="none"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.15, delay: 0.35 + index * 0.08 + 0.25, ease: 'easeOut' }}
            />
            <motion.path
              d="M13 7l-6 6"
              fill="none"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.15, delay: 0.35 + index * 0.08 + 0.25, ease: 'easeOut' }}
            />
          </motion.g>
        )}
      </motion.svg>

      {/* Label + value — dimmed + red-accented on failure */}
      <span className="text-[13px]">
        <span className={isOk ? 'text-foreground/50' : 'text-destructive/60'}>
          {detail.label}:{' '}
        </span>
        <span
          className={cn(
            'font-medium',
            isOk ? 'text-foreground/80' : 'text-destructive',
          )}
        >
          {detail.value}
        </span>
      </span>
    </motion.div>
  )
}

export function CompletionScene({
  status,
  providerName,
  connectionDetails,
  onFinish,
}: CompletionSceneProps) {
  const [isExiting, setIsExiting] = useState(false)
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks remaining seconds for the auto-dismiss countdown (every tick triggers a re-render)
  // Used to display a numeric countdown alongside the progress bar
  const [autoCount, setAutoCount] = useState(5)

  const handleFinish = useCallback(() => {
    // Clear the auto-dismiss timer so it doesn't fire during the exit animation
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current)
      autoTimerRef.current = null
    }
    // Play the glow-reveal exit animation, then call onFinish
    setIsExiting(true)
    setTimeout(() => {
      onFinish()
    }, 600)
  }, [onFinish])

  const isComplete = status === 'complete'
  const [copied, setCopied] = useState(false)

  // ── Auto-dismiss after 5 seconds ────────────────────────────────────
  // Starts when isComplete becomes true. Cancelled on user click (handleFinish).
  // Ticks autoCount every second (5→4→3→2→1) so the numeric label stays in sync
  // with the shrinking progress bar.
  useEffect(() => {
    if (!isComplete || isExiting) return

    // Tick the countdown each second so the numeric label updates
    const tick = setInterval(() => {
      setAutoCount(prev => Math.max(0, prev - 1))
    }, 1000)

    // Fire the exit after 5 seconds
    autoTimerRef.current = setTimeout(() => {
      handleFinish()
    }, 5000)

    return () => {
      clearInterval(tick)
      if (autoTimerRef.current) {
        clearTimeout(autoTimerRef.current)
        autoTimerRef.current = null
      }
    }
  }, [isComplete, isExiting, handleFinish])

  const handleCopySummary = useCallback(() => {
    if (!connectionDetails) return
    const text = connectionDetails
      .map(d => `${d.label}: ${d.value}`)
      .join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      // Clipboard write failed — silently degrade
    })
  }, [connectionDetails])

  return (
    <div className="flex flex-col items-center">
      {/* ── Saving state ─────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {!isComplete && (
          <motion.div
            key="saving"
            className="flex flex-col items-center w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div style={{ height: 20 }} />

            {/* Spinning emblem */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              style={{ width: 40, height: 40 }}
            >
              <div
                className="rounded-full"
                style={{
                  width: 40,
                  height: 40,
                  border: '3px solid color-mix(in oklch, var(--brand-purple) 15%, transparent)',
                  borderTopColor: 'var(--brand-purple)',
                }}
              />
            </motion.div>

            <div style={{ height: 16 }} />

            <h1 className="onboarding-mural__title" style={{ fontSize: 18 }}>
              Setting up your studio…
            </h1>

            <p className="onboarding-mural__subtitle" style={{ marginTop: 4 }}>
              Saving configuration and testing your connection.
            </p>
          </motion.div>
        )}

        {/* ── Complete state ──────────────────────────────────────── */}
        {isComplete && (
          <motion.div
            key="complete"
            className="flex flex-col items-center w-full"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={
              isExiting
                ? { opacity: 0, scale: 1.15, y: -30 }
                : { opacity: 1, scale: 1 }
            }
            transition={{ duration: isExiting ? 0.5 : 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <div style={{ height: 8 }} />

            {/* Animated checkmark circle with particle burst */}
            <motion.div
              className="relative"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="onboarding-mural__completion-icon">
                <svg viewBox="0 0 24 24" className="w-5 h-5" style={{ overflow: 'visible' }}>
                  <motion.path
                    d="M20 6L9 17l-5-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: 'var(--brand-lime)' }}
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
                  />
                </svg>
              </div>

              {/* Particle burst — fires when the checkmark finishes drawing (~0.7s) */}
              <CheckmarkParticles />
            </motion.div>

            {/* Title */}
            <motion.h1
              className="onboarding-mural__title onboarding-mural__title--gradient"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              Your studio is ready
            </motion.h1>

            {/* Decorative rule */}
            <motion.div
              className="onboarding-mural__decorative-rule"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.2 }}
            >
              <span className="onboarding-mural__decorative-rule-text">
                {providerName ? `Connected to ${providerName}` : 'Ready to create'}
              </span>
            </motion.div>

            <motion.p
              className="onboarding-mural__subtitle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.25 }}
            >
              Open the studio to start working with AI agents in a workspace designed for flow.
            </motion.p>

            {/* Provider details — green checkmarks for each validated step */}
            {connectionDetails && connectionDetails.length > 0 && (
              <motion.div
                className="flex flex-col items-center gap-2 mt-5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, delay: 0.3 }}
              >
                {connectionDetails.map((detail, i) => (
                  <ProviderCheckRow key={detail.label} detail={detail} index={i} />
                ))}
              </motion.div>
            )}

            {/* Action */}
            <motion.div
              className="flex flex-col items-center gap-2 mt-5"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.3 }}
            >
              <motion.button
                onClick={handleFinish}
                className="onboarding-mural__btn onboarding-mural__btn--primary onboarding-mural__btn--full"
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                disabled={isExiting}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Enter Studio
              </motion.button>

              {/* Copy summary */}
              {connectionDetails && connectionDetails.length > 0 && (
                <motion.button
                  onClick={handleCopySummary}
                  className="onboarding-mural__btn onboarding-mural__btn--ghost"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4, duration: 0.3 }}
                  title="Copy provider details as text"
                >
                  {copied ? (
                    <Check className="w-3 h-3" style={{ color: 'var(--brand-lime)' }} />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copied ? 'Copied!' : 'Copy summary'}</span>
                </motion.button>
              )}

              {/* ── Auto-dismiss countdown progress bar + seconds ── */}
              {!isExiting && (
                <motion.div
                  className="flex flex-col items-center gap-1.5 w-full mt-2"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5, duration: 0.3 }}
                >
                  {/* Numeric countdown */}
                  <span
                    className="text-[11px] font-medium tracking-wider"
                    style={{ color: 'color-mix(in oklch, var(--brand-purple) 45%, transparent)' }}
                  >
                    Entering studio in {autoCount}s
                  </span>

                  {/* Progress bar */}
                  <div
                    className="relative w-full max-w-[160px] h-[2px] rounded-full overflow-hidden"
                    style={{
                      background: 'color-mix(in oklch, var(--brand-purple) 12%, transparent)',
                    }}
                  >
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ background: 'var(--brand-gradient)' }}
                      initial={{ width: '100%' }}
                      animate={{ width: '0%' }}
                      transition={{ duration: 5, ease: 'linear' }}
                    />
                  </div>
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Exit overlay: brand-glow reveal that segues into QuickStart ── */}
      <AnimatePresence>
        {isExiting && (
          <motion.div
            className="fixed inset-0 z-50 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{
              background: `
                radial-gradient(ellipse 80% 60% at 50% 50%,
                  color-mix(in oklch, var(--brand-purple) 35%, transparent) 0%,
                  color-mix(in oklch, var(--brand-lime) 12%, transparent) 40%,
                  var(--background) 80%)
              `,
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
