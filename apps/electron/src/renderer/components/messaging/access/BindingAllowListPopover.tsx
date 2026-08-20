/**
 * Per-binding access editor.
 *
 * Three explicit modes:
 *  - public-inbox  — pairing reply only; no session or tools
 *  - owner-control — listed senders / workspace owners may route
 *  - disabled      — inbound routing off
 *
 * Owner-control does not persist until at least one sender id is selected.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Ban, Check, ChevronDown, Globe, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  canCommitOwnerControl,
  UI_ACCESS_MODES,
  type UiMessagingAccessMode,
} from './access-mode'
import type { BindingAccess, PlatformOwner } from './types'

interface Props {
  access: BindingAccess
  workspaceOwners: PlatformOwner[]
  onChange: (next: BindingAccess) => void
}

const MODE_LABEL_KEYS: Record<UiMessagingAccessMode, string> = {
  'public-inbox': 'settings.messaging.telegram.access.bindingPopover.mode.publicInbox.label',
  'owner-control': 'settings.messaging.telegram.access.bindingPopover.mode.ownerControl.label',
  disabled: 'settings.messaging.telegram.access.bindingPopover.mode.disabled.label',
}

const MODE_DESCRIPTION_KEYS: Record<UiMessagingAccessMode, string> = {
  'public-inbox': 'settings.messaging.telegram.access.bindingPopover.mode.publicInbox.description',
  'owner-control': 'settings.messaging.telegram.access.bindingPopover.mode.ownerControl.description',
  disabled: 'settings.messaging.telegram.access.bindingPopover.mode.disabled.description',
}

const MODE_ICONS: Record<UiMessagingAccessMode, typeof Lock> = {
  'public-inbox': Globe,
  'owner-control': Lock,
  disabled: Ban,
}

const MODE_LABEL_DEFAULTS: Record<UiMessagingAccessMode, string> = {
  'public-inbox': 'Public inbox',
  'owner-control': 'Owner control',
  disabled: 'Disabled',
}

const MODE_DESCRIPTION_DEFAULTS: Record<UiMessagingAccessMode, string> = {
  'public-inbox':
    'Unknown senders get a pairing reply. Messages do not start an agent session or run tools.',
  'owner-control':
    'Only selected senders and workspace owners can route to this session.',
  disabled: 'This binding does not route inbound messages.',
}

export function BindingAllowListPopover({ access, workspaceOwners, onChange }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [draftIds, setDraftIds] = React.useState<string[]>(access.allowedSenderIds)
  const [blockedEmptySave, setBlockedEmptySave] = React.useState(false)

  React.useEffect(() => {
    setDraftIds(access.allowedSenderIds)
    setBlockedEmptySave(false)
  }, [access.allowedSenderIds, access.mode])

  const triggerLabel = buildTriggerLabel(access, t)

  const selectMode = (mode: UiMessagingAccessMode) => {
    if (mode !== 'owner-control') {
      setBlockedEmptySave(false)
      onChange({ mode, allowedSenderIds: [] })
      return
    }
    // Owner-control requires an exact selected sender. Do not inherit the
    // full workspace owner set — that would recreate the legacy inherit path.
    const nextIds = canCommitOwnerControl(draftIds)
      ? draftIds.filter((id) => id.trim().length > 0)
      : access.allowedSenderIds.filter((id) => id.trim().length > 0)
    if (!canCommitOwnerControl(nextIds)) {
      setBlockedEmptySave(true)
      return
    }
    setBlockedEmptySave(false)
    onChange({ mode: 'owner-control', allowedSenderIds: nextIds })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs text-foreground/60 hover:text-foreground"
        >
          {triggerLabel}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-3 py-2.5">
          <div className="text-xs font-medium">
            {t('settings.messaging.telegram.access.bindingPopover.title')}
          </div>
        </div>
        <div className="border-t border-border/50">
          {UI_ACCESS_MODES.map((mode) => (
            <ModeRow
              key={mode}
              mode={mode}
              selected={access.mode === mode}
              onSelect={() => selectMode(mode)}
            />
          ))}
        </div>

        {(access.mode === 'owner-control' || blockedEmptySave) && (
          <div className="border-t border-border/50 px-3 py-2.5">
            <div className="text-xs font-medium">
              {t('settings.messaging.telegram.access.allowedUsersTitle')}
            </div>
            {!canCommitOwnerControl(draftIds) && (
              <div className="mt-1 text-xs text-foreground/50">
                {t('settings.messaging.telegram.access.bindingPopover.saveDisabledHint', {
                  defaultValue:
                    'Select at least one allowed sender before saving owner control.',
                })}
              </div>
            )}
            <div className="mt-2 flex flex-col gap-1">
              {workspaceOwners.length === 0 ? (
                <div className="text-xs text-foreground/50">
                  {t('settings.messaging.telegram.access.bindingPopover.noKnownUsers')}
                </div>
              ) : (
                workspaceOwners.map((owner) => {
                  const checked = draftIds.includes(owner.userId)
                  const primary = owner.displayName || owner.username || owner.userId
                  return (
                    <button
                      key={owner.userId}
                      type="button"
                      onClick={() => {
                        const next = checked
                          ? draftIds.filter((id) => id !== owner.userId)
                          : [...draftIds, owner.userId]
                        setDraftIds(next)
                        if (!canCommitOwnerControl(next)) {
                          setBlockedEmptySave(true)
                          return
                        }
                        setBlockedEmptySave(false)
                        onChange({ mode: 'owner-control', allowedSenderIds: next })
                      }}
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-foreground/[0.05]"
                    >
                      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border/70">
                        {checked && <Check className="h-3 w-3" />}
                      </div>
                      <div className="min-w-0 flex-1 truncate text-xs">{primary}</div>
                      {owner.username && (
                        <div className="shrink-0 text-xs text-foreground/40">
                          @{owner.username}
                        </div>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ModeRow({
  mode,
  selected,
  onSelect,
}: {
  mode: UiMessagingAccessMode
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const Icon = MODE_ICONS[mode]
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.05]"
    >
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-foreground/60"
        strokeWidth={1.5}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs font-medium">
          {t(MODE_LABEL_KEYS[mode], { defaultValue: MODE_LABEL_DEFAULTS[mode] })}
          {selected && <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />}
        </div>
        <div className="mt-0.5 text-xs text-foreground/50">
          {t(MODE_DESCRIPTION_KEYS[mode], {
            defaultValue: MODE_DESCRIPTION_DEFAULTS[mode],
          })}
        </div>
      </div>
    </button>
  )
}

function buildTriggerLabel(
  access: BindingAccess,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (access.mode === 'public-inbox') {
    return t('settings.messaging.telegram.access.bindingPopover.trigger.publicInbox', {
      defaultValue: 'Public inbox',
    })
  }
  if (access.mode === 'disabled') {
    return t('settings.messaging.telegram.access.bindingPopover.trigger.disabled', {
      defaultValue: 'Disabled',
    })
  }
  return t('settings.messaging.telegram.access.bindingPopover.trigger.ownerControl', {
    count: access.allowedSenderIds.length,
    defaultValue: 'Owner control · {{count}}',
  })
}
