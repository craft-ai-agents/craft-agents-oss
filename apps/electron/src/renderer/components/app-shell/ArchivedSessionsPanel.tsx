import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Archive } from 'lucide-react'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { sessionSelection } from '@/hooks/useEntitySelection'
import type { SessionMeta } from '@/atoms/sessions'

export interface ArchivedSessionsPanelProps {
  sessions: SessionMeta[]
  onSessionClick: (session: SessionMeta) => void
  selectedSessionId?: string | null
  className?: string
}

export function ArchivedSessionsPanel({
  sessions,
  onSessionClick,
  selectedSessionId,
  className,
}: ArchivedSessionsPanelProps) {
  const { t } = useTranslation()

  return (
    <EntityPanel<SessionMeta>
      items={sessions}
      getId={(s) => s.id}
      selection={sessionSelection}
      selectedId={selectedSessionId ?? undefined}
      onItemClick={onSessionClick}
      className={className}
      containerProps={{ 'data-list-role': 'archived-sessions' }}
      emptyState={
        <EntityListEmptyScreen
          icon={<Archive />}
          title={t('session.noArchivedSessions')}
          description={t('session.noArchivedSessionsDesc')}
        />
      }
      mapItem={(session) => ({
        title: session.name || session.preview || t('session.defaultTitle'),
      })}
    />
  )
}
