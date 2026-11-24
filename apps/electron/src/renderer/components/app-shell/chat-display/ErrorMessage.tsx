import * as React from "react"
import { useTranslation } from "react-i18next"
import { motion } from "motion/react"
import { ChevronRight, CircleAlert } from "lucide-react"
import { SPRING } from "@craft-agent/ui/motion"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { StyledDropdownMenuContent, StyledDropdownMenuItem } from "@/components/ui/styled-dropdown"
import { ConnectionIcon } from "@/components/icons/ConnectionIcon"
import type { LlmConnectionWithStatus } from "@config/llm-connections"
import { AnimatedCollapsibleContent } from "@/components/ui/collapsible"
import type { Message } from "../../../../shared/types"
import { handleErrorMessageAction } from "../error-message-actions"
import { stripRepeatedTitle } from "./strip-repeated-title"

export interface AccountRecovery {
  targets: LlmConnectionWithStatus[]
  onSelect: (slug: string) => void
}

interface ErrorMessageProps {
  message: Message
  onOpenUrl?: (url: string) => void
  sessionId?: string
  onRetry?: () => void
  accountRecovery?: AccountRecovery
}

/**
 * ErrorMessage - inline error marker (spec §7.7): the same alert material as Info_Alert (destructive
 * tint, 1px destructive hairline, radius 12, 14px inset) — a 2px left rule on a rounded box tapered
 * into the corners like a bracket. Icon + title in the destructive role (600), body in the foreground
 * role, the recovery actions as buttons (the first one primary), raw details under a disclosure.
 */
export function ErrorMessage({ message, onOpenUrl, sessionId, onRetry, accountRecovery }: ErrorMessageProps) {
  const { t } = useTranslation()
  const hasDetails = (message.errorDetails && message.errorDetails.length > 0) || message.errorOriginal
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const actions = message.errorActions?.filter(a => {
    if (a.action === 'open_url') return !!a.url && !!onOpenUrl
    return true
  })
  // Older saved errors have retryability but no serialized button actions.
  const showFallbackRetry = accountRecovery && onRetry && message.errorCanRetry && !actions?.some(action => action.action === 'retry')
  const title = message.errorTitle || t('common.error')
  const body = stripRepeatedTitle(title, message.content)

  return (
    <div className="flex min-w-0 gap-2.5 rounded-lg bg-destructive-tint inset-ring inset-ring-[var(--destructive-border)] px-3.5 py-3">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 break-words">
        <div className="text-label font-semibold text-destructive">{title}</div>
        {body && <p className="mt-0.5 text-label leading-5 text-foreground">{body}</p>}

        {/* Action buttons: one primary, the rest quiet */}
        {(!!actions?.length || accountRecovery) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {actions?.map((action, index) => (
              <Button
                key={action.key}
                variant={index === 0 ? 'primary' : 'ghost'}
                size="md"
                onClick={() => {
                  handleErrorMessageAction(action, {
                    sessionId,
                    onOpenUrl,
                    onRetry,
                  })
                }}
              >
                {action.label}{action.action === 'open_url' ? ' ↗' : ''}
              </Button>
            ))}
            {showFallbackRetry && (
              <Button variant={actions?.length ? 'ghost' : 'primary'} size="md" onClick={onRetry}>
                {t('common.retry')}
              </Button>
            )}
            {accountRecovery && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="md">
                    {t('chat.modelPicker.switchAccount')}
                    <ChevronRight aria-hidden className="size-3.5 rotate-90" />
                  </Button>
                </DropdownMenuTrigger>
                <StyledDropdownMenuContent align="start" className="min-w-[220px]">
                  {accountRecovery.targets.map(connection => (
                    <StyledDropdownMenuItem key={connection.slug} onSelect={() => accountRecovery.onSelect(connection.slug)}>
                      <ConnectionIcon connection={connection} size={14} />
                      <span className="truncate">{connection.name}</span>
                    </StyledDropdownMenuItem>
                  ))}
                </StyledDropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}

        {/* Technical details, collapsed by default */}
        {hasDetails && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setDetailsOpen(!detailsOpen)}
              aria-expanded={detailsOpen}
              className="-ml-1 inline-flex min-h-control-sm in-data-compact:min-h-9 items-center gap-1 rounded-xs px-1 text-label-sm text-secondary transition-colors duration-micro ease-out-subtle hover:text-foreground hover:duration-instant"
            >
              <motion.span
                initial={false}
                animate={{ rotate: detailsOpen ? 90 : 0 }}
                transition={SPRING.snap}
                className="flex"
              >
                <ChevronRight aria-hidden className="size-3" />
              </motion.span>
              <span>{detailsOpen ? t('chat.hideTechnicalDetails') : t('chat.showTechnicalDetails')}</span>
            </button>

            <AnimatedCollapsibleContent isOpen={detailsOpen} className="overflow-hidden">
              <div className="mt-1.5 space-y-0.5 rounded-sm bg-sunken px-2.5 py-2 font-mono text-mono-ui text-secondary wrap-anywhere">
                {message.errorDetails?.map((detail, i) => (
                  <div key={i}>{detail}</div>
                ))}
                {message.errorOriginal && !message.errorDetails?.some(d => d.includes('Raw error:')) && (
                  <div className="mt-1">Raw: {message.errorOriginal.slice(0, 200)}{message.errorOriginal.length > 200 ? '...' : ''}</div>
                )}
              </div>
            </AnimatedCollapsibleContent>
          </div>
        )}
      </div>
    </div>
  )
}
