import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { CodeXml } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { COMPOSER_CHIP } from './composer-styles'
import { CodingWorkspacePanel } from './CodingWorkspacePanel'

interface ComposerCodingChipProps {
  /** Coding mode is on for this session */
  enabled: boolean
  /** The conversation has started: the mode is fixed, so the chip offers a new session instead */
  locked: boolean
  /** Compact/touch layout: icon only */
  compact: boolean
  disabled?: boolean
  onToggle: (enabled: boolean) => void
  onContinueInNewSession: (enabled: boolean) => void
  /**
   * Turning the mode on in a new session asks where the session works: a new worktree or an
   * existing folder. Without these the chip only toggles.
   */
  workspaceSetup?: {
    workspaceId?: string
    sessionId?: string
    /** The session's working folder, when one is set */
    currentFolder?: string
    onUseExistingFolder: () => void
    onWorktreeCreated: (path: string) => void
  }
}

/**
 * Coding mode chip in the composer toolbar, next to the working folder (the mode is about the
 * folder's code). Before the first message it toggles the mode; turning it on opens a small popover
 * asking where the session works (new worktree or existing folder). After that the agent's system
 * prompt and tools are fixed for the conversation, so it opens a popover that continues in a new
 * session with the mode switched (the new session gets a summary of this one).
 */
export function ComposerCodingChip({
  enabled,
  locked,
  compact,
  disabled,
  onToggle,
  onContinueInNewSession,
  workspaceSetup,
}: ComposerCodingChipProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  // Optimistic local state - updates immediately, syncs with prop (confirmation from backend)
  const [optimistic, setOptimistic] = React.useState(enabled)
  React.useEffect(() => {
    setOptimistic(enabled)
  }, [enabled])

  const label = t('chat.codingMode.label')
  // A started session that is not in coding mode shows the icon only, to keep its toolbar quiet
  const showLabel = !compact && (optimistic || !locked)
  const chipClassName = cn(
    COMPOSER_CHIP,
    'shrink-0',
    // On: accent tint in every state, including while its popover is open (COMPOSER_CHIP's open fill is neutral)
    optimistic && 'bg-accent-tint text-accent hover:bg-accent-tint hover:text-accent data-[state=open]:bg-accent-tint data-[state=open]:text-accent [&_svg]:text-accent',
  )
  const chipContent = (
    <>
      <CodeXml className="size-4 shrink-0" />
      {showLabel && <span className="@max-[32rem]/panel:hidden">{label}</span>}
    </>
  )

  if (!locked) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <PopoverAnchor asChild>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="switch"
                aria-checked={optimistic}
                aria-label={label}
                aria-haspopup={workspaceSetup ? 'dialog' : undefined}
                disabled={disabled}
                data-coding-mode={optimistic ? 'on' : 'off'}
                className={chipClassName}
                onClick={() => {
                  const next = !optimistic
                  setOptimistic(next)
                  onToggle(next)
                  // On: ask where this session works. Off: nothing to ask
                  setOpen(next && !!workspaceSetup)
                }}
              >
                {chipContent}
              </button>
            </TooltipTrigger>
          </PopoverAnchor>
          {!open && (
            <TooltipContent side="top" className="max-w-[280px]">
              {optimistic ? t('chat.codingMode.tooltipOn') : t('chat.codingMode.tooltipOff')}
            </TooltipContent>
          )}
        </Tooltip>
        {workspaceSetup && (
          <PopoverContent side="top" align="start" sideOffset={6} className="w-[340px] max-w-[calc(100vw-24px)] p-0">
            <CodingWorkspacePanel {...workspaceSetup} onClose={() => setOpen(false)} />
          </PopoverContent>
        )}
      </Popover>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={optimistic}
          disabled={disabled}
          data-coding-mode={optimistic ? 'on' : 'off'}
          className={chipClassName}
        >
          {chipContent}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={6} className="w-72 space-y-2 p-3">
        <div className="text-label font-medium text-foreground">
          {optimistic ? t('chat.codingMode.lockedTitleOn') : t('chat.codingMode.lockedTitleOff')}
        </div>
        <p className="text-label-sm text-secondary">{t('chat.codingMode.lockedBody')}</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={() => {
            setOpen(false)
            onContinueInNewSession(!optimistic)
          }}
        >
          {optimistic ? t('chat.codingMode.continueStandard') : t('chat.codingMode.continueCoding')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
