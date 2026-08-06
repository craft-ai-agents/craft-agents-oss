/**
 * Editor for the workspace-level "allowed users" list per platform.
 *
 * The list is the source of truth for who can run pre-binding commands
 * (`/new`, `/bind`) and acts as the default `allowedSenderIds` for any
 * binding whose `mode === 'inherit'`.
 *
 * Designed to render *inside* the collapsible "Allowed users" section in
 * Settings → Messaging — so per-row content is indented with an `IconSpacer`
 * to align with the parent header's text column, mirroring topic rows under
 * a paired supergroup.
 *
 * The "add user" affordance is the pending-requests panel: typing numeric
 * Telegram user_ids by hand is a UX dead-end. Owners promote senders with
 * one click after the gateway records a rejected attempt.
 */

import * as React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PlatformOwner } from './types'

/** Width must match the icon column used by adjacent rows / parent headers. */
const ROW_ICON_SLOT_PX = 22

interface Props {
  owners: PlatformOwner[]
  /** Whether the gateway is gating on this list. When false, the list is shown
   *  as informational and the "Lock down" CTA is the primary action elsewhere. */
  enforced: boolean
  onRemove: (userId: string) => void
  /** Identifies the current user so we can render a "(You)" tag. */
  currentUserId?: string
}

/** 22px-wide invisible spacer keeping rows aligned with the parent header's
 *  text column (no per-row icon, matching the topic-row pattern). */
function IconSpacer() {
  return <div className="shrink-0" style={{ width: ROW_ICON_SLOT_PX, height: ROW_ICON_SLOT_PX }} />
}

export function OwnersListEditor({ owners, enforced, onRemove, currentUserId }: Props) {
  if (owners.length === 0) {
    return (
      <div className="flex items-start gap-3 px-4 py-3 text-xs text-foreground/50">
        <IconSpacer />
        <span>
          <Trans
            i18nKey="settings.messaging.telegram.access.owners.empty"
            components={{
              code: <code className="rounded bg-foreground/[0.06] px-1 py-0.5" />,
            }}
          />
        </span>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border/50">
      {owners.map((owner) => (
        <OwnerRow
          key={owner.userId}
          owner={owner}
          enforced={enforced}
          isCurrentUser={owner.userId === currentUserId}
          onRemove={() => onRemove(owner.userId)}
        />
      ))}
    </div>
  )
}

function OwnerRow({
  owner,
  enforced,
  isCurrentUser,
  onRemove,
}: {
  owner: PlatformOwner
  enforced: boolean
  isCurrentUser: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const primary = owner.displayName || owner.username || owner.userId
  const secondary = [
    owner.username ? `@${owner.username}` : null,
    `id ${owner.userId}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <IconSpacer />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm">{primary}</span>
          {isCurrentUser && (
            <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              {t('settings.messaging.telegram.access.owners.youBadge')}
            </span>
          )}
          {!enforced && (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-foreground/40">
              {t('settings.messaging.telegram.access.owners.notEnforced')}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-foreground/50">{secondary}</div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRemove}
        className="text-foreground/60 hover:text-destructive"
        aria-label={t('settings.messaging.telegram.access.owners.removeAria', { name: primary })}
      >
        <X className="h-3.5 w-3.5" />
        {t('settings.messaging.telegram.access.owners.remove')}
      </Button>
    </div>
  )
}
