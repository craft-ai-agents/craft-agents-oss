/**
 * KnowledgePublicationService — Session → Knowledge publication pipeline (P4 / K-06).
 *
 * Flow: distill → review draft → prepare(target) → apply(propose via bridge) → finalize(after applied).
 * Never auto-approves. Provenance lands as YAML front-matter + craft-* setAttribute ops.
 *
 * Storage: drafts (per-file), publications.jsonl, links.jsonl under {workspaceRoot}/knowledge/.
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  INSERTED_BLOCK_ID_REF,
  PROVENANCE_ATTR,
  buildBodyWithProvenance,
  distillFromMessages,
  hashKnowledgeContent,
  hashMarkdownContent,
  normalizeDocumentPath,
  type CraftRef,
  type DistillMessage,
  type KnowledgeLinkRecord,
  type KnowledgeProvider,
  type KnowledgeRef,
  type MutationInput,
  type MutationOp,
  type PublicationProvenance,
  type PublicationRecord,
  type PublicationStatus,
  type PublishApplyResult,
  type PublishDraft,
  type PublishPrepareResult,
  type SelectionProof,
} from '@craft-agent/core/knowledge'
import type { KnowledgeBridgeService } from './bridge-service'
import { KnowledgePublishDraftsStore } from './drafts-store'
import { KnowledgeLinksStore } from './links-store'
import { KnowledgePublicationsStore } from './publications-store'
import { KnowledgeAuditLog } from './knowledge-audit'
import { bumpKnowledgeMetric } from './metrics-store'

export interface PublicationServiceDeps {
  drafts?: KnowledgePublishDraftsStore
  publications?: KnowledgePublicationsStore
  links?: KnowledgeLinksStore
  audit?: KnowledgeAuditLog
  now?: () => number
}

export interface DistillArgs {
  workspaceRoot: string
  connectionId: string
  sessionId?: string
  runIds?: string[]
  language?: string
  messages?: Array<{ id: string; role: string; content: string }>
  model?: { connectionSlug: string; modelId: string }
}

export interface PrepareArgs {
  workspaceRoot: string
  draftId: string
  notebookId: string
  path: string
  adoptExisting?: boolean
  provider: KnowledgeProvider
}

export interface ApplyArgs {
  workspaceRoot: string
  draftId: string
  provider: KnowledgeProvider
  bridge: KnowledgeBridgeService
  actor: 'user'
}

export interface FinalizeArgs {
  workspaceRoot: string
  draftId: string
  proposalId: string
  /** Doc ref after apply (required for create mode when draft.targetDocId not yet set). */
  appliedDocRef?: KnowledgeRef
}

export interface CommitAfterApplyArgs {
  draftId: string
  proposalId: string
  appliedDocRef: KnowledgeRef
  workspaceRoot: string
}

function storesFor(workspaceRoot: string, deps?: PublicationServiceDeps) {
  return {
    drafts: deps?.drafts ?? new KnowledgePublishDraftsStore(workspaceRoot),
    publications: deps?.publications ?? new KnowledgePublicationsStore(workspaceRoot),
    links: deps?.links ?? new KnowledgeLinksStore(workspaceRoot),
    audit: deps?.audit ?? new KnowledgeAuditLog(workspaceRoot),
  }
}

function requireDraft(drafts: KnowledgePublishDraftsStore, draftId: string): PublishDraft {
  const draft = drafts.get(draftId)
  if (!draft) throw new Error(`Publish draft not found: ${draftId}`)
  return draft
}

function craftRefFor(draft: PublishDraft): CraftRef | null {
  if (draft.sessionId) return { scheme: 'craft', kind: 'session', id: draft.sessionId }
  const runId = draft.runIds[0]
  if (runId) return { scheme: 'craft', kind: 'run', id: runId }
  return null
}

function normalizeTargetPath(path: string): string {
  const normalized = normalizeDocumentPath(path)
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function pathsEqual(a: string, b: string): boolean {
  const na = normalizeTargetPath(a).replace(/\/+$/, '')
  const nb = normalizeTargetPath(b).replace(/\/+$/, '')
  return na === nb || na.endsWith(nb) || nb.endsWith(na)
}

function attrValue(node: { attributes: Array<{ key: string; value: string }> }, key: string): string | undefined {
  return node.attributes.find((a) => a.key === key || a.key === `custom-${key}`)?.value
}

function provenanceFromDraft(draft: PublishDraft, publishedAt: string): PublicationProvenance {
  const provenance: PublicationProvenance = {
    source_run_ids: [...draft.runIds],
    published_at: publishedAt,
    generated_by: { provider: draft.model.connectionSlug, model: draft.model.modelId },
    source_blocks: [...draft.sourceBlocks],
    content_hash: draft.contentHash,
  }
  if (draft.sessionId) provenance.source_session_id = draft.sessionId
  return provenance
}

function buildPublishOps(args: {
  mode: 'create' | 'update'
  draft: PublishDraft
  body: string
  notebookId: string
  path: string
  docId: string
  publishedAt: string
}): { ops: MutationOp[]; targetRef: KnowledgeRef; selectionProofs: SelectionProof[] } {
  const { mode, draft, body, notebookId, path, docId, publishedAt } = args
  const title = draft.title.trim() || 'Untitled'
  const attrTarget = mode === 'create' ? `${INSERTED_BLOCK_ID_REF}[0]` : docId

  const attrOps: MutationOp[] = [
    {
      op: 'setAttribute',
      blockId: attrTarget,
      name: PROVENANCE_ATTR.publishedAt,
      value: publishedAt,
    },
    {
      op: 'setAttribute',
      blockId: attrTarget,
      name: PROVENANCE_ATTR.contentHash,
      value: draft.contentHash,
    },
  ]
  if (draft.sessionId) {
    attrOps.push({
      op: 'setAttribute',
      blockId: attrTarget,
      name: PROVENANCE_ATTR.sourceSessionId,
      value: draft.sessionId,
    })
  }
  if (draft.runIds.length > 0) {
    attrOps.push({
      op: 'setAttribute',
      blockId: attrTarget,
      name: PROVENANCE_ATTR.sourceRunIds,
      value: JSON.stringify(draft.runIds),
    })
  }

  if (mode === 'create') {
    const ops: MutationOp[] = [
      { op: 'createDocument', notebook: notebookId, path, title, markdown: body },
      ...attrOps,
    ]
    return {
      ops,
      targetRef: { scheme: 'siyuan', kind: 'notebook', id: notebookId },
      selectionProofs: [],
    }
  }

  const targetRef: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: docId }
  const proof: SelectionProof = {
    kind: 'surface-selection',
    selectionId: `publish-${draft.id}`,
    ref: { ...targetRef },
    selectedAt: publishedAt,
  }
  const ops: MutationOp[] = [
    { op: 'updateBlock', blockId: docId, markdown: body },
    ...attrOps,
  ]
  return { ops, targetRef, selectionProofs: [proof] }
}

export class KnowledgePublicationService {
  constructor(private readonly deps: PublicationServiceDeps = {}) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  async distill(args: DistillArgs): Promise<PublishDraft> {
    const messages = (args.messages ?? []) as DistillMessage[]
    if (messages.length === 0) {
      throw new Error('distill: messages required (at least one source message)')
    }
    const body = distillFromMessages(messages, {
      sessionId: args.sessionId,
      runIds: args.runIds,
      connectionId: args.connectionId,
      language: args.language,
      model: args.model,
      now: this.now(),
    })
    const draft: PublishDraft = { ...body, status: 'draft' }
    const { drafts } = storesFor(args.workspaceRoot, this.deps)
    drafts.save(draft)
    return draft
  }

  getDraft(workspaceRoot: string, draftId: string): PublishDraft | null {
    const { drafts } = storesFor(workspaceRoot, this.deps)
    return drafts.get(draftId)
  }

  updateDraft(
    workspaceRoot: string,
    draftId: string,
    patch: { title?: string; markdown?: string },
  ): PublishDraft {
    const { drafts } = storesFor(workspaceRoot, this.deps)
    const current = requireDraft(drafts, draftId)
    if (current.status === 'published' || current.status === 'publishing') {
      throw new Error(`updateDraft: cannot edit draft in status '${current.status}'`)
    }
    const markdown = patch.markdown ?? current.markdown
    const title = patch.title ?? current.title
    const next: PublishDraft = {
      ...current,
      title,
      markdown,
      contentHash: hashMarkdownContent(markdown),
      updatedAt: this.now(),
      // editing resets target binding so PREPARE must re-run
      status: current.status === 'target_pending' ? 'draft' : current.status,
      mode: undefined,
      baseHash: undefined,
      targetDocId: current.targetDocId,
      lastError: undefined,
    }
    drafts.save(next)
    return next
  }

  async prepare(args: PrepareArgs): Promise<PublishPrepareResult> {
    const { drafts, links } = storesFor(args.workspaceRoot, this.deps)
    const draft = requireDraft(drafts, args.draftId)
    const path = normalizeTargetPath(args.path)
    const notebookId = args.notebookId

    // Pass 1: bridge link session/run → document (relation published-from)
    const craft = craftRefFor(draft)
    if (craft) {
      const existingLink = links.findPublishedFrom(craft.id)
      if (existingLink && existingLink.knowledgeRef.kind === 'document') {
        let baseHash: string | undefined
        let existingTitle: string | undefined
        try {
          const node = await args.provider.get(existingLink.knowledgeRef)
          baseHash = node.contentHash || undefined
          existingTitle = node.title
          if (!baseHash && node.markdown !== undefined) {
            baseHash = await hashKnowledgeContent(node.markdown ?? '')
          }
        } catch {
          /* target missing — fall through to path resolution */
        }
        if (baseHash !== undefined || existingTitle !== undefined) {
          const updated: PublishDraft = {
            ...draft,
            status: 'target_pending',
            mode: 'update',
            targetNotebookId: notebookId,
            targetPath: path,
            targetDocId: existingLink.knowledgeRef.id,
            baseHash,
            updatedAt: this.now(),
            lastError: undefined,
          }
          drafts.save(updated)
          return {
            mode: 'update',
            docId: existingLink.knowledgeRef.id,
            baseHash,
            existingTitle,
          }
        }
      }
    }

    // Pass 2: document at path — search by pathPrefix within notebook
    const page = await args.provider.search({
      query: '',
      kinds: ['document'],
      notebookId,
      pathPrefix: path,
      limit: 50,
    })
    let matched: { ref: KnowledgeRef; title: string; contentHash: string; attributes: Array<{ key: string; value: string }>; path: string } | null =
      null
    for (const item of page.items) {
      try {
        const node = await args.provider.get(item.ref)
        if (pathsEqual(node.path, path) || node.path === path || node.path.endsWith(path)) {
          matched = {
            ref: node.ref,
            title: node.title,
            contentHash: node.contentHash,
            attributes: node.attributes,
            path: node.path,
          }
          break
        }
      } catch {
        continue
      }
    }
    // Also try direct scan if pathPrefix returned nothing useful: broader notebook search
    if (!matched) {
      const broad = await args.provider.search({
        query: path.split('/').filter(Boolean).pop() ?? '',
        kinds: ['document'],
        notebookId,
        limit: 50,
      })
      for (const item of broad.items) {
        try {
          const node = await args.provider.get(item.ref)
          if (pathsEqual(node.path, path)) {
            matched = {
              ref: node.ref,
              title: node.title,
              contentHash: node.contentHash,
              attributes: node.attributes,
              path: node.path,
            }
            break
          }
        } catch {
          continue
        }
      }
    }


    if (matched) {
      const sessionAttr = attrValue(matched, PROVENANCE_ATTR.sourceSessionId)
      const sameSession = Boolean(draft.sessionId && sessionAttr && sessionAttr === draft.sessionId)

      if (sameSession || args.adoptExisting) {
        let baseHash = matched.contentHash
        if (!baseHash) {
          try {
            const node = await args.provider.get(matched.ref)
            const { hashKnowledgeContent } = await import('@craft-agent/core/knowledge')
            baseHash = await hashKnowledgeContent(node.markdown ?? '')
          } catch {
            baseHash = ''
          }
        }
        const updated: PublishDraft = {
          ...draft,
          status: 'target_pending',
          mode: 'update',
          targetNotebookId: notebookId,
          targetPath: path,
          targetDocId: matched.ref.id,
          baseHash,
          updatedAt: this.now(),
          lastError: undefined,
        }
        drafts.save(updated)
        return {
          mode: 'update',
          docId: matched.ref.id,
          baseHash,
          existingTitle: matched.title,
        }
      }

      // Path occupied without craft provenance → adopt-required (no silent overwrite)
      const updated: PublishDraft = {
        ...draft,
        status: 'target_pending',
        mode: undefined,
        targetNotebookId: notebookId,
        targetPath: path,
        targetDocId: matched.ref.id,
        baseHash: matched.contentHash || undefined,
        updatedAt: this.now(),
        lastError: 'adopt-required',
      }
      drafts.save(updated)
      return {
        mode: 'adopt-required',
        docId: matched.ref.id,
        baseHash: matched.contentHash || undefined,
        existingTitle: matched.title,
      }
    }

    // Create path
    const updated: PublishDraft = {
      ...draft,
      status: 'target_pending',
      mode: 'create',
      targetNotebookId: notebookId,
      targetPath: path,
      targetDocId: undefined,
      baseHash: undefined,
      updatedAt: this.now(),
      lastError: undefined,
    }
    drafts.save(updated)
    return { mode: 'create' }
  }

  async apply(args: ApplyArgs): Promise<PublishApplyResult> {
    const { drafts, publications, links } = storesFor(args.workspaceRoot, this.deps)
    const draft = requireDraft(drafts, args.draftId)

    if (!draft.mode || !draft.targetNotebookId || !draft.targetPath) {
      throw new Error('apply: draft has no prepared target — call prepare first')
    }
    if (draft.mode !== 'create' && draft.mode !== 'update') {
      throw new Error(`apply: invalid mode '${String(draft.mode)}' (adopt-required needs adoptExisting prepare)`)
    }
    if (draft.mode === 'update' && !draft.targetDocId) {
      throw new Error('apply: update mode requires targetDocId from prepare')
    }

    // Idempotency: same contentHash as last publication for this session → return previous
    if (draft.sessionId) {
      const latest = publications.findLatestForSession(draft.sessionId)
      if (latest && latest.contentHash === draft.contentHash) {
        const existing: PublishDraft = {
          ...draft,
          status: 'published',
          proposalId: latest.proposalId,
          publicationId: latest.id,
          targetDocId: latest.targetRef.id,
          updatedAt: this.now(),
        }
        drafts.save(existing)
        return {
          proposalId: latest.proposalId,
          status: 'published',
          publicationId: latest.id,
          docRef: latest.targetRef,
        }
      }
      // Also short-circuit when a published-from link exists and hash matches draft
      const link = links.findPublishedFrom(draft.sessionId)
      if (link && latest && latest.contentHash === draft.contentHash) {
        return {
          proposalId: latest.proposalId,
          status: 'published',
          publicationId: latest.id,
          docRef: link.knowledgeRef,
        }
      }
    }

    const publishedAt = new Date(this.now()).toISOString()
    const provenance = provenanceFromDraft(draft, publishedAt)
    const body = buildBodyWithProvenance(draft.markdown, provenance)
    const path = normalizeTargetPath(draft.targetPath)
    const built = buildPublishOps({
      mode: draft.mode,
      draft,
      body,
      notebookId: draft.targetNotebookId,
      path,
      docId: draft.targetDocId ?? '',
      publishedAt,
    })

    const input: MutationInput = {
      targetRef: built.targetRef,
      ops: built.ops,
      selectionProofs: built.selectionProofs,
      sessionId: draft.sessionId,
      actor: args.actor,
      summary: `Publish: ${draft.title}`,
      baseHash: draft.baseHash,
    }

    try {
      const proposal = await args.bridge.propose({
        connectionId: draft.connectionId,
        input,
      })
      const next: PublishDraft = {
        ...draft,
        status: 'publishing',
        proposalId: proposal.id,
        updatedAt: this.now(),
        lastError: undefined,
      }
      drafts.save(next)
      return {
        proposalId: proposal.id,
        status: 'publishing',
        docRef:
          draft.mode === 'update' && draft.targetDocId
            ? { scheme: 'siyuan', kind: 'document', id: draft.targetDocId }
            : undefined,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failed: PublishDraft = {
        ...draft,
        status: 'failed',
        lastError: message,
        updatedAt: this.now(),
      }
      drafts.save(failed)
      throw error
    }
  }

  /**
   * After the user approved+applied the proposal via P3 UI, commit bridge records.
   * Idempotent on proposalId.
   */
  async finalize(args: FinalizeArgs): Promise<PublishApplyResult> {
    const { drafts, publications, links, audit } = storesFor(args.workspaceRoot, this.deps)
    const draft = requireDraft(drafts, args.draftId)

    // Idempotent: publication already exists for this proposal
    const existing = publications.findByProposalId(args.proposalId)
    if (existing) {
      if (draft.status !== 'published' || draft.publicationId !== existing.id) {
        drafts.save({
          ...draft,
          status: 'published',
          publicationId: existing.id,
          proposalId: args.proposalId,
          targetDocId: existing.targetRef.id,
          updatedAt: this.now(),
        })
      }
      return {
        proposalId: args.proposalId,
        status: 'published',
        publicationId: existing.id,
        docRef: existing.targetRef,
      }
    }

    const docRef: KnowledgeRef =
      args.appliedDocRef ??
      (draft.targetDocId
        ? { scheme: 'siyuan', kind: 'document', id: draft.targetDocId }
        : (() => {
            throw new Error(
              'finalize: appliedDocRef required when draft has no targetDocId (persist proposal.createdRef on apply, or pass appliedDocRef)',
            )
          })())

    const publishedAt = new Date(this.now()).toISOString()
    const provenance = provenanceFromDraft(draft, publishedAt)
    const publicationId = `pub_${randomUUID()}`
    const mode = draft.mode === 'update' ? 'update' : 'create'

    const record: PublicationRecord = {
      id: publicationId,
      draftId: draft.id,
      connectionId: draft.connectionId,
      targetRef: docRef,
      mode,
      contentHash: draft.contentHash,
      proposalId: args.proposalId,
      provenance,
      createdAt: publishedAt,
    }
    if (draft.sessionId) record.sessionId = draft.sessionId
    if (draft.runIds[0]) record.runId = draft.runIds[0]

    publications.append(record)

    // G1 metrics — count successful (non-idempotent) publish finalize.
    bumpKnowledgeMetric(args.workspaceRoot, 'publicationsTotal', 'publications')

    const craft = craftRefFor(draft)
    if (craft) {
      // Avoid duplicate active published-from links for the same craft id
      const prior = links.findPublishedFrom(craft.id)
      if (!prior || prior.knowledgeRef.id !== docRef.id) {
        const link: KnowledgeLinkRecord = {
          id: `link_${randomUUID()}`,
          craftRef: craft,
          knowledgeRef: docRef,
          relation: 'published-from',
          createdAt: publishedAt,
        }
        links.append(link)
      }
    }

    await audit.append({
      actor: 'user',
      action: 'knowledge.publish.applied',
      target: `siyuan://blocks/${docRef.id}`,
      detail: JSON.stringify({
        publicationId,
        proposalId: args.proposalId,
        draftId: draft.id,
        contentHash: draft.contentHash,
        mode,
        sessionId: draft.sessionId,
      }),
    })
    if (craft) {
      await audit.append({
        actor: 'user',
        action: 'knowledge.link.added',
        target: `siyuan://blocks/${docRef.id}`,
        detail: JSON.stringify({ craftId: craft.id, relation: 'published-from', draftId: draft.id }),
      })
    }

    drafts.save({
      ...draft,
      status: 'published',
      publicationId,
      proposalId: args.proposalId,
      targetDocId: docRef.id,
      updatedAt: this.now(),
      lastError: undefined,
    })

    return {
      proposalId: args.proposalId,
      status: 'published',
      publicationId,
      docRef,
    }
  }

  /** Alias used by handlers when client reports applied. */
  async commitAfterApply(args: CommitAfterApplyArgs): Promise<PublishApplyResult> {
    return this.finalize({
      workspaceRoot: args.workspaceRoot,
      draftId: args.draftId,
      proposalId: args.proposalId,
      appliedDocRef: args.appliedDocRef,
    })
  }

  listPublications(
    workspaceRoot: string,
    filter?: { sessionId?: string; runId?: string },
  ): PublicationRecord[] {
    const { publications } = storesFor(workspaceRoot, this.deps)
    return publications.list(filter)
  }

  listLinks(
    workspaceRoot: string,
    filter?: { craftId?: string; knowledgeId?: string },
  ): KnowledgeLinkRecord[] {
    const { links } = storesFor(workspaceRoot, this.deps)
    return links.list(filter)
  }
}

/** Sync sha256 helper for tests/callers that need hex outside distill. */
export function sha256HexSync(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export type { PublicationStatus }
