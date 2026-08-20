/**
 * Knowledge provider RPC handlers — 9 read channels (P1, spec
 * 2026-08-07-siyuan-integration/03 §§3.2–3.6, storage per spec 04 §3.3) plus
 * 7 write-back mutation-proposal channels (P3, spec 05 05-mutation-safety.md)
 * plus 8 Session→Knowledge publication channels (P4, spec 06) plus 6 P5
 * saved-views / work-envelope channels (K-09 §3.5 / S-08) plus P4.3
 * getExportPayload (Craft chrome copy/export, read-only) plus local Notes
 * import.
 *
 * WRITE-BACK BOUNDARY: HANDLED_CHANNELS below is exactly the 9 spec-03 read
 * channels + getExportPayload + the 7 spec-05 proposal channels + the 8
 * spec-06 publication channels + the 6 P5 view/envelope channels + 2 P6
 * watch channels + migrateNotes. Every mutation channel routes through
 * KnowledgeBridgeService (the spec-05 pipeline: validate → base-hash →
 * draft → diff → review → apply, with inverse-ops rollback) except the
 * user-initiated local Notes import. It writes only to the Markdown Notes
 * store; no knowledge provider, credential, or network access is involved.
 * Publication APPLY only creates a proposal; FINALIZE commits
 * publications/links after the proposal reaches 'applied' via P3 UI.
 * VIEW_SET_ATTRIBUTE also only proposes (never applies).
 *
 * Proposal wiring: one memoized KnowledgeBridgeService per workspace root —
 * proposals/audit are workspace data at {root}/knowledge/{proposals,
 * audit.jsonl} while connections stay global. proposeMutation resolves its
 * workspace from the connection's credentialRef
 * (`source_bearer::{workspaceId}::…`, the same parse as readToken);
 * proposal-id-only channels locate their workspace by scanning
 * getWorkspaces(). The bridge `push` dep fans out as knowledge:changed with
 * {ref, change:'updated'} after created/approved/applied/conflict/
 * rolled_back transitions.
 *
 * Provider wiring: every content channel resolves connectionId → record from
 * KnowledgeConnectionsStore, reads the bearer token via CredentialManager at
 * key `source_bearer::{workspaceId}::{connectionId}` (the record's
 * credentialRef verbatim — no new CredentialType), then obtains the provider
 * through a KnowledgeRegistry ('siyuan' factory → SiyuanKnowledgeProvider,
 * external-local mode only). Registry.connect() re-invokes the factory on
 * every call, so token rotation takes effect without process restart.
 *
 * Errors: domain KnowledgeError codes map 1:1 onto transport CodedError codes
 * (the seven spec-03 §3.2 codes are in the shared ErrorCode union); validation
 * failures throw CodedError directly (INVALID_REF / NOT_FOUND /
 * CONNECTION_UNAVAILABLE), mirroring the notes.ts/marketplace.ts conventions.
 */
import { CodedError, RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type {
  ApplyResult,
  KnowledgeDetectEngineResult,
  KnowledgeEngineStartResult,
  KnowledgeEngineStatus,
  KnowledgeMetricsSnapshot,
  KnowledgeLinkRecord,
  MutationActor,
  MutationInput,
  MutationProposal,
  MutationProposalStatus,
  PublicationRecord,
  PublishApplyResult,
  PublishDraft,
  PublishPrepareResult,
} from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId, getWorkspaces } from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import assertKnowledgeActionAllowed from '@craft-agent/shared/agent/knowledge-permissions'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  createKnowledgeRegistry,
  KnowledgeError,
  MutationValidationError,
  ProposalTransitionError,
  isAllowedAttributeName,
  siyuanDeepLink,
} from '@craft-agent/core/knowledge'
import type {
  ContextMode,
  ContextPayload,
  ContextSnapshot,
  KnowledgeConnection,
  KnowledgeProvider,
  KnowledgeRef,
  KnowledgeWorkEnvelope,
  SearchHit,
  SearchInput,
} from '@craft-agent/core/knowledge'
import {
  buildKnowledgeViewContext,
  compileView,
  evaluateView,
  type ViewConfig,
} from '@craft-agent/shared/views'
import { listViews as listViewsFromStorage } from '@craft-agent/shared/views/storage'
import {
  SiyuanKernelClient,
  SiyuanKnowledgeProvider,
} from '@craft-agent/core/knowledge/providers/siyuan'
import {
  KnowledgeAuditLog,
  KnowledgeConnectionsStore,
  KnowledgeContextSnapshotsStore,
  KnowledgeMutationProposalsStore,
  KnowledgePublicationService,
  KnowledgePublishDraftsStore,
  KnowledgeWorkEnvelopesStore,
  credentialIdFromRef,
  importNotes,
  resolveWorkspaceNotesRoot,
  type MigrateNotesArgs,
  type MigrateNotesResult,
  detectSiyuanEngine,
  ensureDefaultLocalConnection,
  ensureLocalKernel,
  getKernelBootstrapStatus,
  KnowledgeMetricsStore,
  SIYUAN_INSTALL_URL,
  SIYUAN_LOCAL_CONNECTION_ID,
} from '../../knowledge'
import {
  KnowledgeBridgeService,
  type KnowledgeProposalFileRecord,
} from '../../knowledge/bridge-service'
import {
  startKnowledgeWatch,
  stopKnowledgeWatch,
  cleanupKnowledgeWatchForClient,
} from '../../knowledge/change-watcher'
import {
  getKnowledgeBridge,
  registerKnowledgeBridge,
  registerKnowledgeProviderResolver,
} from '../../knowledge/bridge-registry'
import type {
  KnowledgeConnectionRecord,
  KnowledgeConnectionStatus,
  KnowledgeContextSnapshotRecord,
} from '../../knowledge'

/**
 * Тестовый seam (вместо mock.module('@craft-agent/core/knowledge/providers/siyuan')).
 * mock.module — транзитивно-глобален и необратим для модулей, загруженных после
 * мока: он ломал packages/core knowledge adapter-тесты в полном прогоне
 * (19 fails; версия '2.10.0' из их фейка). Хендлер дергает provider/client
 * ТОЛЬКО через эти фактори; тесты ставят свой и возвращают оригинал в afterEach.
 */
type SiyuanKnowledgeProviderCtor = new (options: { connection: KnowledgeConnection; token: string }) => KnowledgeProvider
type SiyuanKernelClientCtor = new (options: { baseUrl: string; token: string }) => Pick<
  SiyuanKernelClient,
  'getVersion' | 'listNotebooks' | 'createDocWithMd' | 'checkBlockExist'
>
let knowledgeProviderCtor: SiyuanKnowledgeProviderCtor = SiyuanKnowledgeProvider as unknown as SiyuanKnowledgeProviderCtor
let siyuanKernelClientCtor: SiyuanKernelClientCtor = SiyuanKernelClient
export function __setKnowledgeTestConstructors(ctor: SiyuanKnowledgeProviderCtor | null, clientCtor?: SiyuanKernelClientCtor | null): void {
  knowledgeProviderCtor = ctor ?? (SiyuanKnowledgeProvider as unknown as SiyuanKnowledgeProviderCtor)
  if (clientCtor !== undefined) {
    siyuanKernelClientCtor = clientCtor ?? SiyuanKernelClient
  }
}

/** When true, registerKnowledgeHandlers skips process-level auto-start watches (tests). */
let skipKnowledgeWatchAutoStart = false
export function __setSkipKnowledgeWatchAutoStart(skip: boolean): void {
  skipKnowledgeWatchAutoStart = skip
}

/** The complete knowledge channel set — 9 P1 read + getExportPayload + ENGINE_STATUS/DETECT/START + METRICS_GET + 7 P3 write-back + 8 P4 publication + 6 P5 views/envelopes + 2 P6 watch + migrateNotes; asserted by knowledge.test.ts. */
export const HANDLED_CHANNELS = [
  RPC_CHANNELS.knowledge.LIST_CONNECTIONS,
  RPC_CHANNELS.knowledge.CAPABILITIES,
  RPC_CHANNELS.knowledge.SEARCH,
  RPC_CHANNELS.knowledge.GET,
  RPC_CHANNELS.knowledge.GET_CONTEXT,
  RPC_CHANNELS.knowledge.GET_BACKLINKS,
  RPC_CHANNELS.knowledge.GET_EXPORT_PAYLOAD,
  RPC_CHANNELS.knowledge.SNAPSHOT_CREATE,
  RPC_CHANNELS.knowledge.SNAPSHOT_GET,
  RPC_CHANNELS.knowledge.ENGINE_STATUS,
  RPC_CHANNELS.knowledge.DETECT_ENGINE,
  RPC_CHANNELS.knowledge.ENGINE_START,
  RPC_CHANNELS.knowledge.METRICS_GET,
  RPC_CHANNELS.knowledge.PROPOSE_MUTATION,
  RPC_CHANNELS.knowledge.APPROVE_PROPOSAL,
  RPC_CHANNELS.knowledge.REJECT_PROPOSAL,
  RPC_CHANNELS.knowledge.APPLY_PROPOSAL,
  RPC_CHANNELS.knowledge.ROLLBACK_PROPOSAL,
  RPC_CHANNELS.knowledge.GET_PROPOSAL,
  RPC_CHANNELS.knowledge.LIST_PROPOSALS,
  // P4 publication pipeline (spec 06)
  RPC_CHANNELS.knowledge.PUBLISH_DISTILL,
  RPC_CHANNELS.knowledge.PUBLISH_GET_DRAFT,
  RPC_CHANNELS.knowledge.PUBLISH_UPDATE_DRAFT,
  RPC_CHANNELS.knowledge.PUBLISH_PREPARE,
  RPC_CHANNELS.knowledge.PUBLISH_APPLY,
  RPC_CHANNELS.knowledge.PUBLISH_FINALIZE,
  RPC_CHANNELS.knowledge.PUBLISH_LIST,
  RPC_CHANNELS.knowledge.LIST_LINKS,
  // P5 saved views + work envelopes (K-09 / S-08)
  RPC_CHANNELS.knowledge.ENVELOPE_GET,
  RPC_CHANNELS.knowledge.ENVELOPE_UPSERT,
  RPC_CHANNELS.knowledge.ENVELOPE_LIST,
  RPC_CHANNELS.knowledge.VIEWS_LIST,
  RPC_CHANNELS.knowledge.VIEW_RUN,
  RPC_CHANNELS.knowledge.VIEW_SET_ATTRIBUTE,
  // P6 change watcher
  RPC_CHANNELS.knowledge.WATCH,
  RPC_CHANNELS.knowledge.UNWATCH,
  // P4.4 Craft notes vault → SiYuan
  RPC_CHANNELS.knowledge.MIGRATE_NOTES,
] as const

// ---------------------------------------------------------------------------
// Wire payload shapes (spec 03 §3.5.1 RPC table)
// ---------------------------------------------------------------------------

export interface KnowledgeConnectionArgs {
  connectionId: string
}

export interface KnowledgeSearchArgs extends KnowledgeConnectionArgs {
  input: SearchInput
}

export interface KnowledgeRefArgs extends KnowledgeConnectionArgs {
  ref: KnowledgeRef
}

export interface KnowledgeGetContextArgs extends KnowledgeRefArgs {
  mode: ContextMode
}

export type KnowledgeExportFormat = 'markdown' | 'deepLink' | 'id' | 'hPath' | 'blockKramdown'

export interface KnowledgeGetExportPayloadArgs extends KnowledgeRefArgs {
  /** Subset of formats to return; default = all applicable. */
  formats?: KnowledgeExportFormat[]
}

export interface KnowledgeExportPayload {
  id: string
  deepLink?: string
  markdown?: string
  hPath?: string
  blockKramdown?: string
  title?: string
}

export interface KnowledgeSnapshotCreateArgs extends KnowledgeConnectionArgs {
  /** Workspace owning {root}/knowledge/snapshots — snapshots are workspace data. */
  workspaceId: string
  ref: KnowledgeRef
  mode?: ContextMode
  /** Owning session — snapshots are session-scoped working artifacts (spec 04 §3.4). */
  sessionId: string
  provenance?: ContextPayload['provenance']
}

export interface KnowledgeSnapshotGetArgs {
  workspaceId: string
  snapshotId: string
}

// ---------------------------------------------------------------------------
// P3 write-back wire shapes (spec 05 §3.5 proposal RPC table)
// ---------------------------------------------------------------------------

export interface KnowledgeProposeMutationArgs extends KnowledgeConnectionArgs {
  /** Wire MutationInput; `actor` rides as an optional extension (agent/automation origins). */
  input: MutationInput & { actor?: MutationActor }
}

export interface KnowledgeProposalArgs {
  proposalId: string
}

export interface KnowledgeApplyProposalArgs extends KnowledgeProposalArgs {
  /** Optional workspace hint — skips the cross-workspace proposal scan. */
  workspaceId?: string
}

export interface KnowledgeListProposalsArgs {
  workspaceId?: string
  connectionId?: string
  status?: MutationProposalStatus
}

// ---------------------------------------------------------------------------
// P4 publication wire shapes (spec 06)
// ---------------------------------------------------------------------------

export interface KnowledgePublishDistillArgs {
  connectionId: string
  sessionId?: string
  runIds?: string[]
  language?: string
  /** Optional override for tests / when session message load is unavailable. */
  messages?: Array<{ id: string; role: string; content: string }>
  model?: { connectionSlug: string; modelId: string }
}

export interface KnowledgePublishDraftArgs {
  draftId: string
  connectionId?: string
}

export interface KnowledgePublishUpdateDraftArgs extends KnowledgePublishDraftArgs {
  title?: string
  markdown?: string
}

export interface KnowledgePublishPrepareArgs {
  draftId: string
  connectionId: string
  notebookId: string
  path: string
  adoptExisting?: boolean
}

export interface KnowledgePublishApplyArgs {
  draftId: string
  connectionId: string
}

export interface KnowledgePublishFinalizeArgs {
  draftId: string
  proposalId: string
  connectionId?: string
  appliedDocRef?: KnowledgeRef
}

export interface KnowledgePublishListArgs {
  connectionId?: string
  sessionId?: string
  runId?: string
}

export interface KnowledgeListLinksArgs {
  connectionId?: string
  craftId?: string
  knowledgeId?: string
}

// ---------------------------------------------------------------------------
// P5 views + work envelopes wire shapes (K-09 / S-08)
// ---------------------------------------------------------------------------

export interface KnowledgeEnvelopeGetArgs {
  connectionId?: string
  ref: KnowledgeRef
}

export interface KnowledgeEnvelopeUpsertArgs {
  connectionId?: string
  envelope: KnowledgeWorkEnvelope
}

export interface KnowledgeEnvelopeListArgs {
  connectionId?: string
}

export interface KnowledgeViewsListArgs {
  connectionId?: string
}

export interface KnowledgeViewRunArgs {
  connectionId: string
  viewId: string
  workspaceId?: string
}

export interface KnowledgeViewSetAttributeArgs {
  connectionId: string
  ref: KnowledgeRef
  name: string
  value: string
}

export interface KnowledgeViewHit extends SearchHit {
  attributes?: Record<string, string>
  topic?: string
}

export interface KnowledgeViewRunResult {
  items: KnowledgeViewHit[]
  view: ViewConfig
}

// ---------------------------------------------------------------------------
// Record ↔ contract mapping
// ---------------------------------------------------------------------------

const CONNECTION_STATUS_MAP: Record<KnowledgeConnectionStatus, KnowledgeConnection['status']> = {
  ok: 'connected',
  failed: 'offline',
  unknown: 'offline',
  needs_auth: 'needs_auth',
}

/** Storage record → contract KnowledgeConnection; credentialRef never crosses the wire. */
function toContractConnection(record: KnowledgeConnectionRecord): KnowledgeConnection {
  return {
    id: record.id,
    provider: record.provider,
    label: record.baseUrl,
    baseUrl: record.baseUrl,
    status: CONNECTION_STATUS_MAP[record.status],
  }
}

function toContextSnapshot(record: KnowledgeContextSnapshotRecord): ContextSnapshot {
  return {
    id: record.id,
    sessionId: record.sessionId,
    provider: record.provider,
    ref: JSON.parse(record.refJson) as KnowledgeRef,
    contentHash: record.contentHash,
    capturedAt: Date.parse(record.capturedAt),
    snapshot: JSON.parse(record.snapshotJson) as ContextPayload,
  }
}

/** Token key lives in the record's credentialRef — parsed once by credentialIdFromRef (knowledge/connections-store). */
function assertContextMode(mode: unknown): asserts mode is ContextMode {
  if (mode !== 'snapshot' && mode !== 'live-reference') {
    throw new Error(`knowledge: invalid context mode '${String(mode)}' (expected 'snapshot' | 'live-reference')`)
  }
}

const KNOWLEDGE_KINDS: Record<string, true> = {
  notebook: true,
  document: true,
  block: true,
  database: true,
  asset: true,
}

function assertKnowledgeRef(ref: unknown): asserts ref is KnowledgeRef {
  const r = ref as KnowledgeRef | null
  if (
    !r ||
    typeof r !== 'object' ||
    r.scheme !== 'siyuan' ||
    typeof r.id !== 'string' ||
    r.id.length === 0 ||
    typeof r.kind !== 'string' ||
    KNOWLEDGE_KINDS[r.kind] !== true
  ) {
    throw new CodedError('INVALID_REF', `knowledge: invalid KnowledgeRef: ${JSON.stringify(ref)}`)
  }
}

export function registerKnowledgeHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger


  // Per-registration registry: factory re-runs on every connect(), picking up
  // the current token from tokensByConnection (set just before connect()).
  const tokensByConnection = new Map<string, string>()
  const registry = createKnowledgeRegistry()
  registry.registerProvider('siyuan', (connection) =>
    new knowledgeProviderCtor({ connection, token: tokensByConnection.get(connection.id) ?? '' }),
  )

  /** Domain KnowledgeError code → transport CodedError with the identical code string. */
  function toTransportError(error: unknown): unknown {
    if (error instanceof KnowledgeError) return new CodedError(error.code, error.message)
    return error
  }

  function requireConnection(connectionId: string) {
    const record = new KnowledgeConnectionsStore().get(connectionId)
    if (!record) throw new CodedError('NOT_FOUND', `Knowledge connection not found: ${connectionId}`)
    return record
  }

  /** Empty string when no credential is stored — tokenless kernels answer fine, authed ones error naturally. */
  async function readToken(record: ReturnType<typeof requireConnection>): Promise<string> {
    const id = credentialIdFromRef(record.credentialRef)
    if (!id) {
      throw new CodedError(
        'CONNECTION_UNAVAILABLE',
        `Knowledge connection '${record.id}' has a malformed credential reference`,
      )
    }
    const credential = await getCredentialManager().get(id)
    return credential?.value ?? ''
  }

  async function resolveProvider(connectionId: string): Promise<KnowledgeProvider> {
    const record = requireConnection(connectionId)
    tokensByConnection.set(record.id, await readToken(record))
    try {
      return await registry.connect(toContractConnection(record))
    } catch (error) {
      throw toTransportError(error)
    }
  }

  async function callProvider<T>(connectionId: string, fn: (provider: KnowledgeProvider) => Promise<T>): Promise<T> {
    try {
      return await fn(await resolveProvider(connectionId))
    } catch (error) {
      throw toTransportError(error)
    }
  }

  function requireWorkspaceRoot(workspaceId: string): string {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new CodedError('NOT_FOUND', `Workspace not found: ${workspaceId}`)
    return workspace.rootPath
  }

  // ——— P3 write-back: one memoized KnowledgeBridgeService per workspace root ———
  // Proposals/audit are workspace data ({root}/knowledge/{proposals,audit.jsonl});
  // providerResolver reuses resolveProvider above so token rotation semantics are
  // identical to the read channels. push fans out as knowledge:changed.
  const bridges = new Map<string, KnowledgeBridgeService>()

  function bridgeFor(rootPath: string, workspaceId: string): KnowledgeBridgeService {
    // Prefer process-wide registry so AutomationSystem and RPC share proposals.
    const existing = getKnowledgeBridge(rootPath)
    if (existing) {
      bridges.set(rootPath, existing)
      return existing
    }
    let bridge = bridges.get(rootPath)
    if (!bridge) {
      bridge = new KnowledgeBridgeService({
        providerResolver: resolveProvider,
        proposalsStore: new KnowledgeMutationProposalsStore(rootPath),
        audit: new KnowledgeAuditLog(rootPath),
        assertAllowed: assertKnowledgeActionAllowed,
        push: (payload) => {
          pushTyped(server, RPC_CHANNELS.knowledge.CHANGED, { to: 'workspace', workspaceId }, payload)
        },
        workspaceId,
      })
      bridges.set(rootPath, bridge)
      registerKnowledgeBridge(rootPath, bridge, resolveProvider)
      registerKnowledgeProviderResolver(rootPath, resolveProvider)
    }
    return bridge
  }

  /** proposeMutations carry no workspaceId: resolve it from the connection's credentialRef. */
  function requireConnectionWorkspaceRoot(record: KnowledgeConnectionRecord): { rootPath: string; workspaceId: string } {
    const credentialId = credentialIdFromRef(record.credentialRef)
    if (credentialId?.workspaceId) {
      const workspace = getWorkspaceByNameOrId(credentialId.workspaceId)
      if (workspace) return { rootPath: workspace.rootPath, workspaceId: workspace.id }
    }
    // Unscoped/malformed credentialRef — single-workspace installs resolve unambiguously.
    const workspaces = getWorkspaces()
    const only = workspaces[0]
    if (workspaces.length === 1 && only) return { rootPath: only.rootPath, workspaceId: only.id }
    throw new CodedError('INVALID_REF', `knowledge: cannot resolve workspace for connection '${record.id}'`)
  }
  /** Proposal-id-only channels: locate the owning workspace by scanning getWorkspaces(). */
  async function locateProposalBridge(proposalId: string): Promise<{
    bridge: KnowledgeBridgeService
    record: KnowledgeProposalFileRecord
    rootPath: string
    workspaceId: string
  }> {
    for (const workspace of getWorkspaces()) {
      const bridge = bridgeFor(workspace.rootPath, workspace.id)
      await bridge.sweepExpired()
      const record = bridge.get(proposalId)
      if (record) {
        return { bridge, record, rootPath: workspace.rootPath, workspaceId: workspace.id }
      }
    }
    throw new CodedError('NOT_FOUND', `Knowledge mutation proposal not found: ${proposalId}`)
  }

  function requireProposalId(args: { proposalId?: unknown } | undefined): string {
    const proposalId = args?.proposalId
    if (typeof proposalId !== 'string' || proposalId.length === 0) {
      throw new Error('knowledge: proposalId must be a non-empty string')
    }
    return proposalId
  }

  /**
   * Engine guard rejections (§3.2 closed table) cross the wire as TYPED errors, never raw
   * engine throws. The common user-facing case: the handler-side pre-sweep demoted an
   * approval-expired proposal to pending_review, so the apply click hits beginApply from
   * pending_review — the correct answer is "approve it again" (informative), not a bare stack.
   */
  async function withProposalTransitions<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      if (error instanceof ProposalTransitionError) {
        const expiryHint =
          error.from === 'pending_review' && error.action === 'beginApply'
            ? ' The proposal is awaiting (re-)approval — an approval TTL (24 h, spec 05 §3.7) sweep may have demoted it; approve it again before applying.'
            : ''
        throw new CodedError(
          'HASH_CONFLICT',
          `knowledge: proposal transition '${error.action}' is not allowed from status '${error.from}'` +
            (error.reason ? ` (${error.reason})` : '') + '.' + expiryHint,
        )
      }
      throw error
    }
  }

  // ——— LIST_CONNECTIONS({}) → KnowledgeConnection[] ———
  // Pure read: local Notes must work before any optional knowledge engine is
  // configured. ENGINE_START is the explicit opt-in that can seed a connection.
  server.handle(RPC_CHANNELS.knowledge.LIST_CONNECTIONS, () =>
    new KnowledgeConnectionsStore().list().map(toContractConnection),
  )

  // ——— CAPABILITIES({connectionId}) → KnowledgeCapabilities ———
  server.handle(RPC_CHANNELS.knowledge.CAPABILITIES, (_ctx, args: KnowledgeConnectionArgs) =>
    callProvider(args.connectionId, (provider) => provider.capabilities()),
  )

  // ——— SEARCH({connectionId, input}) → SearchPage ———
  server.handle(RPC_CHANNELS.knowledge.SEARCH, (_ctx, args: KnowledgeSearchArgs) => {
    if (!args?.input || typeof args.input.query !== 'string') {
      throw new Error('knowledge.search: input.query must be a string')
    }
    return callProvider(args.connectionId, (provider) => provider.search(args.input))
  })

  // ——— GET({connectionId, ref}) → KnowledgeNode ———
  server.handle(RPC_CHANNELS.knowledge.GET, (_ctx, args: KnowledgeRefArgs) => {
    assertKnowledgeRef(args?.ref)
    return callProvider(args.connectionId, (provider) => provider.get(args.ref))
  })

  // ——— GET_CONTEXT({connectionId, ref, mode}) → ContextPayload ———
  server.handle(RPC_CHANNELS.knowledge.GET_CONTEXT, (_ctx, args: KnowledgeGetContextArgs) => {
    assertKnowledgeRef(args?.ref)
    assertContextMode(args.mode)
    return callProvider(args.connectionId, (provider) => provider.getContext(args.ref, args.mode))
  })

  // ——— GET_BACKLINKS({connectionId, ref}) → ContextPayload['backlinks'] ———
  server.handle(RPC_CHANNELS.knowledge.GET_BACKLINKS, async (_ctx, args: KnowledgeRefArgs) => {
    assertKnowledgeRef(args?.ref)
    const payload = await callProvider(args.connectionId, (provider) =>
      provider.getContext(args.ref, 'snapshot'),
    )
    return payload.backlinks
  })

  // ——— GET_EXPORT_PAYLOAD({connectionId, ref, formats?}) → KnowledgeExportPayload ———
  // P4.3 Craft chrome copy/export. Read-only: deep link always; content via provider.get
  // (document/block markdown + path). Does not expand the write whitelist.
  server.handle(
    RPC_CHANNELS.knowledge.GET_EXPORT_PAYLOAD,
    async (_ctx, args: KnowledgeGetExportPayloadArgs): Promise<KnowledgeExportPayload> => {
      if (typeof args?.connectionId !== 'string' || args.connectionId.length === 0) {
        throw new Error('knowledge.getExportPayload: connectionId is required')
      }
      assertKnowledgeRef(args?.ref)
      const ref = args.ref
      const requested = Array.isArray(args.formats) && args.formats.length > 0
        ? args.formats
        : (['markdown', 'deepLink', 'id', 'hPath', 'blockKramdown'] as KnowledgeExportFormat[])
      const want: Record<KnowledgeExportFormat, boolean> = {
        markdown: false,
        deepLink: false,
        id: false,
        hPath: false,
        blockKramdown: false,
      }
      for (const f of requested) {
        if (f in want) want[f] = true
      }

      const payload: KnowledgeExportPayload = { id: ref.id }

      if (want.id) payload.id = ref.id
      if (want.deepLink) {
        payload.deepLink = siyuanDeepLink({
          scheme: 'siyuan',
          kind: ref.kind,
          id: ref.id,
        })
      }

      const needsContent = want.markdown || want.hPath || want.blockKramdown
      // Content formats require a real document/block (not notebook full-surface sentinel).
      const isContentKind = ref.kind === 'document' || ref.kind === 'block'
      const isFullSurface = ref.id === '__full__'

      if (needsContent && isContentKind && !isFullSurface) {
        const node = await callProvider(args.connectionId, (provider) => provider.get(ref))
        if (want.markdown && typeof node.markdown === 'string') {
          payload.markdown = node.markdown
        }
        if (want.hPath && typeof node.path === 'string' && node.path.length > 0) {
          payload.hPath = node.path
        }
        if (want.blockKramdown && ref.kind === 'block' && typeof node.markdown === 'string') {
          payload.blockKramdown = node.markdown
        }
        if (typeof node.title === 'string' && node.title.length > 0) {
          payload.title = node.title
        }
      }

      return payload
    },
  )

  // ——— SNAPSHOT_CREATE({workspaceId, connectionId, ref, mode?, sessionId, provenance?}) → ContextSnapshot ———
  server.handle(RPC_CHANNELS.knowledge.SNAPSHOT_CREATE, async (_ctx, args: KnowledgeSnapshotCreateArgs): Promise<ContextSnapshot> => {
    const rootPath = requireWorkspaceRoot(args.workspaceId)
    assertKnowledgeRef(args?.ref)
    const mode = args.mode ?? 'snapshot'
    assertContextMode(mode)
    if (typeof args.sessionId !== 'string' || args.sessionId.length === 0) {
      throw new Error('knowledge.snapshotCreate: sessionId is required')
    }
    const record = requireConnection(args.connectionId)
    const payload = await callProvider(args.connectionId, (provider) =>
      provider.getContext(args.ref, mode),
    )
    if (args.provenance) payload.provenance = args.provenance
    const stored = new KnowledgeContextSnapshotsStore(rootPath).create({
      sessionId: args.sessionId,
      provider: record.provider,
      ref: args.ref,
      contentHash: payload.contentHash,
      snapshot: payload,
    })
    return toContextSnapshot(stored)
  })

  // ——— SNAPSHOT_GET({workspaceId, snapshotId}) → ContextSnapshot ———
  server.handle(RPC_CHANNELS.knowledge.SNAPSHOT_GET, (_ctx, args: KnowledgeSnapshotGetArgs): ContextSnapshot => {
    const rootPath = requireWorkspaceRoot(args.workspaceId)
    const record = new KnowledgeContextSnapshotsStore(rootPath).get(args.snapshotId)
    if (!record) throw new CodedError('NOT_FOUND', `Knowledge context snapshot not found: ${args.snapshotId}`)
    return toContextSnapshot(record)
  })

  // ——— ENGINE_STATUS({connectionId?}) → KnowledgeEngineStatus (LOCAL_ONLY) ———
  // Probe semantics, not command semantics: an unreachable kernel yields
  // running:false (the channel's answer), never a thrown provider error.
  // connectionId is optional: when omitted (or unknown), still report binary
  // detection + health against the default local base URL.
  server.handle(RPC_CHANNELS.knowledge.ENGINE_STATUS, async (_ctx, args?: Partial<KnowledgeConnectionArgs>): Promise<KnowledgeEngineStatus> => {
    const bootstrap = await getKernelBootstrapStatus({ log: log ?? undefined })
    const extras = {
      binaryFound: bootstrap.binaryFound,
      ...(bootstrap.binaryPath ? { binaryPath: bootstrap.binaryPath } : {}),
      installUrl: bootstrap.installUrl,
      starting: bootstrap.starting,
    }

    const connectionId = typeof args?.connectionId === 'string' && args.connectionId.length > 0
      ? args.connectionId
      : null
    const record = connectionId
      ? new KnowledgeConnectionsStore().get(connectionId)
      : new KnowledgeConnectionsStore().list()[0] ?? null

    if (!record) {
      return {
        mode: 'external-local',
        running: bootstrap.running,
        ...(bootstrap.version ? { version: bootstrap.version } : {}),
        ...extras,
      }
    }

    try {
      // Construction itself may fail (missing token / bad baseUrl) — probe semantics
      // still answer running:false rather than throw a provider error to the wire.
      const token = await readToken(record)
      const client = new siyuanKernelClientCtor({ baseUrl: record.baseUrl, token })
      const version = await client.getVersion()
      return { mode: record.mode, running: true, version, ...extras }
    } catch (error) {
      log?.debug?.(`KNOWLEDGE_ENGINE_STATUS: probe failed for connection ${record.id}: ${String((error as Error)?.message ?? error)}`)
      // Fall back to unauthenticated health probe so "running" still reflects a live kernel
      // even when the token is missing/wrong.
      return {
        mode: record.mode,
        running: bootstrap.running,
        ...(bootstrap.version ? { version: bootstrap.version } : {}),
        ...extras,
      }
    }
  })

  // ——— ENGINE_START({connectionId?, workspaceId?}) → KnowledgeEngineStartResult (LOCAL_ONLY) ———
  // User CTA / explicit start: seed default connection, spawn or open SiYuan if installed.
  server.handle(
    RPC_CHANNELS.knowledge.ENGINE_START,
    async (_ctx, args?: { connectionId?: string; workspaceId?: string }): Promise<KnowledgeEngineStartResult> => {
      const workspaceId =
        typeof args?.workspaceId === 'string' && args.workspaceId.length > 0
          ? args.workspaceId
          : undefined
      // Prefer binding the default connection credential to the active workspace when provided.
      if (workspaceId) {
        const store = new KnowledgeConnectionsStore()
        const existing = store.get(SIYUAN_LOCAL_CONNECTION_ID)
        if (!existing) {
          ensureDefaultLocalConnection(store, { workspaceId })
        }
      }
      const result = await ensureLocalKernel({ log: log ?? undefined })
      return {
        ok: result.ok,
        started: result.started,
        alreadyRunning: result.alreadyRunning,
        method: result.method,
        binaryPath: result.binaryPath,
        baseUrl: result.baseUrl,
        connectionId: result.connectionId,
        ...(result.version ? { version: result.version } : {}),
        ...(result.error ? { error: result.error } : {}),
        installUrl: SIYUAN_INSTALL_URL,
      }
    },
  )

  // ——— DETECT_ENGINE() → KnowledgeDetectEngineResult (LOCAL_ONLY) ———
  // Install-path + default-port probe only. Never downloads or spawns.
  server.handle(RPC_CHANNELS.knowledge.DETECT_ENGINE, async (): Promise<KnowledgeDetectEngineResult> => {
    const result = await detectSiyuanEngine()
    return {
      installed: result.installed,
      runningOnDefaultPort: result.runningOnDefaultPort,
      suggestedBaseUrl: result.suggestedBaseUrl,
      installPathsFound: result.installPathsFound,
      platform: result.platform,
      canOpenApp: result.canOpenApp,
      installDocsUrl: result.installDocsUrl,
    }
  })

  // ——— METRICS_GET({workspaceId?}) → KnowledgeMetricsSnapshot (REMOTE_ELIGIBLE) ———
  server.handle(
    RPC_CHANNELS.knowledge.METRICS_GET,
    async (_ctx, args?: { workspaceId?: string }): Promise<KnowledgeMetricsSnapshot> => {
      const workspaceId =
        typeof args?.workspaceId === 'string' && args.workspaceId.length > 0
          ? args.workspaceId
          : undefined
      let rootPath: string | null = null
      if (workspaceId) {
        rootPath = requireWorkspaceRoot(workspaceId)
      } else {
        const workspaces = getWorkspaces()
        if (workspaces.length === 1 && workspaces[0]) rootPath = workspaces[0].rootPath
      }
      if (!rootPath) {
        // Fail-soft empty snapshot when no workspace context (matches store read semantics).
        return {
          version: 1,
          updatedAt: new Date().toISOString(),
          counters: {
            connectionsActive: 0,
            publicationsTotal: 0,
            publicationsLast7d: 0,
            automationProposalsTotal: 0,
            automationRunsTriggered: 0,
            knowledgeSurfaceOpens: 0,
            viewRunsTotal: 0,
            watchTicksTotal: 0,
          },
          daily: {},
        }
      }
      return new KnowledgeMetricsStore(rootPath).snapshot()
    },
  )

  // -------------------------------------------------------------------------
  // P3 write-back (spec 05) — the mutation-proposal lifecycle. All seven
  // delegate to KnowledgeBridgeService; the bridge owns validation, the
  // permission gate, the state machine, audit and knowledge:changed push.
  // -------------------------------------------------------------------------

  // ——— PROPOSE_MUTATION({connectionId, input}) → MutationProposal ———
  server.handle(RPC_CHANNELS.knowledge.PROPOSE_MUTATION, async (_ctx, args: KnowledgeProposeMutationArgs): Promise<MutationProposal> => {
    const record = requireConnection(args.connectionId)
    const input = args?.input
    if (!input || typeof input !== 'object') {
      throw new CodedError('INVALID_REF', 'knowledge.proposeMutation: input with targetRef and ops is required')
    }
    assertKnowledgeRef(input.targetRef)
    const { rootPath, workspaceId } = requireConnectionWorkspaceRoot(record)
    try {
      return await bridgeFor(rootPath, workspaceId).propose({ connectionId: args.connectionId, input })
    } catch (error) {
      // T1 admission guards reject as MutationValidationError (a plain Error
      // subclass); without this map the transport collapses them into a
      // generic HANDLER_ERROR and the client cannot tell bad input from a crash.
      if (error instanceof MutationValidationError) {
        throw new CodedError('INVALID_REF', `knowledge.proposeMutation: ${error.reason}: ${error.message}`)
      }
      throw toTransportError(error)
    }
  })

  // ——— APPROVE_PROPOSAL({proposalId}) → MutationProposal ———
  server.handle(RPC_CHANNELS.knowledge.APPROVE_PROPOSAL, async (_ctx, args: KnowledgeProposalArgs): Promise<MutationProposal> => {
    const proposalId = requireProposalId(args)
    const { bridge } = await locateProposalBridge(proposalId)
    return withProposalTransitions(() => bridge.approve(proposalId))
  })

  // ——— REJECT_PROPOSAL({proposalId}) → { ok: true } ———
  server.handle(RPC_CHANNELS.knowledge.REJECT_PROPOSAL, async (_ctx, args: KnowledgeProposalArgs): Promise<{ ok: true }> => {
    const proposalId = requireProposalId(args)
    const { bridge } = await locateProposalBridge(proposalId)
    return withProposalTransitions(() => bridge.reject(proposalId))
  })

  // ——— APPLY_PROPOSAL({proposalId, workspaceId?}) → ApplyResult ———
  // After a successful apply, fail-soft auto-finalize any matching publish draft that is
  // still 'publishing' for this proposalId (so UI chip works without a separate finalize hop).
  server.handle(RPC_CHANNELS.knowledge.APPLY_PROPOSAL, async (_ctx, args: KnowledgeApplyProposalArgs): Promise<ApplyResult> => {
    const proposalId = requireProposalId(args)
    let rootPath: string
    let workspaceId: string | undefined
    let bridge: KnowledgeBridgeService
    if (args?.workspaceId) {
      workspaceId = args.workspaceId
      rootPath = requireWorkspaceRoot(workspaceId)
      bridge = bridgeFor(rootPath, workspaceId)
      await bridge.sweepExpired()
      if (!bridge.get(proposalId)) {
        throw new CodedError('NOT_FOUND', `Knowledge mutation proposal not found: ${proposalId}`)
      }
    } else {
      const located = await locateProposalBridge(proposalId)
      bridge = located.bridge
      rootPath = located.rootPath
      workspaceId = located.workspaceId
    }
    const result = await withProposalTransitions(() => bridge.apply(proposalId))
    if ((result.status === 'applied' || result.applied) && rootPath) {
      await tryAutoFinalizePublication({
        rootPath,
        proposalId,
        createdRef: result.createdRef,
        log,
      })
    }
    return result
  })

  // ——— ROLLBACK_PROPOSAL({proposalId}) → ApplyResult ———
  server.handle(RPC_CHANNELS.knowledge.ROLLBACK_PROPOSAL, async (_ctx, args: KnowledgeProposalArgs): Promise<ApplyResult> => {
    const proposalId = requireProposalId(args)
    const { bridge } = await locateProposalBridge(proposalId)
    return withProposalTransitions(() => bridge.rollback(proposalId))
  })

  // ——— GET_PROPOSAL({proposalId}) → MutationProposal ———
  server.handle(RPC_CHANNELS.knowledge.GET_PROPOSAL, async (_ctx, args: KnowledgeProposalArgs): Promise<MutationProposal> => {
    const { record } = await locateProposalBridge(requireProposalId(args))
    return record
  })

  // ——— LIST_PROPOSALS({workspaceId?, connectionId?, status?}) → MutationProposal[] ———
  server.handle(RPC_CHANNELS.knowledge.LIST_PROPOSALS, async (_ctx, args: KnowledgeListProposalsArgs = {}): Promise<MutationProposal[]> => {
    const roots = args.workspaceId
      ? [{ workspaceId: args.workspaceId, rootPath: requireWorkspaceRoot(args.workspaceId) }]
      : getWorkspaces().map((workspace) => ({ workspaceId: workspace.id, rootPath: workspace.rootPath }))
    const proposals: MutationProposal[] = []
    for (const { workspaceId, rootPath } of roots) {
      const bridge = bridgeFor(rootPath, workspaceId)
      await bridge.sweepExpired()
      proposals.push(...bridge.list({ status: args.status, connectionId: args.connectionId }))
    }
    return proposals
  })

  // -------------------------------------------------------------------------
  // P4 publication pipeline (spec 06) — distill → prepare → apply(propose) →
  // finalize. Drafts/publications/links live under {workspaceRoot}/knowledge/.
  // -------------------------------------------------------------------------
  const publications = new KnowledgePublicationService()

  /**
   * Fail-soft: after APPLY_PROPOSAL succeeds, finalize any matching draft still in
   * 'publishing' for this proposalId. Never throws into the apply response.
   */
  async function tryAutoFinalizePublication(args: {
    rootPath: string
    proposalId: string
    createdRef?: KnowledgeRef
    log: { debug: (...a: unknown[]) => void; warn: (...a: unknown[]) => void }
  }): Promise<void> {
    try {
      const drafts = new KnowledgePublishDraftsStore(args.rootPath)
      const match = drafts.list({ status: 'publishing' }).find((d) => d.proposalId === args.proposalId)
      if (!match) return
      const appliedDocRef =
        args.createdRef ??
        (match.targetDocId
          ? { scheme: 'siyuan' as const, kind: 'document' as const, id: match.targetDocId }
          : undefined)
      await publications.finalize({
        workspaceRoot: args.rootPath,
        draftId: match.id,
        proposalId: args.proposalId,
        appliedDocRef,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      args.log.debug(
        `knowledge.applyProposal: auto-finalize failed for proposal ${args.proposalId} (user can retry finalize): ${message}`,
      )
    }
  }

  /** Map plain service Errors (P4 service throws Error, not KnowledgeError) onto CodedError. */
  function toPublishError(error: unknown, prefix: string): unknown {
    if (error instanceof CodedError || error instanceof KnowledgeError) return toTransportError(error)
    if (error instanceof MutationValidationError) {
      return new CodedError('INVALID_REF', `${prefix}: ${error.reason}: ${error.message}`)
    }
    if (error instanceof Error) {
      const msg = error.message
      if (/not found/i.test(msg)) return new CodedError('NOT_FOUND', `${prefix}: ${msg}`)
      if (/cannot edit|expected 'applied'|status is|already/i.test(msg)) {
        return new CodedError('HASH_CONFLICT', `${prefix}: ${msg}`)
      }
      return new CodedError('INVALID_REF', `${prefix}: ${msg}`)
    }
    return error
  }

  async function loadSessionMessages(
    sessionId: string | undefined,
  ): Promise<Array<{ id: string; role: string; content: string }> | undefined> {
    if (!sessionId) return undefined
    try {
      const session = await deps.sessionManager.getSession?.(sessionId)
      const raw = (session as { messages?: Array<Record<string, unknown>> } | null)?.messages
      if (!Array.isArray(raw)) return undefined
      return raw.map((m, index) => {
        const id = typeof m.id === 'string' ? m.id : `msg_${index}`
        // StoredMessage uses `type` for role; runtime Message may use `role`.
        const role = typeof m.role === 'string' ? m.role : typeof m.type === 'string' ? m.type : 'unknown'
        const content = typeof m.content === 'string' ? m.content : ''
        return { id, role, content }
      })
    } catch {
      return undefined
    }
  }

  function resolvePublishWorkspace(connectionId: string | undefined): {
    rootPath: string
    workspaceId: string
    record?: KnowledgeConnectionRecord
  } {
    if (connectionId) {
      const record = requireConnection(connectionId)
      const ws = requireConnectionWorkspaceRoot(record)
      return { ...ws, record }
    }
    const workspaces = getWorkspaces()
    const only = workspaces[0]
    if (workspaces.length === 1 && only) return { rootPath: only.rootPath, workspaceId: only.id }
    throw new CodedError('INVALID_REF', 'knowledge.publish: connectionId is required to resolve workspace')
  }

  // ——— PUBLISH_DISTILL({connectionId, sessionId?, runIds?, messages?, model?}) → PublishDraft ———
  server.handle(RPC_CHANNELS.knowledge.PUBLISH_DISTILL, async (_ctx, args: KnowledgePublishDistillArgs): Promise<PublishDraft> => {
    if (!args?.connectionId || typeof args.connectionId !== 'string') {
      throw new CodedError('INVALID_REF', 'knowledge.publishDistill: connectionId is required')
    }
    const record = requireConnection(args.connectionId)
    const { rootPath } = requireConnectionWorkspaceRoot(record)
    let messages = args.messages
    if (!messages?.length && args.sessionId) {
      messages = await loadSessionMessages(args.sessionId)
    }
    try {
      return await publications.distill({
        workspaceRoot: rootPath,
        connectionId: args.connectionId,
        sessionId: args.sessionId,
        runIds: args.runIds,
        language: args.language,
        messages,
        model: args.model,
      })
    } catch (error) {
      throw toPublishError(error, 'knowledge.publishDistill')
    }
  })

  // ——— PUBLISH_GET_DRAFT({draftId, connectionId?}) → PublishDraft | null ———
  server.handle(RPC_CHANNELS.knowledge.PUBLISH_GET_DRAFT, (_ctx, args: KnowledgePublishDraftArgs): PublishDraft | null => {
    if (typeof args?.draftId !== 'string' || args.draftId.length === 0) {
      throw new CodedError('INVALID_REF', 'knowledge.publishGetDraft: draftId is required')
    }
    const { rootPath } = resolvePublishWorkspace(args.connectionId)
    return publications.getDraft(rootPath, args.draftId)
  })

  // ——— PUBLISH_UPDATE_DRAFT({draftId, title?, markdown?, connectionId?}) → PublishDraft ———
  server.handle(RPC_CHANNELS.knowledge.PUBLISH_UPDATE_DRAFT, (_ctx, args: KnowledgePublishUpdateDraftArgs): PublishDraft => {
    if (typeof args?.draftId !== 'string' || args.draftId.length === 0) {
      throw new CodedError('INVALID_REF', 'knowledge.publishUpdateDraft: draftId is required')
    }
    const { rootPath } = resolvePublishWorkspace(args.connectionId)
    try {
      return publications.updateDraft(rootPath, args.draftId, {
        title: args.title,
        markdown: args.markdown,
      })
    } catch (error) {
      throw toPublishError(error, 'knowledge.publishUpdateDraft')
    }
  })

  // ——— PUBLISH_PREPARE({draftId, connectionId, notebookId, path, adoptExisting?}) → PublishPrepareResult ———
  server.handle(RPC_CHANNELS.knowledge.PUBLISH_PREPARE, async (_ctx, args: KnowledgePublishPrepareArgs): Promise<PublishPrepareResult> => {
    if (!args?.connectionId || typeof args.draftId !== 'string') {
      throw new CodedError('INVALID_REF', 'knowledge.publishPrepare: connectionId and draftId are required')
    }
    if (typeof args.notebookId !== 'string' || typeof args.path !== 'string') {
      throw new CodedError('INVALID_REF', 'knowledge.publishPrepare: notebookId and path are required')
    }
    const record = requireConnection(args.connectionId)
    const { rootPath } = requireConnectionWorkspaceRoot(record)
    const provider = await resolveProvider(args.connectionId)
    try {
      return await publications.prepare({
        workspaceRoot: rootPath,
        draftId: args.draftId,
        notebookId: args.notebookId,
        path: args.path,
        adoptExisting: args.adoptExisting,
        provider,
      })
    } catch (error) {
      throw toPublishError(error, 'knowledge.publishPrepare')
    }
  })

  // ——— PUBLISH_APPLY({draftId, connectionId}) → PublishApplyResult ———
  server.handle(RPC_CHANNELS.knowledge.PUBLISH_APPLY, async (_ctx, args: KnowledgePublishApplyArgs): Promise<PublishApplyResult> => {
    if (!args?.connectionId || typeof args.draftId !== 'string') {
      throw new CodedError('INVALID_REF', 'knowledge.publishApply: connectionId and draftId are required')
    }
    const record = requireConnection(args.connectionId)
    const { rootPath, workspaceId } = requireConnectionWorkspaceRoot(record)
    const provider = await resolveProvider(args.connectionId)
    const bridge = bridgeFor(rootPath, workspaceId)
    try {
      return await publications.apply({
        workspaceRoot: rootPath,
        draftId: args.draftId,
        provider,
        bridge,
        actor: 'user',
      })
    } catch (error) {
      throw toPublishError(error, 'knowledge.publishApply')
    }
  })

  // ——— PUBLISH_FINALIZE({draftId, proposalId, connectionId?, appliedDocRef?}) → PublishApplyResult ———
  server.handle(RPC_CHANNELS.knowledge.PUBLISH_FINALIZE, async (_ctx, args: KnowledgePublishFinalizeArgs): Promise<PublishApplyResult> => {
    if (typeof args?.draftId !== 'string' || typeof args?.proposalId !== 'string') {
      throw new CodedError('INVALID_REF', 'knowledge.publishFinalize: draftId and proposalId are required')
    }
    let rootPath: string
    let workspaceId: string | undefined
    if (args.connectionId) {
      const record = requireConnection(args.connectionId)
      ;({ rootPath, workspaceId } = requireConnectionWorkspaceRoot(record))
    } else {
      // Prefer single-workspace install; otherwise require connectionId.
      const workspaces = getWorkspaces()
      const only = workspaces[0]
      if (workspaces.length === 1 && only) {
        rootPath = only.rootPath
        workspaceId = only.id
      } else {
        // Best-effort: scan workspaces for a draft file via publication service.
        const hit = workspaces.find((ws) => publications.getDraft(ws.rootPath, args.draftId) != null)
        if (!hit) {
          throw new CodedError(
            'INVALID_REF',
            'knowledge.publishFinalize: connectionId is required when multiple workspaces are present',
          )
        }
        rootPath = hit.rootPath
        workspaceId = hit.id
      }
    }

    // Contract: finalize only after P3 apply — proposal must be 'applied'.
    // Prefer stored proposal.createdRef so create-mode finalize works after reload without UI appliedDocRef.
    let appliedDocRef = args.appliedDocRef
    if (workspaceId) {
      const bridge = bridgeFor(rootPath, workspaceId)
      await bridge.sweepExpired()
      const proposal = bridge.get(args.proposalId)
      if (!proposal) {
        throw new CodedError('NOT_FOUND', `Knowledge mutation proposal not found: ${args.proposalId}`)
      }
      if (proposal.status !== 'applied') {
        throw new CodedError(
          'HASH_CONFLICT',
          `knowledge.publishFinalize: proposal '${args.proposalId}' status is '${proposal.status}', expected 'applied'`,
        )
      }
      const draft = publications.getDraft(rootPath, args.draftId)
      appliedDocRef =
        args.appliedDocRef ??
        proposal.createdRef ??
        (draft?.targetDocId
          ? { scheme: 'siyuan', kind: 'document', id: draft.targetDocId }
          : undefined)
    }

    try {
      return await publications.finalize({
        workspaceRoot: rootPath,
        draftId: args.draftId,
        proposalId: args.proposalId,
        appliedDocRef,
      })
    } catch (error) {
      throw toPublishError(error, 'knowledge.publishFinalize')
    }
  })

  // ——— PUBLISH_LIST({connectionId?, sessionId?, runId?}) → PublicationRecord[] ———
  server.handle(RPC_CHANNELS.knowledge.PUBLISH_LIST, (_ctx, args: KnowledgePublishListArgs = {}): PublicationRecord[] => {
    const { rootPath } = resolvePublishWorkspace(args.connectionId)
    return publications.listPublications(rootPath, {
      sessionId: args.sessionId,
      runId: args.runId,
    })
  })

  // ——— LIST_LINKS({connectionId?, craftId?, knowledgeId?}) → KnowledgeLinkRecord[] ———
  server.handle(RPC_CHANNELS.knowledge.LIST_LINKS, (_ctx, args: KnowledgeListLinksArgs = {}): KnowledgeLinkRecord[] => {
    const { rootPath } = resolvePublishWorkspace(args.connectionId)
    return publications.listLinks(rootPath, {
      craftId: args.craftId,
      knowledgeId: args.knowledgeId,
    })
  })

  // -------------------------------------------------------------------------
  // P5 saved knowledge views + work envelopes (K-09 §3.5 / S-08)
  // -------------------------------------------------------------------------

  function envelopesStoreFor(connectionId?: string): KnowledgeWorkEnvelopesStore {
    const { rootPath } = resolvePublishWorkspace(connectionId)
    return new KnowledgeWorkEnvelopesStore(rootPath)
  }

  function resolveViewsWorkspace(args: {
    connectionId?: string
    workspaceId?: string
  }): { rootPath: string; workspaceId: string } {
    if (args.workspaceId) {
      return { rootPath: requireWorkspaceRoot(args.workspaceId), workspaceId: args.workspaceId }
    }
    if (args.connectionId) {
      const record = requireConnection(args.connectionId)
      return requireConnectionWorkspaceRoot(record)
    }
    return resolvePublishWorkspace(undefined)
  }

  /**
   * Compile knowledgeFilter → SearchInput.
   * notebook name hint becomes pathPrefix '/{notebook}' unless it looks like a raw id.
   */
  function searchInputFromKnowledgeFilter(
    filter: NonNullable<ViewConfig['knowledgeFilter']> | undefined,
  ): SearchInput {
    const input: SearchInput = { query: filter?.query ?? '' }
    if (filter?.kinds?.length) input.kinds = filter.kinds
    if (filter?.attributes && Object.keys(filter.attributes).length > 0) {
      input.attributes = { ...filter.attributes }
    }
    if (filter?.pathPrefix) {
      input.pathPrefix = filter.pathPrefix
    } else if (filter?.notebookId) {
      input.notebookId = filter.notebookId
    } else if (filter?.notebook) {
      // Heuristic: bare alnum/hyphen ids without slash → notebookId; else pathPrefix.
      if (/^[a-zA-Z0-9_-]+$/.test(filter.notebook) && !filter.notebook.includes('/')) {
        // Prefer pathPrefix by notebook name for human defaults ("Research");
        // only treat as notebookId when it looks like a long id (SiYuan-style).
        if (filter.notebook.length >= 16 || /^\d{14}-/.test(filter.notebook)) {
          input.notebookId = filter.notebook
        } else {
          input.pathPrefix = `/${filter.notebook.replace(/^\/+/, '')}`
        }
      } else {
        const cleaned = filter.notebook.startsWith('/') ? filter.notebook : `/${filter.notebook}`
        input.pathPrefix = cleaned
      }
    }
    // Views often return many docs — raise default limit vs plain search (20).
    input.limit = 100
    return input
  }

  function sortSearchHits(
    items: SearchHit[],
    sort: ViewConfig['sort'] | undefined,
  ): SearchHit[] {
    if (!sort?.length) {
      // Default: updatedAt desc
      return [...items].sort((a, b) => b.updatedAt - a.updatedAt || a.ref.id.localeCompare(b.ref.id))
    }
    const specs = sort
    return [...items].sort((a, b) => {
      for (const spec of specs) {
        const field = spec.field
        const dir = spec.direction === 'asc' ? 1 : -1
        let av: string | number = 0
        let bv: string | number = 0
        if (field === 'updated_at' || field === 'updatedAt') {
          av = a.updatedAt
          bv = b.updatedAt
        } else if (field === 'title') {
          av = a.title
          bv = b.title
        } else if (field === 'path' || field === 'notebookPath') {
          av = a.notebookPath
          bv = b.notebookPath
        } else if (field === 'score') {
          av = a.score ?? 0
          bv = b.score ?? 0
        }
        if (av < bv) return -1 * dir
        if (av > bv) return 1 * dir
      }
      return a.ref.id.localeCompare(b.ref.id)
    })
  }

  // ——— ENVELOPE_GET({connectionId?, ref}) → envelope | null ———
  server.handle(
    RPC_CHANNELS.knowledge.ENVELOPE_GET,
    (_ctx, args: KnowledgeEnvelopeGetArgs): KnowledgeWorkEnvelope | null => {
      assertKnowledgeRef(args?.ref)
      return envelopesStoreFor(args.connectionId).get(args.ref)
    },
  )

  // ——— ENVELOPE_UPSERT({connectionId?, envelope}) → envelope ———
  server.handle(
    RPC_CHANNELS.knowledge.ENVELOPE_UPSERT,
    (_ctx, args: KnowledgeEnvelopeUpsertArgs): KnowledgeWorkEnvelope => {
      const envelope = args?.envelope
      if (!envelope || typeof envelope !== 'object') {
        throw new CodedError('INVALID_REF', 'knowledge.envelopeUpsert: envelope is required')
      }
      assertKnowledgeRef(envelope.knowledgeRef)
      const now = Date.now()
      const store = envelopesStoreFor(args.connectionId)
      return store.upsert({
        knowledgeRef: envelope.knowledgeRef,
        status: envelope.status,
        labels: envelope.labels,
        flagged: envelope.flagged,
        archived: envelope.archived,
        assignedTo: envelope.assignedTo,
        createdAt: typeof envelope.createdAt === 'number' ? envelope.createdAt : now,
        updatedAt: typeof envelope.updatedAt === 'number' ? envelope.updatedAt : now,
      })
    },
  )

  // ——— ENVELOPE_LIST({connectionId?}) → envelope[] ———
  server.handle(
    RPC_CHANNELS.knowledge.ENVELOPE_LIST,
    (_ctx, args: KnowledgeEnvelopeListArgs = {}): KnowledgeWorkEnvelope[] => {
      return envelopesStoreFor(args.connectionId).list()
    },
  )

  // ——— VIEWS_LIST({connectionId?}) → ViewConfig[] (domain knowledge only) ———
  server.handle(
    RPC_CHANNELS.knowledge.VIEWS_LIST,
    (_ctx, args: KnowledgeViewsListArgs = {}): ViewConfig[] => {
      const { rootPath } = resolveViewsWorkspace({ connectionId: args.connectionId })
      return listViewsFromStorage(rootPath, 'knowledge')
    },
  )

  // ——— VIEW_RUN({connectionId, viewId, workspaceId?}) → { items, view } ———
  server.handle(
    RPC_CHANNELS.knowledge.VIEW_RUN,
    async (_ctx, args: KnowledgeViewRunArgs): Promise<KnowledgeViewRunResult> => {
      if (!args?.connectionId || typeof args.connectionId !== 'string') {
        throw new CodedError('INVALID_REF', 'knowledge.viewRun: connectionId is required')
      }
      if (typeof args.viewId !== 'string' || args.viewId.length === 0) {
        throw new CodedError('INVALID_REF', 'knowledge.viewRun: viewId is required')
      }
      const { rootPath } = resolveViewsWorkspace({
        connectionId: args.connectionId,
        workspaceId: args.workspaceId,
      })
      const views = listViewsFromStorage(rootPath, 'knowledge')
      const view = views.find((v) => v.id === args.viewId)
      if (!view) {
        throw new CodedError('NOT_FOUND', `Knowledge view not found: ${args.viewId}`)
      }

      const searchInput = searchInputFromKnowledgeFilter(view.knowledgeFilter)
      const page = await callProvider(args.connectionId, (provider) => provider.search(searchInput))
      let items = page.items ?? []

      // Optional expression post-filter when expression is not the trivial `true`.
      const expression = (view.expression ?? 'true').trim()
      if (expression !== 'true' && expression !== '1') {
        const compiled = compileView(view)
        if (compiled) {
          const envelopes = new KnowledgeWorkEnvelopesStore(rootPath)
          const provider = await resolveProvider(args.connectionId)
          const filtered: SearchHit[] = []
          for (const hit of items) {
            let node = null
            try {
              node = await provider.get(hit.ref)
            } catch {
              /* use hit-only context */
            }
            const envelope = envelopes.get(hit.ref)
            const ctx = buildKnowledgeViewContext(
              {
                title: hit.title,
                snippet: hit.snippet,
                notebookPath: hit.notebookPath,
                updatedAt: hit.updatedAt,
                ref: hit.ref,
                path: node?.path,
                attributes: node?.attributes,
              },
              node,
              envelope,
            )
            if (evaluateView(ctx, compiled)) filtered.push(hit)
          }
          items = filtered
        }
      }

      items = sortSearchHits(items, view.sort)

      // Enrich attributes for non-notebook groupBy (topic/status/…) so UI can bucket.
      const groupBy = (view.groupBy ?? '').trim()
      if (groupBy && groupBy !== 'notebook' && items.length > 0) {
        const provider = await resolveProvider(args.connectionId)
        const enrichLimit = Math.min(items.length, 100)
        const enriched: KnowledgeViewHit[] = []
        for (let i = 0; i < items.length; i++) {
          const hit = items[i]!
          if (i >= enrichLimit) {
            enriched.push(hit)
            continue
          }
          try {
            const node = await provider.get(hit.ref)
            const attributes: Record<string, string> = {}
            for (const attr of node.attributes ?? []) {
              attributes[attr.key] = attr.value
            }
            const topic = attributes.topic || attributes['knowledge-topic']
            enriched.push({
              ...hit,
              attributes,
              ...(topic ? { topic } : {}),
            })
          } catch {
            enriched.push(hit)
          }
        }
        items = enriched
      }

      return { items, view }
    },
  )

  // ——— VIEW_SET_ATTRIBUTE({connectionId, ref, name, value}) → { proposalId } ———
  // ALWAYS proposeMutation via bridge — never apply automatically.
  server.handle(
    RPC_CHANNELS.knowledge.VIEW_SET_ATTRIBUTE,
    async (_ctx, args: KnowledgeViewSetAttributeArgs): Promise<{ proposalId: string }> => {
      if (!args?.connectionId || typeof args.connectionId !== 'string') {
        throw new CodedError('INVALID_REF', 'knowledge.viewSetAttribute: connectionId is required')
      }
      assertKnowledgeRef(args?.ref)
      if (typeof args.name !== 'string' || args.name.length === 0) {
        throw new CodedError('INVALID_REF', 'knowledge.viewSetAttribute: name is required')
      }
      if (typeof args.value !== 'string') {
        throw new CodedError('INVALID_REF', 'knowledge.viewSetAttribute: value must be a string')
      }
      const record = requireConnection(args.connectionId)
      const { rootPath, workspaceId } = requireConnectionWorkspaceRoot(record)
      // Mutation allowlist requires ^(craft-|knowledge-). View presets may use bare
      // domain names (workflow_status) — prefix knowledge- when needed.
      const attrName = isAllowedAttributeName(args.name) ? args.name : `knowledge-${args.name}`
      const nowIso = new Date().toISOString()
      try {
        const proposal = await bridgeFor(rootPath, workspaceId).propose({
          connectionId: args.connectionId,
          input: {
            targetRef: args.ref,
            ops: [{ op: 'setAttribute', blockId: args.ref.id, name: attrName, value: args.value }],
            selectionProofs: [
              {
                kind: 'surface-selection',
                selectionId: `view-action-${Date.now()}`,
                ref: args.ref,
                selectedAt: nowIso,
              },
            ],
            actor: 'user',
            summary: `Set ${attrName}=${args.value}`,
          },
        })
        return { proposalId: proposal.id }
      } catch (error) {
        if (error instanceof MutationValidationError) {
          throw new CodedError(
            'INVALID_REF',
            `knowledge.viewSetAttribute: ${error.reason}: ${error.message}`,
          )
        }
        throw toTransportError(error)
      }
    },
  )

  // ——— WATCH({connectionId, workspaceId, intervalMs?}) → { ok: true } ———
  // Starts a per-workspace KnowledgeChangeWatcher that polls provider and emits
  // AppEvents into the workspace AutomationSystem via sessionManager.emitWorkspaceEvent.
  server.handle(
    RPC_CHANNELS.knowledge.WATCH,
    async (ctx, args: { connectionId?: string; workspaceId?: string; intervalMs?: number }) => {
      if (!args?.connectionId || typeof args.connectionId !== 'string') {
        throw new CodedError('INVALID_REF', 'knowledge.watch: connectionId is required')
      }
      if (!args?.workspaceId || typeof args.workspaceId !== 'string') {
        throw new CodedError('INVALID_REF', 'knowledge.watch: workspaceId is required')
      }
      const record = requireConnection(args.connectionId)
      const rootPath = requireWorkspaceRoot(args.workspaceId)
      // Ensure bridge+provider resolver are registered for automation executor path.
      bridgeFor(rootPath, args.workspaceId)
      registerKnowledgeProviderResolver(rootPath, resolveProvider)

      const intervalMs =
        typeof args.intervalMs === 'number' && args.intervalMs >= 5_000 ? args.intervalMs : 60_000

      const emit = deps.sessionManager.emitWorkspaceEvent?.bind(deps.sessionManager)

      startKnowledgeWatch({
        connectionId: args.connectionId,
        workspaceId: args.workspaceId,
        workspaceRoot: rootPath,
        intervalMs,
        clientId: ctx.clientId,
        getProvider: () => resolveProvider(args.connectionId!),
        onEvent: async (event, payload) => {
          // Fan-out to renderer (existing knowledge:changed) for UI freshness
          if (payload.ref) {
            pushTyped(
              server,
              RPC_CHANNELS.knowledge.CHANGED,
              { to: 'workspace', workspaceId: args.workspaceId! },
              {
                ref: payload.ref,
                change: event === 'KnowledgeDocumentCreated' ? 'created' : 'updated',
              },
            )
          }
          // Emit into AutomationSystem
          if (emit) {
            await emit(args.workspaceId!, event, {
              ...payload,
              connectionId: args.connectionId,
            })
          }
        },
      })
      return { ok: true as const, connectionId: record.id, intervalMs }
    },
  )

  // ——— UNWATCH({connectionId, workspaceId}) → { ok: true } ———
  server.handle(
    RPC_CHANNELS.knowledge.UNWATCH,
    async (_ctx, args: { connectionId?: string; workspaceId?: string }) => {
      if (!args?.connectionId || typeof args.connectionId !== 'string') {
        throw new CodedError('INVALID_REF', 'knowledge.unwatch: connectionId is required')
      }
      if (!args?.workspaceId || typeof args.workspaceId !== 'string') {
        throw new CodedError('INVALID_REF', 'knowledge.unwatch: workspaceId is required')
      }
      const rootPath = requireWorkspaceRoot(args.workspaceId)
      const stopped = stopKnowledgeWatch(rootPath, args.connectionId)
      return { ok: true as const, stopped }
    },
  )

  // ——— MIGRATE_NOTES({workspaceId, sourceRoot, format?}) → MigrateNotesResult ———
  // User-initiated local import into the Markdown Notes store. It has no
  // knowledge-provider, credential, or network dependency.
  server.handle(
    RPC_CHANNELS.knowledge.MIGRATE_NOTES,
    async (_ctx, args: MigrateNotesArgs): Promise<MigrateNotesResult> => {
      if (!args?.workspaceId || typeof args.workspaceId !== 'string') {
        throw new Error('knowledge.migrateNotes: workspaceId is required')
      }
      if (!args.sourceRoot || typeof args.sourceRoot !== 'string') {
        throw new Error('knowledge.migrateNotes: sourceRoot is required')
      }
      if (args.format !== undefined && typeof args.format !== 'string') {
        throw new Error('knowledge.migrateNotes: format must be a string')
      }
      const rootPath = requireWorkspaceRoot(args.workspaceId)
      const notesRoot = resolveWorkspaceNotesRoot(args.workspaceId)
      try {
        const result = await importNotes({
          workspaceRoot: rootPath,
          sourceRoot: args.sourceRoot,
          destinationRoot: notesRoot,
          format: args.format,
        })
        if (result.migrated > 0) {
          pushTyped(
            server,
            RPC_CHANNELS.notes.CHANGED,
            { to: 'workspace', workspaceId: args.workspaceId },
            { workspaceId: args.workspaceId },
          )
        }
        return result
      } catch (error) {
        throw toTransportError(error)
      }
    },
  )


  // Auto-start process-level watches for existing connections (daemon / headless).
  // Fail-soft: missing credentials or provider errors are logged and skipped.
  // Tests set __setSkipKnowledgeWatchAutoStart(true) to avoid polluting fetch seams.
  if (!skipKnowledgeWatchAutoStart) {
    void (async () => {
      try {
        const connections = new KnowledgeConnectionsStore().list()
        const emit = deps.sessionManager.emitWorkspaceEvent?.bind(deps.sessionManager)
        for (const record of connections) {
          const cred = credentialIdFromRef(record.credentialRef)
          const workspaceId = cred?.workspaceId
          if (!workspaceId) continue
          let rootPath: string
          try {
            rootPath = requireWorkspaceRoot(workspaceId)
          } catch {
            continue
          }
          try {
            bridgeFor(rootPath, workspaceId)
            registerKnowledgeProviderResolver(rootPath, resolveProvider)
            startKnowledgeWatch({
              connectionId: record.id,
              workspaceId,
              workspaceRoot: rootPath,
              intervalMs: 60_000,
              getProvider: () => resolveProvider(record.id),
              onEvent: async (event, payload) => {
                if (payload.ref) {
                  pushTyped(
                    server,
                    RPC_CHANNELS.knowledge.CHANGED,
                    { to: 'workspace', workspaceId },
                    {
                      ref: payload.ref,
                      change: event === 'KnowledgeDocumentCreated' ? 'created' : 'updated',
                    },
                  )
                }
                if (emit) {
                  await emit(workspaceId, event, {
                    ...payload,
                    connectionId: record.id,
                  })
                }
              },
            })
            log.info?.(`[knowledge] auto-started watch for connection ${record.id} (ws=${workspaceId})`)
          } catch (error) {
            log.warn?.(
              `[knowledge] auto-start watch skipped for ${record.id}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            )
          }
        }
      } catch (error) {
        log.warn?.(
          `[knowledge] auto-start watches failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    })()
  }
}

/** Client-disconnect cleanup (mirrors notes WATCH). */
export { cleanupKnowledgeWatchForClient }
