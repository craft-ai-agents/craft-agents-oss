/**
 * SessionPublishedChip (P4, K-06 §3.10) — "Published to: …" line derived from
 * knowledge_links / publications via PUBLISH_LIST. No session-model fields.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom } from 'jotai'
import { BookOpen } from 'lucide-react'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { publishSessionDialogAtom } from '@/atoms/knowledge-publish'
import {
  resolveKnowledgePublishApi,
  type PublicationRecord,
} from './PublishSessionDialog'

export interface SessionPublishedChipProps {
  sessionId: string
  className?: string
}

function labelFor(pub: PublicationRecord): string {
  const ref = pub.targetRef
  return ref?.id ? `${ref.kind}/${ref.id}` : pub.id
}

export function SessionPublishedChip({ sessionId, className }: SessionPublishedChipProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const setPublishDialog = useSetAtom(publishSessionDialogAtom)
  const [pubs, setPubs] = React.useState<PublicationRecord[]>([])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const api = resolveKnowledgePublishApi()
      if (!api || typeof api.publishList !== 'function') {
        if (!cancelled) setPubs([])
        return
      }
      try {
        const listApi =
          api.listConnections ??
          (window.electronAPI?.knowledge as
            | { listConnections?: () => Promise<Array<{ id: string }>> }
            | undefined)?.listConnections
        const connections =
          typeof listApi === 'function' ? await listApi() : ([] as Array<{ id: string }>)
        if (cancelled) return

        if (!Array.isArray(connections) || connections.length === 0) {
          // Fall back without connectionId when none are configured.
          const list = await api.publishList({ sessionId })
          if (!cancelled) setPubs(Array.isArray(list) ? list : [])
          return
        }

        let found: PublicationRecord[] = []
        for (const conn of connections) {
          if (!conn?.id) continue
          const list = await api.publishList({ sessionId, connectionId: conn.id })
          if (cancelled) return
          if (Array.isArray(list) && list.length > 0) {
            found = list
            break
          }
        }
        if (!cancelled) setPubs(found)
      } catch {
        if (!cancelled) setPubs([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  if (pubs.length === 0) return null

  const latest = pubs[pubs.length - 1]!
  const target = labelFor(latest)

  return (
    <div className={cn('flex items-center gap-1.5 text-[11px] text-muted-foreground', className)}>
      <BookOpen className="h-3 w-3 shrink-0" />
      <button
        type="button"
        className="truncate text-left text-accent underline-offset-2 hover:underline"
        title={t('knowledge.publish.publishedTo', { target })}
        onClick={() => {
          if (latest.targetRef?.id) {
            navigate(
              routes.view.siyuan({
                kind: latest.targetRef.kind as 'document' | 'block' | 'notebook' | 'database' | 'asset',
                id: latest.targetRef.id,
              }),
            )
          } else {
            setPublishDialog({ open: true, sessionId })
          }
        }}
      >
        {t('knowledge.publish.publishedTo', { target })}
      </button>
    </div>
  )
}
