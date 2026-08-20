/**
 * KnowledgeProposals (P3, spec 05 K-05) — mutation-proposal list surface:
 * status filter chips over `knowledge:listProposals`, `knowledge:changed`
 * invalidation, click-through to the proposal's diff surface
 * (`routes.view.proposal` → 'diff/{id}', spec §3.5 review/conflict cards).
 *
 * Mounted from KnowledgeHome (proposals section entry), from the bare `diff`
 * route root, and from the KnowledgeNavigator link — prop-less like the rest
 * of the knowledge navigator column pieces.
 */
import { useAtomValue } from 'jotai'
import { FileDiff, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MutationProposal, MutationProposalStatus } from '@craft-agent/shared/protocol'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { EntityList } from '@/components/ui/entity-list'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { resolveKnowledgeMutationsApi } from './proposal-actions'

const PROPOSAL_STATUS_FILTERS: readonly MutationProposalStatus[] = [
  'draft',
  'pending_review',
  'approved',
  'applying',
  'conflict',
  'applied',
  'rolled_back',
  'superseded',
]

export function KnowledgeProposals({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const [proposals, setProposals] = useState<MutationProposal[]>([])
  const [statusFilter, setStatusFilter] = useState<MutationProposalStatus | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'done'>('loading')

  const load = useCallback(async () => {
    const api = resolveKnowledgeMutationsApi()
    if (!api) {
      setProposals([])
      setState('error')
      return
    }
    try {
      const list = await api.listProposals({
        workspaceId: workspaceId ?? undefined,
        status: statusFilter ?? undefined,
      })
      setProposals(list)
      setState('done')
    } catch {
      setState('error')
    }
  }, [workspaceId, statusFilter])

  useEffect(() => {
    setState('loading')
    void load()
  }, [load])

  // knowledge:changed invalidation — proposal transitions push CHANGED with
  // the target ref (spec K-04 §3.2); any change re-reads the current filter.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const unsubscribe = window.electronAPI?.knowledge?.onChanged?.(() => void load())
    return () => unsubscribe?.()
  }, [load])

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex items-center gap-1 overflow-x-auto px-3 pb-2 pt-1">
        {PROPOSAL_STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter((prev) => (prev === s ? null : s))}
            aria-pressed={statusFilter === s}
            className={cn(
              'shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px]',
              'hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              statusFilter === s
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground',
            )}
          >
            {t(`knowledge.proposals.status.${s}`)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
          aria-label={t('common.refresh')}
          className="ml-auto shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className="size-3.5" aria-hidden />
        </button>
      </div>
      <EntityList<MutationProposal>
        className="flex-1"
        items={proposals}
        getKey={(p) => p.id}
        emptyState={
          state === 'loading' ? (
            <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              {t('knowledge.surface.loading')}
            </p>
          ) : state === 'error' ? (
            <p className="px-3 py-6 text-center text-[12px] text-destructive">
              {t('knowledge.surface.error')}
            </p>
          ) : (
            <p className="px-3 py-6 text-center text-[12px] leading-snug text-muted-foreground">
              {t('knowledge.proposals.empty')}
            </p>
          )
        }
        renderItem={(proposal) => (
          <button
            type="button"
            onClick={() => navigate(routes.view.proposal(proposal.id))}
            className={cn(
              'flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left',
              'hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            )}
          >
            <span className="flex items-center gap-2">
              <FileDiff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                {proposal.targetRef.id}
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  proposal.status === 'conflict'
                    ? 'bg-destructive/15 text-destructive'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {t(`knowledge.proposals.status.${proposal.status}`)}
              </span>
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {proposal.ops.map((op) => op.op).join(', ') || proposal.id}
              {' · '}
              {new Date(proposal.createdAt).toLocaleString()}
            </span>
          </button>
        )}
      />
    </div>
  )
}
