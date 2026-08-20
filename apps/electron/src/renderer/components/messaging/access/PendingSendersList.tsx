/**
 * "Pending requests" — recent senders the gateway rejected. Renders nothing
 * when the list is empty.
 *
 * The Allow button label depends on the entry's `reason`:
 *  - `'not-owner'` → "Allow" (promotes to workspace owner)
 *  - `'not-on-binding-allowlist'` → "Allow for this chat" (appends to that
 *    binding's allow-list only — does NOT grant workspace ownership)
 *
 * "Ignore" drops the row from the pending list without granting access.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Clock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PendingSender } from './types'

interface Props {
  pending: PendingSender[]
  onAllow: (sender: PendingSender) => void
  onIgnore: (sender: PendingSender) => void
}

export function PendingSendersList({ pending, onAllow, onIgnore }: Props) {
  if (pending.length === 0) return null

  return (
    <div className="divide-y divide-border/50">
      {pending.map((sender) => (
        <PendingRow
          // Composite key — same userId can appear multiple times across
          // different reasons / bindings, so userId alone isn't unique.
          key={`${sender.platform}:${sender.userId}:${sender.reason ?? 'not-owner'}:${sender.bindingId ?? ''}`}
          sender={sender}
          onAllow={() => onAllow(sender)}
          onIgnore={() => onIgnore(sender)}
        />
      ))}
    </div>
  )
}

function PendingRow({
  sender,
  onAllow,
  onIgnore,
}: {
  sender: PendingSender
  onAllow: () => void
  onIgnore: () => void
}) {
  const { t } = useTranslation()
  const primary = sender.displayName || sender.username || sender.userId
  const isBindingScoped = sender.reason === 'not-on-binding-allowlist'
  const allowLabel = isBindingScoped
    ? t('settings.messaging.telegram.access.pending.allowForBinding')
    : t('settings.messaging.telegram.access.pending.allow')

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
        <Clock className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm">{primary}</span>
          {sender.username && (
            <span className="shrink-0 truncate text-xs text-foreground/40">
              @{sender.username}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-foreground/50">
          {t(
            isBindingScoped
              ? 'settings.messaging.telegram.access.pending.audit.notOnBindingAllowlist'
              : 'settings.messaging.telegram.access.pending.audit.notOwner',
            {
              userId: sender.userId,
              defaultValue: isBindingScoped
                ? 'Rejected on this chat. Allow adds this exact sender id to the binding allow-list.'
                : 'Rejected as a workspace non-owner. Allow adds this exact sender id as an owner.',
            },
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onAllow}>
          <Check className="h-3.5 w-3.5" />
          {allowLabel}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onIgnore}
          className="text-foreground/60 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
          {t('settings.messaging.telegram.access.pending.ignore')}
        </Button>
      </div>
    </div>
  )
}
