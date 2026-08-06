/**
 * BackgroundFinishedChip
 *
 * A small purple pill that floats in the top-right corner *inside* the chat
 * input box when a *background* session (one not currently on screen) finishes a
 * run and produces new output. It is mounted by `InputContainer` (freeform mode)
 * and absolutely positioned — the in-app complement to the OS notification, which
 * only fires when the whole app is unfocused.
 *
 * Behavior:
 * - Only the *focused* session's input renders the chip (`focusedSessionIdAtom`),
 *   so a split view never shows the same announcement twice. The completing
 *   session is never its own announcer — it's excluded from the queue lookup and
 *   the App-level detector already skips sessions visible in any panel.
 * - Clicking the chip dissolves it, *then* jumps to the finished session
 *   (preserving the old banner's jump-to-output behavior) and clears its queue
 *   entry, so it stays gone until the next completion. The navigation is
 *   deliberately deferred to `AnimatePresence`'s `onExitComplete`: navigating
 *   synchronously unmounts the input container, which would kill the exit tween
 *   before a single frame renders. Instead the click flips a local `exiting` flag
 *   that removes the chip from the tree (the input stays mounted), the spring
 *   fade+scale plays to completion, and only then do we dismiss + navigate.
 * - Enter/exit use Motion (`AnimatePresence` + `motion.div`). `initial={false}`
 *   suppresses the animation for a chip that's already pending when you switch to
 *   a session (feels stable), while a completion that lands *live* still animates
 *   in. Removal dissolves with a spring fade+scale.
 *
 * Navigation is read from `NavigationContext` directly (nullable) rather than via
 * `useNavigation()` so it stays mountable in the playground, which has no
 * `NavigationProvider`; it falls back to the global `navigate()`.
 */

import { useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NavigationContext } from '@/contexts/NavigationContext'
import { navigate, routes } from '@/lib/navigate'
import { focusedSessionIdAtom } from '@/atoms/panel-stack'
import {
  backgroundFinishedAtom,
  dismissBackgroundFinishedAtom,
  showBackgroundFinishedChipAtom,
} from '@/atoms/background-finished'

// Snappy UI spring (see apps/electron/CLAUDE.md → Animations). Only opacity and
// transform are animated, per the GPU-accelerated-properties guidance.
const chipSpring = { type: 'spring' as const, stiffness: 400, damping: 30, mass: 0.8 }

export interface BackgroundFinishedChipProps {
  /**
   * The session displayed in this row. Its own completion is never announced
   * here, and its row only renders the chip when it is the focused session.
   */
  sessionId: string
}

export function BackgroundFinishedChip({ sessionId }: BackgroundFinishedChipProps) {
  const { t } = useTranslation()
  const nav = useContext(NavigationContext)
  const enabled = useAtomValue(showBackgroundFinishedChipAtom)
  const queue = useAtomValue(backgroundFinishedAtom)
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)
  const dismiss = useSetAtom(dismissBackgroundFinishedAtom)

  // Opening a session acknowledges it: clear its queued entry whenever it's the
  // session shown in this row. The detector in App.tsx already avoids queuing
  // sessions visible in any panel; this makes the invariant self-healing if one
  // ever slips through. dismiss() no-ops when the id isn't queued, so it's cheap
  // and cannot loop. Runs regardless of focus so any visible panel evicts itself.
  useEffect(() => {
    if (queue.some(e => e.sessionId === sessionId)) {
      dismiss(sessionId)
    }
  }, [sessionId, queue, dismiss])

  // Most-recent background completion that isn't the session on screen. Only the
  // focused session's row announces it, so split views don't double up.
  const entry = enabled && focusedSessionId === sessionId
    ? [...queue].reverse().find(e => e.sessionId !== sessionId)
    : undefined

  // Click flips this flag to remove the chip from the tree and let the exit tween
  // play; the pending target survives in a ref so `onExitComplete` can navigate
  // once the dissolve finishes. Reset whenever the entry itself goes away so a
  // later completion animates in cleanly.
  const [exiting, setExiting] = useState(false)
  const pendingNavRef = useRef<string | null>(null)
  useEffect(() => {
    if (!entry) {
      setExiting(false)
      pendingNavRef.current = null
    }
  }, [entry])

  const startDismiss = (targetId: string) => {
    pendingNavRef.current = targetId
    setExiting(true)
  }

  // Fires after the dissolve completes. Guarded on a pending target so an exit
  // triggered by an external dismiss (self-heal, opened elsewhere) is a no-op.
  const finishDismiss = () => {
    const targetId = pendingNavRef.current
    if (!targetId) return
    pendingNavRef.current = null
    setExiting(false)
    dismiss(targetId)
    if (nav) nav.navigateToSession(targetId)
    else navigate(routes.view.allSessions(targetId))
  }

  return (
    <AnimatePresence initial={false} onExitComplete={finishDismiss}>
      {entry && !exiting && (
        <motion.div
          key={entry.sessionId}
          className="absolute right-2 top-2 z-20"
          initial={{ opacity: 0, scale: 0.9, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -4 }}
          transition={chipSpring}
        >
          <button
            type="button"
            onClick={() => startDismiss(entry.sessionId)}
            title={`${entry.title} — ${t('chat.backgroundSessionFinished')}`}
            aria-label={`${entry.title} — ${t('chat.backgroundSessionFinished')}`}
            className={cn(
              'flex items-center gap-1.5 h-[26px] pl-2 pr-2.5 rounded-full',
              'text-xs font-medium select-none outline-none transition-colors',
              'text-purple-700 dark:text-purple-200',
              'bg-purple-500/12 hover:bg-purple-500/20',
              'ring-1 ring-inset ring-purple-400/30 dark:ring-purple-300/25',
              'shadow-[0_2px_10px_rgba(147,51,234,0.20)] backdrop-blur-md',
            )}
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-purple-500 dark:text-purple-300" />
            <span className="truncate max-w-[150px]">{entry.title}</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
