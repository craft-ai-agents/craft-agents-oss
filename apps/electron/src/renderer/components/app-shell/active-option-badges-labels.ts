import type { TFunction } from 'i18next'
import { resolvePermissionModeCopy } from '@/components/ui/slash-command-permission-mode-labels'

export function getActiveOptionBadgesLabels(t: TFunction) {
  return {
    ultrathink: t('common:slashMenu.ultrathink.label'),
    permissionModes: {
      safe: resolvePermissionModeCopy('safe', t).label,
      ask: resolvePermissionModeCopy('ask', t).label,
      'allow-all': resolvePermissionModeCopy('allow-all', t).label,
    },
  }
}
