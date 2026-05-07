/**
 * Banner shown above the platform tile when `accessMode === 'open'`.
 * Action prompts the user to switch to owner-only and seed the owners
 * list with the senders the gateway has already observed.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  onLockDown: () => void
  /** Optional override of the default copy (e.g. for non-Telegram platforms). */
  description?: string
}

export function AccessModeBanner({ onLockDown, description }: Props) {
  const { t } = useTranslation()
  return (
    <div className="mx-4 my-3 flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          {t('settings.messaging.telegram.access.banner.title')}
        </div>
        <div className="mt-0.5 text-xs text-foreground/60">
          {description ?? t('settings.messaging.telegram.access.banner.description')}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onLockDown}>
        {t('settings.messaging.telegram.access.banner.lockDown')}
      </Button>
    </div>
  )
}
