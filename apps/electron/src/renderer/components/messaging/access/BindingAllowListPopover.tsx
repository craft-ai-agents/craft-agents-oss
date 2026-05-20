/**
 * Per-binding allow-list editor.
 *
 * Trigger is a small pill rendered next to the binding row's actions; click
 * opens a popover with three modes:
 *  - inherit     — fall back to workspace owners (default for new bindings)
 *  - allow-list  — explicit subset of senders (always includes the owner)
 *  - open        — anyone in an accepted chat can route (back-compat / public)
 *
 * Phase 1 keeps the allow-list editor minimal: the user can see existing
 * allowed senders and toggle owner names on/off. Adding arbitrary senders
 * happens via the workspace pending-requests flow — this popover only lets
 * you slice down which subset of *known* users can talk to *this* binding.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Lock, Globe, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { BindingAccess, BindingAccessMode, PlatformOwner } from './types'

interface Props {
  access: BindingAccess
  /** Workspace owners; the inherit/allow-list modes operate against this set. */
  workspaceOwners: PlatformOwner[]
  onChange: (next: BindingAccess) => void
}

const MODE_LABEL_KEYS: Record<BindingAccessMode, string> = {
  inherit: 'settings.messaging.telegram.access.bindingPopover.mode.inherit.label',
  'allow-list': 'settings.messaging.telegram.access.bindingPopover.mode.allowList.label',
  open: 'settings.messaging.telegram.access.bindingPopover.mode.open.label',
}

const MODE_DESCRIPTION_KEYS: Record<BindingAccessMode, string> = {
  inherit: 'settings.messaging.telegram.access.bindingPopover.mode.inherit.description',
  'allow-list': 'settings.messaging.telegram.access.bindingPopover.mode.allowList.description',
  open: 'settings.messaging.telegram.access.bindingPopover.mode.open.description',
}

const MODE_ICONS: Record<BindingAccessMode, typeof ShieldCheck> = {
  inherit: ShieldCheck,
  'allow-list': Lock,
  open: Globe,
}

export function BindingAllowListPopover({ access, workspaceOwners, onChange }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)

  const triggerLabel = buildTriggerLabel(access, workspaceOwners.length, t)

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
          {(['inherit', 'allow-list', 'open'] as BindingAccessMode[]).map((mode) => (
            <ModeRow
              key={mode}
              mode={mode}
              selected={access.mode === mode}
              onSelect={() =>
                onChange({
                  mode,
                  // Reset allow-list when leaving 'allow-list' mode so the
                  // gateway has no stale data to evaluate.
                  allowedSenderIds:
                    mode === 'allow-list'
                      ? access.allowedSenderIds.length > 0
                        ? access.allowedSenderIds
                        : workspaceOwners.map((o) => o.userId)
                      : [],
                })
              }
            />
          ))}
        </div>

        {access.mode === 'allow-list' && (
          <div className="border-t border-border/50 px-3 py-2.5">
            <div className="text-xs font-medium">
              {t('settings.messaging.telegram.access.allowedUsersTitle')}
            </div>
            <div className="mt-2 flex flex-col gap-1">
              {workspaceOwners.length === 0 ? (
                <div className="text-xs text-foreground/50">
                  {t('settings.messaging.telegram.access.bindingPopover.noKnownUsers')}
                </div>
              ) : (
                workspaceOwners.map((owner) => {
                  const checked = access.allowedSenderIds.includes(owner.userId)
                  const primary = owner.displayName || owner.username || owner.userId
                  return (
                    <button
                      key={owner.userId}
                      type="button"
                      onClick={() => {
                        const next = checked
                          ? access.allowedSenderIds.filter((id) => id !== owner.userId)
                          : [...access.allowedSenderIds, owner.userId]
                        onChange({ mode: 'allow-list', allowedSenderIds: next })
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
  mode: BindingAccessMode
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
          {t(MODE_LABEL_KEYS[mode])}
          {selected && <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />}
        </div>
        <div className="mt-0.5 text-xs text-foreground/50">
          {t(MODE_DESCRIPTION_KEYS[mode])}
        </div>
      </div>
    </button>
  )
}

function buildTriggerLabel(
  access: BindingAccess,
  workspaceOwnersCount: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (access.mode === 'inherit') {
    return workspaceOwnersCount === 0
      ? t('settings.messaging.telegram.access.bindingPopover.trigger.inheritEmpty')
      : t('settings.messaging.telegram.access.bindingPopover.trigger.inherit', {
          count: workspaceOwnersCount,
        })
  }
  if (access.mode === 'open') {
    return t('settings.messaging.telegram.access.bindingPopover.trigger.open')
  }
  return t('settings.messaging.telegram.access.bindingPopover.trigger.allowList', {
    count: access.allowedSenderIds.length,
  })
}
