/**
 * KnowledgeActionExecutor — server-side executor for knowledge automation ops (P6 / K-10).
 *
 * Safety floor (ADR-004 / frozen P6 contract):
 * - ALL SiYuan-touching ops ONLY bridge.propose — NEVER auto-apply from automation.
 * - link_session writes knowledge_links only (Craft-side).
 * - publish_run proposes a createDocument report placeholder with provenance attrs
 *   + review required; never silent publish.
 * - actor on every proposal = 'automation'; audit detail includes automation:<id>.
 * - Loop-safety: reserve after successful propose; bridge consumes at successful apply.
 */

import { randomUUID } from 'node:crypto'
import { isAllowedAttributeName } from '@craft-agent/core/knowledge'
import type {
  CraftRef,
  KnowledgeLinkRelation,
  KnowledgeProvider,
  KnowledgeRef,
  MutationOp,
  SelectionProof,
} from '@craft-agent/core/knowledge'
import type {
  CloudRunSubmitAction,
  KnowledgeActionRef,
  KnowledgeAutomationAction,
  CraftActionRef,
} from '@craft-agent/shared/automations'
import type { KnowledgeBridgeService } from './bridge-service'
import {
  getSharedAutomationLoopGuard,
  type AutomationLoopGuard,
} from './automation-loop-guard'
import { KnowledgeLinksStore } from './links-store'
import { KnowledgeAuditLog } from './knowledge-audit'
import { bumpKnowledgeMetric } from './metrics-store'

/** Result shape frozen in P6 KnowledgeActionExecutor contract. */
export interface KnowledgeActionExecuteResult {
  ok: boolean
  proposalId?: string
  linkId?: string
  error?: string
  /** set_attribute name outside matcher allow-list still proposes but is flagged */
  outsideAllowList?: boolean
}

export interface CloudRunSubmitResult {
  ok: boolean
  runId?: string
  error?: string
}

export interface KnowledgeActionExecuteContext {
  event: string
  payload: Record<string, unknown>
  matcherId?: string
  automationName: string
  workspaceId: string
  workspaceRootPath: string
  env: Record<string, string>
  /** Optional allow-list from matcher; names outside still propose but flag result. */
  attributeAllowList?: string[]
}

export interface KnowledgeActionExecutorDeps {
  /** Resolve bridge for the workspace (memoized by caller). */
  getBridge: (workspaceRoot: string, workspaceId: string) => KnowledgeBridgeService
  /** Resolve provider for a connection (token rotation safe). */
  getProvider?: (connectionId: string) => Promise<KnowledgeProvider>
  /** connectionId for SiYuan ops; falls back to payload.connectionId. */
  resolveConnectionId?: (ctx: KnowledgeActionExecuteContext) => string | undefined
  linksStore?: (workspaceRoot: string) => KnowledgeLinksStore
  audit?: (workspaceRoot: string) => KnowledgeAuditLog
  loopGuard?: AutomationLoopGuard
  now?: () => number
  /**
   * Optional real cloud-run submit. When absent, cloud_run.submit records intent
   * and returns a synthetic runId (callback path).
   */
  submitCloudRun?: (
    action: CloudRunSubmitAction,
    ctx: KnowledgeActionExecuteContext,
  ) => Promise<CloudRunSubmitResult>
}

const LINK_RELATIONS: ReadonlySet<string> = new Set([
  'published-from',
  'context-of',
  'derived-from',
  'reviews',
  'tracked-by',
  // Spec K-10 §3.6 also uses researched-by — map to tracked-by if not in core union.
  'researched-by',
])

function automationActorRef(matcherId: string | undefined, automationName: string): string {
  const id = matcherId && matcherId.length > 0 ? matcherId : automationName || 'unknown'
  return `automation:${id}`
}

function parseKnowledgeRef(value: KnowledgeActionRef | undefined, env: Record<string, string>): KnowledgeRef | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const expanded = expandString(value, env).trim()
    if (!expanded) return null
    // Try JSON object first
    if (expanded.startsWith('{')) {
      try {
        const obj = JSON.parse(expanded) as Record<string, unknown>
        if (typeof obj.id === 'string' && typeof obj.kind === 'string') {
          return {
            scheme: 'siyuan',
            kind: obj.kind as KnowledgeRef['kind'],
            id: obj.id,
            ...(typeof obj.connectionId === 'string' ? { connectionId: obj.connectionId } : {}),
          }
        }
      } catch {
        /* fall through to bare id */
      }
    }
    // Bare id → block (most common automation target)
    return { scheme: 'siyuan', kind: 'block', id: expanded }
  }
  if (typeof value === 'object' && typeof value.id === 'string' && typeof value.kind === 'string') {
    return {
      scheme: 'siyuan',
      kind: value.kind as KnowledgeRef['kind'],
      id: expandString(value.id, env),
      ...(value.connectionId ? { connectionId: expandString(value.connectionId, env) } : {}),
    }
  }
  return null
}

function parseCraftRef(value: CraftActionRef | undefined, env: Record<string, string>): CraftRef | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const expanded = expandString(value, env).trim()
    if (!expanded) return null
    if (expanded.startsWith('{')) {
      try {
        const obj = JSON.parse(expanded) as Record<string, unknown>
        if (typeof obj.id === 'string' && typeof obj.kind === 'string') {
          return {
            scheme: 'craft',
            kind: obj.kind as CraftRef['kind'],
            id: obj.id,
          }
        }
      } catch {
        /* bare id → session */
      }
    }
    return { scheme: 'craft', kind: 'session', id: expanded }
  }
  if (typeof value === 'object' && typeof value.id === 'string' && typeof value.kind === 'string') {
    return {
      scheme: 'craft',
      kind: value.kind as CraftRef['kind'],
      id: expandString(value.id, env),
    }
  }
  return null
}

/** Expand $VAR / ${VAR} using env map (mirrors shared expandEnvVars). */
function expandString(str: string, env: Record<string, string>): string {
  return str
    .replace(/\$\{([^}]+)\}/g, (_, varName: string) => env[varName] ?? '')
    .replace(/\$([A-Z_][A-Z0-9_]*)/gi, (_, varName: string) => env[varName] ?? '')
}

function expandOptional(str: string | undefined, env: Record<string, string>): string | undefined {
  if (str === undefined) return undefined
  return expandString(str, env)
}

function prefixAttributeName(name: string): string {
  if (isAllowedAttributeName(name)) return name
  return `knowledge-${name}`
}

function selectionProof(ref: KnowledgeRef, label: string, nowIso: string): SelectionProof {
  return {
    kind: 'surface-selection',
    selectionId: `automation-${label}-${Date.now()}`,
    ref,
    selectedAt: nowIso,
  }
}

function mapRelation(relation: string | undefined): KnowledgeLinkRelation {
  const r = relation && relation.length > 0 ? relation : 'tracked-by'
  if (r === 'researched-by') return 'tracked-by'
  if (LINK_RELATIONS.has(r) && r !== 'researched-by') {
    return r as KnowledgeLinkRelation
  }
  return 'tracked-by'
}

/**
 * Server KnowledgeActionExecutor implementing the frozen P6 contract.
 * Also handles CloudRunSubmitAction via optional submitCloudRun dep.
 */
export class ServerKnowledgeActionExecutor {
  private readonly loopGuard: AutomationLoopGuard
  private readonly now: () => number

  constructor(private readonly deps: KnowledgeActionExecutorDeps) {
    this.loopGuard = deps.loopGuard ?? getSharedAutomationLoopGuard()
    this.now = deps.now ?? (() => Date.now())
  }

  async execute(
    action: KnowledgeAutomationAction,
    ctx: KnowledgeActionExecuteContext,
  ): Promise<KnowledgeActionExecuteResult> {
    try {
      switch (action.op) {
        case 'create_document':
          return await this.createDocument(action, ctx)
        case 'append_block':
          return await this.appendBlock(action, ctx)
        case 'propose_patch':
          return await this.proposePatch(action, ctx)
        case 'set_attribute':
          return await this.setAttribute(action, ctx)
        case 'link_session':
          return await this.linkSession(action, ctx)
        case 'publish_run':
          return await this.publishRun(action, ctx)
        default: {
          const _exhaustive: never = action.op
          return { ok: false, error: `Unknown knowledge op: ${String(_exhaustive)}` }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  async submitCloudRun(
    action: CloudRunSubmitAction,
    ctx: KnowledgeActionExecuteContext,
  ): Promise<CloudRunSubmitResult> {
    if (this.deps.submitCloudRun) {
      const result = await this.deps.submitCloudRun(action, ctx)
      if (result.ok && result.runId) {
        bumpKnowledgeMetric(ctx.workspaceRootPath, 'automationRunsTriggered')
      }
      return result
    }
    // Record intent only — synthetic run id for callback wiring in tests/v1.
    // Still counts as a triggered automation run for G1 volume (intent path).
    const runId = `run_auto_${randomUUID()}`
    const root = ctx.workspaceRootPath
    const audit = this.deps.audit?.(root) ?? new KnowledgeAuditLog(root)
    await audit.append({
      actor: 'automation',
      action: 'knowledge.automation.cloud_run_submit',
      target: `craft:run/${runId}`,
      detail: JSON.stringify({
        actorRef: automationActorRef(ctx.matcherId, ctx.automationName),
        skillSlug: action.skillSlug,
        topic: action.topic ? expandString(action.topic, ctx.env) : undefined,
        labels: action.labels,
        callbackTag: action.callbackTag ? expandString(action.callbackTag, ctx.env) : undefined,
        intentOnly: true,
      }),
    })
    bumpKnowledgeMetric(root, 'automationRunsTriggered')
    return { ok: true, runId }
  }

  // ── ops ──────────────────────────────────────────────────────────────────

  private resolveConnectionId(ctx: KnowledgeActionExecuteContext): string {
    const fromDep = this.deps.resolveConnectionId?.(ctx)
    if (fromDep) return fromDep
    const p = ctx.payload.connectionId
    if (typeof p === 'string' && p.length > 0) return p
    throw new Error('knowledge automation: connectionId required (payload.connectionId or resolveConnectionId)')
  }

  private async createDocument(
    action: KnowledgeAutomationAction,
    ctx: KnowledgeActionExecuteContext,
  ): Promise<KnowledgeActionExecuteResult> {
    const notebook = expandOptional(action.notebook, ctx.env)
    const path = expandOptional(action.path, ctx.env)
    const markdown = expandOptional(action.markdown, ctx.env) ?? ''
    if (!notebook || !path) {
      return { ok: false, error: 'create_document requires notebook and path' }
    }
    const title =
      path
        .split('/')
        .filter(Boolean)
        .pop()
        ?.replace(/\.md$/i, '') || 'Untitled'
    const connectionId = this.resolveConnectionId(ctx)
    const targetRef: KnowledgeRef = { scheme: 'siyuan', kind: 'notebook', id: notebook }
    const ops: MutationOp[] = [
      { op: 'createDocument', notebook, path, title, markdown },
    ]
    // Optional initial attributes as setAttribute on $insertedBlockId[0] after create —
    // for propose-only we attach them as separate ops with placeholder when supported;
    // v1: include provenance attrs on create via markdown front-matter is enough;
    // attribute ops need a real block id, so we only propose createDocument here.
    if (action.attributes) {
      for (const [rawName, rawValue] of Object.entries(action.attributes)) {
        const name = prefixAttributeName(expandString(rawName, ctx.env))
        const value = expandString(rawValue, ctx.env)
        // createDocument + setAttribute on inserted id is a multi-op pattern used by publication;
        // use $insertedBlockId[0] placeholder when engine supports it.
        ops.push({
          op: 'setAttribute',
          blockId: '$insertedBlockId[0]',
          name,
          value,
        })
      }
    }

    return this.propose(ctx, connectionId, targetRef, ops, [], `automation create_document ${path}`)
  }

  private async appendBlock(
    action: KnowledgeAutomationAction,
    ctx: KnowledgeActionExecuteContext,
  ): Promise<KnowledgeActionExecuteResult> {
    const parent = parseKnowledgeRef(action.parentRef ?? action.targetRef, ctx.env)
    const markdown = expandOptional(action.markdown, ctx.env)
    if (!parent || !markdown) {
      return { ok: false, error: 'append_block requires parentRef/targetRef and markdown' }
    }
    const connectionId = this.resolveConnectionId(ctx)
    // appendBlock documentId is the document id
    const documentId = parent.id
    const targetRef: KnowledgeRef =
      parent.kind === 'document' ? parent : { scheme: 'siyuan', kind: 'document', id: documentId }
    const ops: MutationOp[] = [{ op: 'appendBlock', documentId, markdown }]
    return this.propose(ctx, connectionId, targetRef, ops, [], `automation append_block ${documentId}`)
  }

  private async proposePatch(
    action: KnowledgeAutomationAction,
    ctx: KnowledgeActionExecuteContext,
  ): Promise<KnowledgeActionExecuteResult> {
    const target = parseKnowledgeRef(action.targetRef, ctx.env)
    const markdown = expandOptional(action.patchMarkdown ?? action.markdown, ctx.env)
    if (!target || markdown === undefined) {
      return { ok: false, error: 'propose_patch requires targetRef and patchMarkdown/markdown' }
    }
    // v1 safety: NEVER auto-apply regardless of action.autoApply
    if (action.autoApply === true) {
      // Explicitly ignored — floor is propose-only
    }
    const connectionId = this.resolveConnectionId(ctx)
    const nowIso = new Date(this.now()).toISOString()
    const ops: MutationOp[] = [{ op: 'updateBlock', blockId: target.id, markdown }]
    const proofs = [selectionProof(target, 'propose_patch', nowIso)]
    return this.propose(
      ctx,
      connectionId,
      target,
      ops,
      proofs,
      `automation propose_patch ${target.id}`,
      expandOptional(action.baseHash, ctx.env),
    )
  }

  private async setAttribute(
    action: KnowledgeAutomationAction,
    ctx: KnowledgeActionExecuteContext,
  ): Promise<KnowledgeActionExecuteResult> {
    const target = parseKnowledgeRef(action.targetRef ?? action.knowledgeRef, ctx.env)
    const rawName = expandOptional(action.name, ctx.env)
    const value = expandOptional(action.value, ctx.env)
    if (!target || !rawName || value === undefined) {
      return { ok: false, error: 'set_attribute requires targetRef, name, and value' }
    }
    const attrName = prefixAttributeName(rawName)
    let outsideAllowList = false
    if (ctx.attributeAllowList && ctx.attributeAllowList.length > 0) {
      const bare = rawName.replace(/^knowledge-/, '').replace(/^craft-/, '')
      const allowed = ctx.attributeAllowList.some(
        (a) => a === rawName || a === attrName || a === bare || `knowledge-${a}` === attrName,
      )
      if (!allowed) outsideAllowList = true
    }
    const connectionId = this.resolveConnectionId(ctx)
    const nowIso = new Date(this.now()).toISOString()
    const ops: MutationOp[] = [{ op: 'setAttribute', blockId: target.id, name: attrName, value }]
    const proofs = [selectionProof(target, 'set_attribute', nowIso)]
    const result = await this.propose(
      ctx,
      connectionId,
      target,
      ops,
      proofs,
      `automation set_attribute ${attrName}=${value}`,
    )
    if (result.ok) {
      this.loopGuard.noteWrite({
        connectionId,
        refId: target.id,
        attrName,
        automationId: ctx.matcherId ?? ctx.automationName,
      })
      // Also note bare name for watcher attr keys stripped of knowledge- prefix
      const bare = attrName.startsWith('knowledge-') ? attrName.slice('knowledge-'.length) : attrName
      if (bare !== attrName) {
        this.loopGuard.noteWrite({
          connectionId,
          refId: target.id,
          attrName: bare,
          automationId: ctx.matcherId ?? ctx.automationName,
        })
      }
    }
    return { ...result, outsideAllowList: outsideAllowList || undefined }
  }

  private async linkSession(
    action: KnowledgeAutomationAction,
    ctx: KnowledgeActionExecuteContext,
  ): Promise<KnowledgeActionExecuteResult> {
    const knowledgeRef = parseKnowledgeRef(action.knowledgeRef ?? action.targetRef, ctx.env)
    const craftRef = parseCraftRef(action.craftRef, ctx.env)
    if (!knowledgeRef || !craftRef) {
      return { ok: false, error: 'link_session requires knowledgeRef and craftRef' }
    }
    const relation = mapRelation(expandOptional(action.relation, ctx.env))
    const root = ctx.workspaceRootPath
    const store = this.deps.linksStore?.(root) ?? new KnowledgeLinksStore(root)
    const id = `link_${randomUUID()}`
    const record = store.append({
      id,
      craftRef,
      knowledgeRef,
      relation,
      createdAt: new Date(this.now()).toISOString(),
    })
    const audit = this.deps.audit?.(root) ?? new KnowledgeAuditLog(root)
    await audit.append({
      actor: 'automation',
      action: 'knowledge.link.created',
      target: `knowledge:link/${id}`,
      detail: JSON.stringify({
        actorRef: automationActorRef(ctx.matcherId, ctx.automationName),
        relation,
        craftRef,
        knowledgeRef,
      }),
    })
    return { ok: true, linkId: record.id }
  }

  private async publishRun(
    action: KnowledgeAutomationAction,
    ctx: KnowledgeActionExecuteContext,
  ): Promise<KnowledgeActionExecuteResult> {
    const runId = expandOptional(action.runId, ctx.env)
    const notebook = expandOptional(action.targetNotebook ?? action.notebook, ctx.env) ?? 'Research'
    const targetPath =
      expandOptional(action.targetPath ?? action.path, ctx.env) ?? '/Research/Reports'
    if (!runId) {
      return { ok: false, error: 'publish_run requires runId' }
    }
    // v1: propose createDocument report placeholder with provenance attrs; review required.
    // Never call publication distill with empty messages; never silent publish.
    const slug = runId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)
    const path = targetPath.endsWith(slug)
      ? targetPath
      : `${targetPath.replace(/\/$/, '')}/${slug}`
    const title = `Research report ${runId}`
    const markdown = [
      `# ${title}`,
      '',
      `> Automation-generated publication stub for run \`${runId}\`.`,
      `> Review required before apply (ADR-004).`,
      '',
      `actor: ${automationActorRef(ctx.matcherId, ctx.automationName)}`,
      `review: ${action.review ?? 'required'}`,
      '',
    ].join('\n')

    const connectionId = this.resolveConnectionId(ctx)
    const targetRef: KnowledgeRef = { scheme: 'siyuan', kind: 'notebook', id: notebook }
    const ops: MutationOp[] = [
      { op: 'createDocument', notebook, path, title, markdown },
      {
        op: 'setAttribute',
        blockId: '$insertedBlockId[0]',
        name: 'craft-source-run-ids',
        value: JSON.stringify([runId]),
      },
      {
        op: 'setAttribute',
        blockId: '$insertedBlockId[0]',
        name: 'knowledge-workflow_status',
        value: 'review',
      },
      {
        op: 'setAttribute',
        blockId: '$insertedBlockId[0]',
        name: 'craft-automation-id',
        value: ctx.matcherId ?? ctx.automationName,
      },
    ]
    return this.propose(
      ctx,
      connectionId,
      targetRef,
      ops,
      [],
      `automation publish_run ${runId} (review required)`,
    )
  }

  private async propose(
    ctx: KnowledgeActionExecuteContext,
    connectionId: string,
    targetRef: KnowledgeRef,
    ops: MutationOp[],
    selectionProofs: SelectionProof[],
    summary: string,
    baseHash?: string,
  ): Promise<KnowledgeActionExecuteResult> {
    // Loop-safety: if this automation already wrote this ref recently, suppress.
    const automationId = ctx.matcherId ?? ctx.automationName
    if (
      this.loopGuard.shouldSuppress({
        connectionId,
        refId: targetRef.id,
        automationId,
      })
    ) {
      return { ok: false, error: 'loop-guard: suppressed re-entrant automation write' }
    }

    const bridge = this.deps.getBridge(ctx.workspaceRootPath, ctx.workspaceId)
    const proposal = await bridge.propose({
      connectionId,
      input: {
        targetRef,
        ops,
        selectionProofs: selectionProofs.length > 0 ? selectionProofs : undefined,
        baseHash,
        actor: 'automation',
        sessionId: typeof ctx.payload.sessionId === 'string' ? ctx.payload.sessionId : undefined,
        summary: `${summary} [${automationActorRef(ctx.matcherId, ctx.automationName)}]`,
      },
    })

    this.loopGuard.notePendingWrite(proposal.id, {
      connectionId,
      refId: targetRef.id,
      automationId,
    })

    const audit = this.deps.audit?.(ctx.workspaceRootPath) ?? new KnowledgeAuditLog(ctx.workspaceRootPath)
    await audit.append({
      actor: 'automation',
      action: 'knowledge.automation.proposed',
      target: `knowledge:proposal/${proposal.id}`,
      detail: JSON.stringify({
        actorRef: automationActorRef(ctx.matcherId, ctx.automationName),
        proposalId: proposal.id,
        opSummary: summary,
        targetRef,
      }),
    })

    bumpKnowledgeMetric(ctx.workspaceRootPath, 'automationProposalsTotal', 'automationProposals')

    return { ok: true, proposalId: proposal.id }
  }
}

/**
 * Factory matching KnowledgeActionExecutor interface expected by shared KnowledgeHandler.
 * Importable when P6Shared lands KnowledgeActionExecutor type.
 */
export function createKnowledgeActionExecutor(
  deps: KnowledgeActionExecutorDeps,
): {
  execute: (
    action: KnowledgeAutomationAction,
    ctx: KnowledgeActionExecuteContext,
  ) => Promise<KnowledgeActionExecuteResult>
  submit: (
    action: CloudRunSubmitAction,
    ctx: KnowledgeActionExecuteContext,
  ) => Promise<CloudRunSubmitResult>
} {
  const executor = new ServerKnowledgeActionExecutor(deps)
  return {
    execute: (action, ctx) => executor.execute(action, ctx),
    submit: (action, ctx) => executor.submitCloudRun(action, ctx),
  }
}
