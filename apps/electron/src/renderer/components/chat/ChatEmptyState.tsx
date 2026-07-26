/**
 * ChatEmptyState — what a fresh chat shows before the first message.
 *
 * A new session used to render an empty scroll area: the transcript is
 * bottom-anchored, so an empty one left a full-height void above the composer
 * with nothing in it. This fills that space with the brand mark, a greeting,
 * and a rotating workflow suggestion.
 *
 * `EmptyStateHint` already existed for exactly this purpose but was only ever
 * mounted in the playground — this is what puts it in front of users.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatedARCHstudioSymbol } from '../icons/AnimatedARCHstudioSymbol'
import { EmptyStateHint, getHintCount } from './EmptyStateHint'
import { cn } from '@/lib/utils'
import './ChatEmptyState.css'

/** How long each workflow suggestion stays on screen. */
const HINT_ROTATE_MS = 9000

export interface ChatEmptyStateProps {
  className?: string
}

export function ChatEmptyState({ className }: ChatEmptyStateProps) {
  const { t } = useTranslation()

  // Rotate through the hints so the surface has some life without demanding
  // attention. Keyed remount is what re-triggers the fade on each change.
  const hintCount = getHintCount()
  const [hintIndex, setHintIndex] = React.useState(() =>
    hintCount > 0 ? Math.floor(Math.random() * hintCount) : 0,
  )

  React.useEffect(() => {
    if (hintCount <= 1) return
    // Respect reduced motion by holding a single suggestion instead of cycling.
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    const id = setInterval(() => {
      setHintIndex((i) => (i + 1) % hintCount)
    }, HINT_ROTATE_MS)
    return () => clearInterval(id)
  }, [hintCount])

  return (
    <div
      className={cn('chat-empty', className)}
      // Decorative: the composer below owns all interaction.
      aria-hidden="true"
    >
      <div className="chat-empty__mark">
        <AnimatedARCHstudioSymbol className="chat-empty__symbol" />
      </div>

      <p className="chat-empty__title">{t('chat.emptyTitle')}</p>
      <p className="chat-empty__subtitle">{t('chat.emptySubtitle')}</p>

      {hintCount > 0 && (
        <div className="chat-empty__hint">
          <EmptyStateHint key={hintIndex} hintIndex={hintIndex} />
        </div>
      )}
    </div>
  )
}
