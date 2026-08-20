/**
 * KnowledgeDiff (P3, spec 05 K-05 §3.5) — mutation-proposal review/conflict
 * surface, mounted for the `diff/{proposalId}` route (W1 scaffolding).
 *
 * Three faces, driven by the server-owned status machine (T1–T11):
 * - review (draft/pending_review): two columns — Base (`preState` +
 * `baseReadAt`) vs Patch (the T2 unified `diff`, falling back to the ops
 * list); actions: Approve (T3) / Reject (T4).
 * - conflict: three columns — Base vs Current-in-SiYuan
 *   (`conflictInfo.currentContent` + `actualHash`) vs Patch; exactly THREE
 *   actions: «Re-read and rebuild» (T9 rebase), «Discard» (T4), «Open in
 *   SiYuan» (deep-link to the surface). There is deliberately NO
 *   silent-overwrite action (spec §3.4.2, acceptance #10).
 * - terminal/flow states: approved (Apply, T5), applying (status only),
 *   applied (Rollback, T10), rolled_back/superseded (status only).
 */
import { useAtomValue } from 'jotai'
import { Check, ExternalLink, RotateCcw, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MutationOp, MutationProposal, MutationProposalStatus } from '@craft-agent/shared/protocol'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import {
  applyProposalAction,
  approveProposalAction,
  rebaseProposalAction,
  rejectProposalAction,
  rollbackProposalAction,
  resolveKnowledgeMutationsApi,
  type KnowledgeMutationsApi,
  type TranslateFn,
} from './proposal-actions'

/** TTL of an approved proposal server-side (spec 05 §3.7) — UI hint only. */
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000

/** Action ids the KnowledgeDiff footer can render. */
export type KnowledgeDiffActionId =
  | 'approve'
  | 'reject'
  | 'apply'
  | 'rebase'
  | 'discard'
  | 'openInSiyuan'
  | 'rollback'

/**
 * The footer action set per proposal status (spec 05 §3.5). The conflict face
 * offers EXACTLY rebase / discard / openInSiyuan — there is deliberately NO
 * silent-overwrite action (§3.4.2, acceptance #10), and apply exists only on
 * the approved face. The footer below renders by mapping over this list, so
 * the returned ids are the rendered contract that knowledge-diff.test.ts
 * pins (TC-1).
 */
export function conflictActionsFor(status: MutationProposalStatus): KnowledgeDiffActionId[] {
  switch (status) {
    case 'draft':
    case 'pending_review':
      return ['approve', 'reject']
    case 'approved':
      return ['apply']
    case 'conflict':
      return ['rebase', 'discard', 'openInSiyuan']
    case 'applied':
      return ['rollback']
    default:
      // applying / superseded / rolled_back — in-flight or terminal faces
      // carry status, not actions.
      return []
  }
}

export function KnowledgeDiff({ proposalId }: { proposalId: string }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const [proposal, setProposal] = useState<MutationProposal | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'done'>('loading')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const api = resolveKnowledgeMutationsApi()
    if (!api) {
      setState('error')
      return
    }
    try {
      setProposal(await api.getProposal({ proposalId }))
      setState('done')
    } catch {
      setState('error')
    }
  }, [proposalId])

  useEffect(() => {
    setState('loading')
    void reload()
  }, [reload])

  // Live refresh: proposal transitions push knowledge:changed with the
  // target ref (spec K-04 §3.2) — re-read when this proposal's target moves.
  useEffect(() => {
    if (typeof window === 'undefined' || !proposal) return
    const unsubscribe = window.electronAPI?.knowledge?.onChanged?.((payload) => {
      if (payload.ref.id === proposal.targetRef.id) void reload()
    })
    return () => unsubscribe?.()
  }, [reload, proposal])

  const act = useCallback(
    (fn: (api: KnowledgeMutationsApi, tt: TranslateFn) => Promise<boolean>) => {
      const api = resolveKnowledgeMutationsApi()
      if (!api || busy) return
      setBusy(true)
      void (async () => {
        try {
          const ok = await fn(api, t)
          if (ok) await reload()
        } finally {
          setBusy(false)
        }
      })()
    },
    [busy, reload, t],
  )

  if (state === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">{t('knowledge.surface.loading')}</p>
      </div>
    )
  }
  if (state === 'error' || !proposal) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        <p className="text-sm">{t('knowledge.surface.error')}</p>
      </div>
    )
  }

  const approvalExpired =
    proposal.status === 'approved' &&
    proposal.approvedAt !== undefined &&
    Date.now() - Date.parse(proposal.approvedAt) > APPROVAL_TTL_MS

  const patchBody = proposal.diff ? (
    <UnifiedDiffView diff={proposal.diff} />
  ) : (
    <OpsList ops={proposal.ops} />
  )

  /** Renders one footer action id from conflictActionsFor — the ONLY rendering path. */
  const renderAction = (action: KnowledgeDiffActionId) => {
    switch (action) {
      case 'approve':
        return (
          <Button
            key={action}
            size="sm"
            disabled={busy}
            onClick={() =>
              act(async (api, tt) => (await approveProposalAction(api, tt, proposalId)) !== null)
            }
          >
            <Check className="size-3.5" aria-hidden />
            {t('knowledge.diff.approve')}
          </Button>
        )
      case 'reject':
        return (
          <Button
            key={action}
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(async (api, tt) => {
                const ok = await rejectProposalAction(api, tt, proposalId)
                if (ok) navigate(routes.view.knowledge())
                return ok
              })
            }
          >
            <X className="size-3.5" aria-hidden />
            {t('knowledge.diff.reject')}
          </Button>
        )
      case 'apply':
        return (
          <Button
            key={action}
            size="sm"
            disabled={busy}
            onClick={() =>
              act(
                async (api, tt) =>
                  (await applyProposalAction(api, tt, proposalId, workspaceId ?? undefined)) !==
                  null,
              )
            }
          >
            <Check className="size-3.5" aria-hidden />
            {t('knowledge.diff.apply')}
          </Button>
        )
      case 'rebase':
        return (
          <Button
            key={action}
            size="sm"
            disabled={busy}
            onClick={() =>
              act(async (api, tt) => {
                const created = await rebaseProposalAction(api, tt, proposal)
                if (created) navigate(routes.view.proposal(created.id))
                return created !== null
              })
            }
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {t('knowledge.diff.rebase')}
          </Button>
        )
      case 'discard':
        return (
          <Button
            key={action}
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(async (api, tt) => {
                const ok = await rejectProposalAction(api, tt, proposalId)
                if (ok) navigate(routes.view.knowledge())
                return ok
              })
            }
          >
            <X className="size-3.5" aria-hidden />
            {t('knowledge.diff.discard')}
          </Button>
        )
      case 'openInSiyuan':
        return (
          <Button
            key={action}
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              navigate(
                routes.view.siyuan({ kind: proposal.targetRef.kind, id: proposal.targetRef.id }),
              )
            }
          >
            <ExternalLink className="size-3.5" aria-hidden />
            {t('knowledge.diff.openInSiyuan')}
          </Button>
        )
      case 'rollback':
        return (
          <Button
            key={action}
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(async (api, tt) => (await rollbackProposalAction(api, tt, proposalId)) !== null)
            }
          >
            <Undo2 className="size-3.5" aria-hidden />
            {t('knowledge.diff.rollback')}
          </Button>
        )
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">
            {proposal.status === 'conflict'
              ? t('knowledge.diff.conflictTitle')
              : t('knowledge.diff.review')}
          </h2>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
              proposal.status === 'conflict'
                ? 'bg-destructive/15 text-destructive'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {t(`knowledge.proposals.status.${proposal.status}`)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {proposal.targetRef.kind} · {proposal.targetRef.id} ·{' '}
          {new Date(proposal.createdAt).toLocaleString()}
        </p>
        {proposal.status === 'conflict' && (
          <p className="mt-1 text-[12px] leading-snug text-destructive">
            {t('knowledge.diff.conflictBody')}
          </p>
        )}
        {approvalExpired && (
          <p className="mt-1 text-[12px] leading-snug text-destructive">
            {t('knowledge.diff.approvalExpired')}
          </p>
        )}
      </header>

      {proposal.status === 'conflict' ? (
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-2 overflow-hidden p-3">
          <DiffColumn
            title={t('knowledge.diff.base')}
            meta={new Date(proposal.baseReadAt).toLocaleString()}
          >
            <PlainContentView content={proposal.preState} />
          </DiffColumn>
          <DiffColumn
            title={t('knowledge.diff.current')}
            meta={proposal.conflictInfo?.actualHash?.slice(0, 12) ?? undefined}
          >
            <PlainContentView content={proposal.conflictInfo?.currentContent ?? ''} />
          </DiffColumn>
          <DiffColumn title={t('knowledge.diff.patch')}>{patchBody}</DiffColumn>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-hidden p-3">
          <DiffColumn
            title={t('knowledge.diff.base')}
            meta={new Date(proposal.baseReadAt).toLocaleString()}
          >
            <PlainContentView content={proposal.preState} />
          </DiffColumn>
          <DiffColumn title={t('knowledge.diff.patch')}>{patchBody}</DiffColumn>
        </div>
      )}

      <footer className="flex items-center gap-2 border-t border-border px-4 py-2.5">
        {/* The selector owns the action set per status (TC-1 invariant). */}
        {conflictActionsFor(proposal.status).map(renderAction)}
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Presentation pieces
// ---------------------------------------------------------------------------

function DiffColumn({
  title,
  meta,
  children,
}: {
  title: string
  meta?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border">
      <div className="shrink-0 border-b border-border bg-muted/40 px-2.5 py-1.5">
        <div className="truncate text-[12px] font-medium text-foreground/80">{title}</div>
        {meta && <div className="truncate font-mono text-[10px] text-muted-foreground">{meta}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}

function PlainContentView({ content }: { content: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[12px] leading-relaxed text-foreground/80">
      {content}
    </pre>
  )
}

/** Line-colored rendering of the T2 unified diff (`proposal.diff`). */
function UnifiedDiffView({ diff }: { diff: string }) {
  const lines = useMemo(() => diff.split('\n'), [diff])
  return (
    <pre className="px-0 py-1.5 font-mono text-[12px] leading-relaxed">
      {lines.map((line, index) => (
        <div
          // Diff lines have no stable id; index keys are correct for a static render.
          key={index}
          className={cn('whitespace-pre-wrap break-words px-2.5', diffLineClass(line))}
        >
          {line || ' '}
        </div>
      ))}
    </pre>
  )
}

function diffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-muted-foreground'
  if (line.startsWith('+')) return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (line.startsWith('-')) return 'bg-red-500/10 text-red-600 dark:text-red-300'
  if (line.startsWith('@@')) return 'bg-muted/60 text-muted-foreground'
  return 'text-foreground/70'
}

/** Fallback patch presentation when the server record carries no unified diff yet. */
function OpsList({ ops }: { ops: MutationOp[] }) {
  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      {ops.map((op, index) => (
        <div key={index} className="rounded-md border border-border/60">
          <div className="border-b border-border/60 bg-muted/30 px-2 py-1 font-mono text-[11px] text-foreground/70">
            {op.op}
          </div>
          <div className="px-2 py-1.5">
            {op.op === 'setAttribute' ? (
              <code className="break-all font-mono text-[12px] text-foreground/80">
                {op.name} = {op.value}
              </code>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-foreground/80">
                {'markdown' in op ? op.markdown : ''}
              </pre>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
