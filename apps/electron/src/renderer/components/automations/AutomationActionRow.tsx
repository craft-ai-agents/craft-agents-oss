/**
 * AutomationActionRow
 *
 * Inline display of a single automation action (prompt, webhook or script).
 * Used within the "Then" section of AutomationInfoPage.
 *
 * Prompt actions surface optional per-action overrides (llmConnection,
 * model, thinkingLevel) as low-emphasis badges below the prompt text.
 */

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Info_Badge } from '@/components/info/Info_Badge'
import { THINKING_LEVELS } from '@craft-agent/shared/agent/thinking-levels'
import type { AutomationAction, PromptAction, ScriptAction } from './types'
import { ActionTypeIcon } from './ActionTypeIcon'
import { DEFAULT_SCRIPT_RUNTIME, DEFAULT_WEBHOOK_METHOD } from './constants'

export interface AutomationActionRowProps {
  action: AutomationAction
  index: number
  className?: string
}

/**
 * Highlight @mentions in prompt strings
 */
function PromptText({ text, t }: { text: string; t: (key: string) => string }) {
  if (!text) return <span className="text-label italic text-tertiary">{t('automations.emptyPrompt')}</span>
  const parts = text.split(/(@\w[\w-]*)/g)
  return (
    <span className="break-words text-label text-foreground">
      {parts.map((part, i) =>
        part.startsWith('@') ? (
          <span key={i} className="text-accent font-medium">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  )
}

function WebhookText({ action }: { action: Extract<AutomationAction, { type: 'webhook' }> }) {
  const method = action.method ?? DEFAULT_WEBHOOK_METHOD
  return (
    <span className="break-words text-label">
      <span className="font-mono text-mono-ui font-medium text-accent">{method}</span>{' '}
      <span className="text-secondary [overflow-wrap:anywhere]">{action.url}</span>
      {action.bodyFormat && (
        <span className="ml-1 text-tertiary">({action.bodyFormat})</span>
      )}
    </span>
  )
}

function ScriptText({ action }: { action: ScriptAction }) {
  return (
    <span className="break-words text-label">
      <span className="font-mono text-mono-ui font-medium text-accent">{action.runtime ?? DEFAULT_SCRIPT_RUNTIME}</span>{' '}
      <span className="font-mono text-mono-ui text-secondary [overflow-wrap:anywhere]">{action.script}</span>
      {action.args && action.args.length > 0 && (
        <span className="ml-1 font-mono text-mono-ui text-tertiary [overflow-wrap:anywhere]">{action.args.join(' ')}</span>
      )}
    </span>
  )
}

/**
 * Render the per-action override chips (connection / model / thinking level).
 * Each chip is conditional on its field being set on the action.
 *
 * The connection slug is shown verbatim (no display-name resolution) — that
 * would require fetching the workspace's LlmConnection list into the Info
 * page, which isn't justified for a read-only chip. If the slug becomes
 * stale, executePromptAutomation already logs a warning at run time.
 */
function PromptActionBadges({ action, t }: { action: PromptAction; t: (key: string) => string }) {
  const { llmConnection, model, thinkingLevel } = action
  if (!llmConnection && !model && !thinkingLevel) return null

  const thinkingDef = thinkingLevel ? THINKING_LEVELS.find((l) => l.id === thinkingLevel) : undefined
  const thinkingLabel = thinkingDef ? t(thinkingDef.nameKey) : thinkingLevel

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      {llmConnection && (
        <Info_Badge
          color="default"
          className="font-mono font-normal"
          title={`${t('automations.labelConnection')}: ${llmConnection}`}
        >
          {llmConnection}
        </Info_Badge>
      )}
      {model && (
        <Info_Badge
          color="default"
          className="max-w-[14rem] font-mono font-normal"
          title={`${t('automations.labelModel')}: ${model}`}
        >
          <span className="truncate">{model}</span>
        </Info_Badge>
      )}
      {thinkingLevel && (
        <Info_Badge
          color="default"
          className="font-normal"
          title={`${t('automations.labelThinking')}: ${thinkingLabel}`}
        >
          {thinkingLabel}
        </Info_Badge>
      )}
    </div>
  )
}

export function AutomationActionRow({ action, index, className }: AutomationActionRowProps) {
  const { t } = useTranslation()

  return (
    <div className={cn('flex items-start gap-3 px-3.5 py-3', className)}>
      {/* Index + icon — h-[18px] matches the first line height of text-label content */}
      <div className="flex h-[18px] shrink-0 items-center gap-2">
        <span className="w-4 text-right text-label-sm text-tertiary tabular-nums">
          {index + 1}.
        </span>
        <ActionTypeIcon type={action.type} className="h-3.5 w-3.5" />
      </div>

      {/* Content — text-label on the block so the line box matches the 18px index column */}
      <div className="flex-1 min-w-0 text-label">
        {action.type === 'webhook' ? (
          <WebhookText action={action} />
        ) : action.type === 'script' ? (
          <ScriptText action={action} />
        ) : (
          <>
            <PromptText text={action.prompt} t={t} />
            <PromptActionBadges action={action} t={t} />
          </>
        )}
      </div>
    </div>
  )
}
