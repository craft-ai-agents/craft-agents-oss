/**
 * PhaseBadge
 *
 * Colored badge indicating the phase/timing of an automation trigger event.
 * Derives from getEventCategory() to avoid duplicating event classification.
 */

import { getEventCategory, type AutomationTrigger, type EventCategory } from './types'
import { Info_Badge, type BadgeColor } from '@/components/info'
import { useTranslations } from '@/i18n'

const CATEGORY_BADGE: Record<EventCategory, { color: BadgeColor }> = {
  'scheduled':   { color: 'success' },
  'agent-pre':   { color: 'warning' },
  'agent-post':  { color: 'success' },
  'agent-error': { color: 'destructive' },
  'label':       { color: 'default' },
  'permission':  { color: 'default' },
  'flag':        { color: 'default' },
  'todo':        { color: 'default' },
  'session':     { color: 'default' },
  'other':       { color: 'default' },
}

export interface PhaseBadgeProps {
  event: AutomationTrigger
  className?: string
}

export function PhaseBadge({ event, className }: PhaseBadgeProps) {
  const { t } = useTranslations()
  const category = getEventCategory(event)
  const badge = CATEGORY_BADGE[category]

  // 根据分类获取翻译文本
  const getLabel = () => {
    switch (category) {
      case 'scheduled':
        return t('common.scheduled', 'Scheduled')
      case 'agent-pre':
        return t('common.before', 'Before')
      case 'agent-post':
        return t('common.after', 'After')
      case 'agent-error':
        return t('common.onError', 'On Error')
      default:
        return t('common.event', 'Event')
    }
  }

  return (
    <Info_Badge color={badge.color} className={className}>
      {getLabel()}
    </Info_Badge>
  )
}
