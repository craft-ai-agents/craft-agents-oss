/**
 * PublishSessionDialog (P4, K-06 §3.5) — Session → Knowledge publication wizard.
 *
 * Four steps: Distill → Target → Review → Done. RPC via window.electronAPI.knowledge
 * publish* / listLinks surface (P4 channels). Writes always go through the P3
 * proposal path: APPLY only creates a proposal; user reviews it in KnowledgeDiff.
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { BookOpen, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Markdown } from '@/components/markdown'
import { useRegisterModal } from '@/context/ModalContext'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import type { ElectronAPI } from '../../../shared/types'
import type { KnowledgeRef } from '@craft-agent/core/knowledge'

// ---------------------------------------------------------------------------
// Wire types (structural — mirror packages/core knowledge publications contract)
// ---------------------------------------------------------------------------

export type PublicationStatus =
  | 'distilling'
  | 'draft'
  | 'target_pending'
  | 'publishing'
  | 'published'
  | 'conflict'
  | 'failed'

export type ExcludeReason =
  | 'credential-like'
  | 'pii'
  | 'raw-transcript'
  | 'unverified-claim'
  | 'internal-id'
  | 'size-cap'

export interface ExcludedFragment {
  reason: ExcludeReason
  excerptHash: string
  origin: 'session' | 'run-artifact' | 'source-block'
}

export interface PublishDraft {
  id: string
  status: PublicationStatus
  sessionId?: string
  runIds: string[]
  connectionId: string
  title: string
  markdown: string
  summary: string
  outline: Array<{ heading: string; blockCount: number }>
  sourceBlocks: string[]
  sourceMessages: Array<{ sessionId: string; messageId: string }>
  excluded: ExcludedFragment[]
  contentHash: string
  model: { connectionSlug: string; modelId: string }
  createdAt: number
  updatedAt: number
  targetNotebookId?: string
  targetPath?: string
  targetDocId?: string
  mode?: 'create' | 'update'
  baseHash?: string
  proposalId?: string
  publicationId?: string
  supersededBy?: string
  lastError?: string
}

export interface PublishPrepareResult {
  mode: 'create' | 'update' | 'adopt-required'
  docId?: string
  baseHash?: string
  existingTitle?: string
}

export interface PublishApplyResult {
  proposalId: string
  status: PublicationStatus
  publicationId?: string
  docRef?: { scheme: string; kind: string; id: string }
}

export interface PublicationRecord {
  id: string
  sessionId?: string
  runId?: string
  draftId: string
  connectionId: string
  targetRef: { scheme: string; kind: string; id: string }
  mode: 'create' | 'update'
  contentHash: string
  proposalId: string
  provenance: {
    source_session_id?: string
    source_run_ids: string[]
    published_at: string
    generated_by: { provider: string; model: string }
    source_blocks: string[]
    content_hash: string
  }
  createdAt: string
}

/** Byte-match ElectronAPI.knowledge publish surface — no local Partial cast. */
export type KnowledgePublishApi = Pick<
  ElectronAPI['knowledge'],
  | 'listConnections'
  | 'publishDistill'
  | 'publishGetDraft'
  | 'publishUpdateDraft'
  | 'publishPrepare'
  | 'publishApply'
  | 'publishFinalize'
  | 'publishList'
  | 'listLinks'
>

export function resolveKnowledgePublishApi(): KnowledgePublishApi | null {
  if (typeof window === 'undefined' || !window.electronAPI?.knowledge) return null
  const api = window.electronAPI.knowledge
  if (typeof api.publishDistill !== 'function') return null
  return api
}

// ---------------------------------------------------------------------------
// Props / steps
// ---------------------------------------------------------------------------

export type PublishStep = 'distill' | 'target' | 'review' | 'done'

export interface PublishSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  connectionId?: string
  runIds?: string[]
}

const STEPS: PublishStep[] = ['distill', 'target', 'review', 'done']

export function PublishSessionDialog({
  open,
  onOpenChange,
  sessionId,
  connectionId: connectionIdProp,
  runIds,
}: PublishSessionDialogProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  useRegisterModal(open, () => onOpenChange(false))

  const [step, setStep] = React.useState<PublishStep>('distill')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [connectionId, setConnectionId] = React.useState<string | undefined>(connectionIdProp)
  const [draft, setDraft] = React.useState<PublishDraft | null>(null)
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const [editMarkdown, setEditMarkdown] = React.useState('')
  const [notebookId, setNotebookId] = React.useState('')
  const [path, setPath] = React.useState('')
  const [prepare, setPrepare] = React.useState<PublishPrepareResult | null>(null)
  const [proposalId, setProposalId] = React.useState<string | null>(null)
  const [docRef, setDocRef] = React.useState<{ kind: string; id: string } | null>(null)

  React.useEffect(() => {
    if (!open) return
    setStep('distill')
    setBusy(false)
    setError(null)
    setDraft(null)
    setEditing(false)
    setEditTitle('')
    setEditMarkdown('')
    setNotebookId('')
    setPath('')
    setPrepare(null)
    setProposalId(null)
    setDocRef(null)
    setConnectionId(connectionIdProp)
  }, [open, sessionId, connectionIdProp])

  React.useEffect(() => {
    if (!open || connectionId) return
    let cancelled = false
    void (async () => {
      try {
        const api = resolveKnowledgePublishApi()
        const listApi =
          api ??
          (window.electronAPI?.knowledge as
            | { listConnections?: () => Promise<Array<{ id: string }>> }
            | undefined)
        const connections = await listApi?.listConnections?.()
        if (cancelled) return
        const first = connections?.[0]?.id
        if (first) setConnectionId(first)
        else setError(t('knowledge.publish.emptyConnections'))
      } catch {
        if (!cancelled) setError(t('knowledge.publish.error.generic'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, connectionId, t])

  const runDistill = React.useCallback(async () => {
    const api = resolveKnowledgePublishApi()
    if (!api || !connectionId) {
      setError(t(api ? 'knowledge.publish.emptyConnections' : 'knowledge.publish.error.generic'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const next = await api.publishDistill({
        connectionId,
        sessionId,
        runIds,
      })
      setDraft(next)
      setEditTitle(next.title)
      setEditMarkdown(next.markdown)
      setEditing(false)
      setStep('distill')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('knowledge.publish.error.generic')
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }, [connectionId, runIds, sessionId, t, workspaceId])

  React.useEffect(() => {
    if (!open || !connectionId || draft || busy) return
    if (error === t('knowledge.publish.emptyConnections')) return
    void runDistill()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connectionId])

  const saveEdits = React.useCallback(async () => {
    if (!draft) return
    const api = resolveKnowledgePublishApi()
    if (!api) {
      setError(t('knowledge.publish.error.generic'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const next = await api.publishUpdateDraft({
        draftId: draft.id,
        connectionId,
        title: editTitle,
        markdown: editMarkdown,
      })
      setDraft(next)
      setEditTitle(next.title)
      setEditMarkdown(next.markdown)
      setEditing(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('knowledge.publish.error.generic')
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }, [connectionId, draft, editMarkdown, editTitle, t, workspaceId])

  const runPrepare = React.useCallback(
    async (adoptExisting = false) => {
      if (!draft) return
      const api = resolveKnowledgePublishApi()
      if (!api || !connectionId) {
        setError(t(api ? 'knowledge.publish.emptyConnections' : 'knowledge.publish.error.generic'))
        return
      }
      const nb = notebookId.trim()
      const p = path.trim()
      if (!nb || !p) {
        setError(t('knowledge.publish.error.generic'))
        return
      }
      setBusy(true)
      setError(null)
      try {
        const result = await api.publishPrepare({
          draftId: draft.id,
          connectionId,
          notebookId: nb,
          path: p,
          adoptExisting,
        })
        setPrepare(result)
        if (result.mode !== 'adopt-required') {
          setStep('review')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : t('knowledge.publish.error.generic')
        setError(message)
        toast.error(message)
      } finally {
        setBusy(false)
      }
    },
    [connectionId, draft, notebookId, path, t, workspaceId],
  )

  const runApply = React.useCallback(async () => {
    if (!draft) return
    const api = resolveKnowledgePublishApi()
    if (!api || !connectionId) {
      setError(t(api ? 'knowledge.publish.emptyConnections' : 'knowledge.publish.error.generic'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api.publishApply({
        draftId: draft.id,
        connectionId,
      })
      setProposalId(result.proposalId)
      if (result.docRef) {
        setDocRef({ kind: result.docRef.kind, id: result.docRef.id })
      }
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              status: result.status,
              proposalId: result.proposalId,
              publicationId: result.publicationId,
            }
          : prev,
      )
      setStep('done')
      if (result.proposalId) {
        navigate(routes.view.proposal(result.proposalId))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('knowledge.publish.error.generic')
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }, [connectionId, draft, navigate, t, workspaceId])

  const runFinalize = React.useCallback(async () => {
    if (!draft || !proposalId) return
    const api = resolveKnowledgePublishApi()
    if (!api || typeof api.publishFinalize !== 'function') {
      setError(t('knowledge.publish.error.generic'))
      return
    }
    const appliedDocRef: KnowledgeRef | undefined = docRef
      ? { scheme: 'siyuan', kind: docRef.kind as KnowledgeRef['kind'], id: docRef.id }
      : draft.targetDocId
        ? { scheme: 'siyuan', kind: 'document', id: draft.targetDocId }
        : undefined
    setBusy(true)
    setError(null)
    try {
      const result = await api.publishFinalize({
        draftId: draft.id,
        proposalId,
        connectionId,
        appliedDocRef,
      })
      const asApply = result as PublishApplyResult
      if (asApply.docRef) {
        setDocRef({ kind: asApply.docRef.kind, id: asApply.docRef.id })
      }
      const asPub = result as unknown as PublicationRecord
      if (asPub.targetRef && !asApply.docRef) {
        setDocRef({ kind: asPub.targetRef.kind, id: asPub.targetRef.id })
      }
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              status: 'published',
              publicationId: asApply.publicationId ?? asPub.id ?? prev.publicationId,
            }
          : prev,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : t('knowledge.publish.error.generic')
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }, [connectionId, docRef, draft, proposalId, t, workspaceId])

  const stepIndex = STEPS.indexOf(step)

  const modeBannerKey =
    prepare?.mode === 'update'
      ? 'knowledge.publish.mode.update'
      : prepare?.mode === 'adopt-required'
        ? 'knowledge.publish.mode.adoptRequired'
        : prepare?.mode === 'create'
          ? 'knowledge.publish.mode.create'
          : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border/60 px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            {t('knowledge.publish.title')}
          </DialogTitle>
          <DialogDescription className="sr-only">{t('knowledge.publish.title')}</DialogDescription>
          <ol className="flex flex-wrap gap-2 pt-2 text-[11px] text-muted-foreground">
            {STEPS.map((s, i) => (
              <li
                key={s}
                className={cn(
                  'rounded-full px-2 py-0.5',
                  i === stepIndex && 'bg-foreground/10 font-medium text-foreground',
                  i < stepIndex && 'text-foreground/70',
                )}
              >
                {i + 1}. {t(`knowledge.publish.step.${s}`)}
              </li>
            ))}
          </ol>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {step === 'distill' && (
            <DistillStep
              busy={busy}
              draft={draft}
              editing={editing}
              editTitle={editTitle}
              editMarkdown={editMarkdown}
              onEditTitle={setEditTitle}
              onEditMarkdown={setEditMarkdown}
              onToggleEdit={() => {
                if (!draft) return
                if (editing) {
                  void saveEdits()
                } else {
                  setEditTitle(draft.title)
                  setEditMarkdown(draft.markdown)
                  setEditing(true)
                }
              }}
              onRedistill={() => void runDistill()}
              t={t}
            />
          )}

          {step === 'target' && (
            <div className="space-y-3">
              {modeBannerKey && (
                <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs">
                  {t(modeBannerKey)}
                  {prepare?.existingTitle ? ` — ${prepare.existingTitle}` : ''}
                </div>
              )}
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('knowledge.publish.field.notebookId')}
                </span>
                <Input
                  value={notebookId}
                  onChange={(e) => setNotebookId(e.target.value)}
                  placeholder={t('knowledge.publish.field.notebookIdPlaceholder')}
                  disabled={busy}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('knowledge.publish.field.path')}
                </span>
                <Input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={t('knowledge.publish.field.pathPlaceholder')}
                  disabled={busy}
                />
              </label>
              {prepare?.mode === 'adopt-required' && (
                <p className="text-xs text-muted-foreground">
                  {t('knowledge.publish.mode.adoptRequired')}
                </p>
              )}
            </div>
          )}

          {step === 'review' && draft && (
            <div className="space-y-3">
              {modeBannerKey && (
                <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs">
                  {t(modeBannerKey)}
                </div>
              )}
              <div>
                <h3 className="text-sm font-semibold">{draft.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{draft.summary}</p>
              </div>
              <div className="max-h-[40vh] overflow-y-auto rounded-md border border-border/60 p-3 text-sm">
                <Markdown mode="minimal">{draft.markdown}</Markdown>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {draft?.status === 'published'
                  ? t('knowledge.publish.step.done')
                  : t('knowledge.publish.done.proposalCreated')}
              </p>
              {proposalId && (
                <button
                  type="button"
                  className="text-left text-accent underline-offset-2 hover:underline"
                  onClick={() => navigate(routes.view.proposal(proposalId))}
                >
                  {proposalId}
                </button>
              )}
              {docRef && (
                <button
                  type="button"
                  className="block text-left text-accent underline-offset-2 hover:underline"
                  onClick={() =>
                    navigate(
                      routes.view.siyuan({
                        kind: docRef.kind as 'document' | 'block' | 'notebook' | 'database' | 'asset',
                        id: docRef.id,
                      }),
                    )
                  }
                >
                  {t('knowledge.publish.publishedTo', {
                    target: `${docRef.kind}/${docRef.id}`,
                  })}
                </button>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border/60 px-6 py-3 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('knowledge.publish.action.close')}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            {step === 'distill' && draft && !editing && (
              <>
                <Button variant="outline" disabled={busy} onClick={() => void runDistill()}>
                  {t('knowledge.publish.action.redistill')}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                  {t('knowledge.publish.action.editDraft')}
                </Button>
                <Button disabled={busy || !draft} onClick={() => setStep('target')}>
                  {t('knowledge.publish.action.prepare')}
                </Button>
              </>
            )}
            {step === 'distill' && editing && (
              <Button disabled={busy} onClick={() => void saveEdits()}>
                {t('knowledge.publish.action.editDraft')}
              </Button>
            )}
            {step === 'target' && (
              <>
                <Button variant="outline" disabled={busy} onClick={() => setStep('distill')}>
                  {t('knowledge.publish.step.distill')}
                </Button>
                {prepare?.mode === 'adopt-required' && (
                  <Button disabled={busy} onClick={() => void runPrepare(true)}>
                    {t('knowledge.publish.action.adopt')}
                  </Button>
                )}
                <Button
                  disabled={busy || !notebookId.trim() || !path.trim()}
                  onClick={() => void runPrepare(false)}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('knowledge.publish.action.prepare')}
                </Button>
              </>
            )}
            {step === 'review' && (
              <>
                <Button variant="outline" disabled={busy} onClick={() => setStep('target')}>
                  {t('knowledge.publish.step.target')}
                </Button>
                <Button disabled={busy} onClick={() => void runApply()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('knowledge.publish.action.apply')}
                </Button>
              </>
            )}
            {step === 'done' && draft?.status !== 'published' && proposalId && (
              <Button disabled={busy} onClick={() => void runFinalize()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('knowledge.publish.action.finalize')}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DistillStep({
  busy,
  draft,
  editing,
  editTitle,
  editMarkdown,
  onEditTitle,
  onEditMarkdown,
  onToggleEdit,
  onRedistill,
  t,
}: {
  busy: boolean
  draft: PublishDraft | null
  editing: boolean
  editTitle: string
  editMarkdown: string
  onEditTitle: (v: string) => void
  onEditMarkdown: (v: string) => void
  onToggleEdit: () => void
  onRedistill: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  if (busy && !draft) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('knowledge.publish.action.distill')}…
      </div>
    )
  }
  if (!draft) {
    return (
      <div className="py-6 text-sm text-muted-foreground">
        <Button variant="outline" onClick={onRedistill}>
          {t('knowledge.publish.action.distill')}
        </Button>
      </div>
    )
  }

  if (editing) {
    return (
      <div className="space-y-3">
        <Input value={editTitle} onChange={(e) => onEditTitle(e.target.value)} disabled={busy} />
        <textarea
          value={editMarkdown}
          onChange={(e) => onEditMarkdown(e.target.value)}
          disabled={busy}
          className="min-h-[240px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button size="sm" variant="secondary" disabled={busy} onClick={onToggleEdit}>
          {t('knowledge.publish.action.editDraft')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{draft.title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{draft.summary}</p>
      </div>
      {draft.outline.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {draft.outline.map((item) => (
            <li key={item.heading}>
              {item.heading}
              <span className="ml-1 tabular-nums opacity-60">({item.blockCount})</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {t('knowledge.publish.excludedCount', { count: draft.excluded.length })}
      </p>
      {draft.excluded.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground/80">
          {draft.excluded.slice(0, 12).map((ex) => (
            <li key={`${ex.reason}-${ex.excerptHash}`}>
              {ex.reason} · {ex.origin} · {ex.excerptHash.slice(0, 8)}…
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
