/**
 * SettingsToggle
 *
 * Toggle switch row with label and optional description.
 * Designed for use inside SettingsCard.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { settingsUI } from './SettingsUIConstants'

export interface SettingsToggleProps {
  /** Toggle label (string or JSX for custom rendering) */
  label: React.ReactNode
  /** Optional description below label */
  description?: string
  /** Optional longer help, shown from an info icon next to the label */
  tooltip?: React.ReactNode
  /** Optional small line under the description (e.g. usage numbers) */
  note?: string
  /** Current checked state */
  checked: boolean
  /** Change handler */
  onCheckedChange: (checked: boolean) => void
  /** Disabled state */
  disabled?: boolean
  /** Additional className */
  className?: string
  /** Whether the toggle is inside a card (affects padding) */
  inCard?: boolean
}

/**
 * SettingsToggle - Toggle switch with label and description
 *
 * @example
 * <SettingsCard>
 *   <SettingsToggle
 *     label="Desktop notifications"
 *     description="Get notified when AI finishes working"
 *     checked={enabled}
 *     onCheckedChange={setEnabled}
 *   />
 * </SettingsCard>
 */
export function SettingsToggle({
  label,
  description,
  tooltip,
  note,
  checked,
  onCheckedChange,
  disabled,
  className,
  inCard = true,
}: SettingsToggleProps) {
  const id = React.useId()
  const { t } = useTranslation()

  return (
    <div
      data-layout="settings-row"
      className={cn(
        'flex items-center justify-between',
        inCard ? 'px-4 py-3.5' : 'py-3',
        disabled && 'opacity-50',
        className
      )}
    >
      <label htmlFor={id} className="flex-1 min-w-0 cursor-pointer select-none">
        <div className={cn(settingsUI.label, tooltip && 'flex items-center gap-1.5')}>
          {label}
          {tooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A button so keyboard and screen-reader users reach the help; preventDefault keeps a
                    click on it from toggling the switch this label controls. */}
                <button
                  type="button"
                  aria-label={t('common.info')}
                  className="inline-flex rounded-sm text-foreground/40 hover:text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={(event) => event.preventDefault()}
                >
                  <Info className="size-3.5" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {description && (
          <div className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</div>
        )}
        {note && <div className={cn(settingsUI.descriptionSmall, 'mt-0.5 tabular-nums')}>{note}</div>}
      </label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        data-layout="settings-control"
        className="ml-4 shrink-0"
      />
    </div>
  )
}
