import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { COMPOSER_CHIP } from '@/components/app-shell/input/composer-styles'
import { isCraftyTarget, useCraftyTarget } from '@/hooks/useCraftyTarget'

/**
 * Crafty's dot and name, as a composer toolbar chip (the label folds away in narrow panels, like
 * the other chips'). A click stops sending here.
 */
export function CraftyChip({ onStop }: { onStop: () => void }) {
  const { t } = useTranslation()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onStop}
          aria-label={t('sessionMenu.stopSendingCraftyHere')}
          className={cn(COMPOSER_CHIP, 'shrink-0 gap-1.5 pl-2 pr-1.5')}
        >
          <span className="size-2 shrink-0 rounded-full bg-accent-solid" />
          <span data-badge-label>Crafty</span>
          <X className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{t('chat.craftyTargetHint')}</TooltipContent>
    </Tooltip>
  )
}

/** The chip in the composer of the session Crafty sends to; nothing in any other session. */
export function CraftyComposerChip({ sessionId, workspaceId }: { sessionId?: string; workspaceId?: string }) {
  const { target, setTarget } = useCraftyTarget()
  if (!isCraftyTarget(target, workspaceId, sessionId)) return null
  const stop = () => {
    setTarget(null).catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
  }
  return <CraftyChip onStop={stop} />
}
