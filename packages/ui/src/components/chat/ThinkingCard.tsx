import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown, Brain } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Spinner } from '../ui/LoadingIndicator'
import { SIZE_CONFIG, type ResponseContent } from './TurnCard'

/**
 * ThinkingCard - collapsible card for the model's reasoning stream
 * (OMP thinking_* events, e.g. kimi-k3 reasoning:true).
 *
 * Renders above the assistant response. Streams token-by-token while the
 * model thinks; thinking_complete force-collapses the card. Runtime-only —
 * never persisted, so reloading a session simply shows no card.
 */
export interface ThinkingCardProps {
  /** Streaming/complete thinking content for the turn */
  thinking: ResponseContent
}

export function ThinkingCard({ thinking }: ThinkingCardProps) {
  const { t } = useTranslation()
  const isStreaming = thinking.isStreaming
  // Explicit user toggle wins; otherwise expand while streaming and collapse
  // as soon as thinking_complete lands (isStreaming flips false).
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
  const [prevStreaming, setPrevStreaming] = useState(isStreaming)
  if (prevStreaming !== isStreaming) {
    // New reasoning block started — drop any stale user override so the new
    // block opens expanded and force-collapses on completion again.
    if (isStreaming) setUserExpanded(null)
    setPrevStreaming(isStreaming)
  }
  const expanded = userExpanded ?? isStreaming

  const rawText = thinking.text || ''

  return (
    <div
      className={cn("mb-2 rounded-lg border border-border/60 bg-muted/30")}
      role="region"
      aria-label={t('turnCard.thinking')}
    >
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
          "text-muted-foreground hover:text-foreground transition-colors"
        )}
        onClick={() => setUserExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {isStreaming ? (
          <Spinner className={SIZE_CONFIG.spinnerSize} />
        ) : (
          <Brain className={cn(SIZE_CONFIG.iconSize, "shrink-0")} />
        )}
        <span className={cn("flex-1 font-medium", SIZE_CONFIG.fontSize)}>
          {t('turnCard.thinking')}
        </span>
        <ChevronDown
          className={cn(
            SIZE_CONFIG.iconSize,
            "shrink-0 transition-transform duration-200",
            expanded && "rotate-180"
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="thinking-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div
              className={cn(
                "px-3 pb-2 pt-0.5 text-muted-foreground whitespace-pre-wrap break-words",
                SIZE_CONFIG.fontSize
              )}
            >
              {rawText}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
