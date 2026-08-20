/**
 * SiyuanKnowledgeProvider — KnowledgeProvider over SiyuanKernelClient: P1 read surface
 * (K-03 §3.2) + P3 write-back (K-05 §3.2/§3.4.1, see "mutations" below).
 *
 * Endpoint decisions (each verified against wire shapes in ./client.ts — do not re-derive):
 * - capabilities()      → POST /api/system/version via client.getVersion(); features are the P1
 *                         matrix below; mutations flags are the P3 matrix (K-03 §3.6 — the four
 *                         §3.4.1 whitelisted ops true, transactions/rollback false with the
 *                         rationale in the matrix comments below).
 * - search()            → POST /api/search/fullTextSearchBlock — /api/search/searchBlock does
 *                         NOT exist in the kernel (client header, router.go eef1056838).
 *                         kinds → kernel `types` map: 'document'→{document:true},
 *                         'database'→{databaseBlock:true}, 'block'→all non-document types.
 *                         Default kinds ['document','block'] send NO types map (kernel default
 *                         = all types); narrower sets send the map. kinds limited to
 *                         notebook/asset are NOT full-text-searchable → empty page.
 *                         pagination: opaque cursor = aligned OFFSET string (spec §"Открытые
 *                         вопросы" 2: limit/offset), mapped onto kernel 1-based page/pageSize;
 *                         nextCursor = current page + 1 × limit while kernel pageCount > page.
 *                         `notebookId` maps to kernel `paths: [boxId]`; `pathPrefix` is a
 *                         client-side post-filter on hPath (kernel paths segments are ID-based,
 *                         not human paths).
 *                         `attributes` (domain filter §4.3) is NOT expressible in full-text
 *                         search → routed to client.sql() over blocks ⋈ attributes with
 *                         COUNT + LIMIT/OFFSET (read-only mode, SELECT only — client enforces).
 * - get()               → document: /api/export/exportMdContent (+getDocInfo for title/IAL);
 *                         block: /api/block/getBlockKramdown (+getBlockInfo, getHPathByID,
 *                         getBlockAttrs); notebook: /api/notebook/lsNotebooks. Missing ids are
 *                         preflighted with /api/block/checkBlockExist → NOT_FOUND.
 *                         database/asset refs → UNSUPPORTED_OPERATION (P1 read scope).
 * - getContext()        → get() for content+attributes+hash, /api/block/getChildBlocks for
 *                         children, /api/ref/getBacklink for backlinks (k/mk = '' —
 *                         MANDATORY per kernel, empty means "no sub-filter"). Both modes read
 *                         fresh state: 'snapshot' captures now, 'live-reference' re-reads now
 *                         (persistence/replay lives in server-core's snapshots store).
 * - open()              → canonical deep-links.ts throw (Electron-side navigation, K-03 §3.5.3).
 * - proposeMutation()   → §3.4.1 structural validation (ops whitelist + path/size/attr-prefix
 *                         guards) → READ target through get() (§3.1 same-reader rule) →
 *                         in-memory DRAFT proposal {baseHash, preState, preStateAttributes,
 *                         diff preview}. Review/approve is bridge-side engine work — the
 *                         provider proposal never leaves 'draft'.
 * - applyMutation()     → RE-READ through get() → HASH CHECK against the propose-time baseHash
 *                         (defense in depth; the bridge checks first) → executeMutationOps
 *                         (sequential + soft compensation, ./mutation-adapter.ts). PartialApplyError
 *                         and kernel-typed KnowledgeErrors propagate VERBATIM; hash drift returns
 *                         a conflicted ApplyResult {reason:'hash-mismatch', currentHash}.
 *                         Selection-proof freshness/match is NOT re-run here: the bridge gates
 *                         proofs at propose, and its T10 rollback pass legitimately sends inverse
 *                         ops targeting kernel-created ids that carry no proof (same convention
 *                         as InMemory's enforceSelectionProofs:false).
 *
 * Attributes convention: kernel IAL keys `custom-*` are the only domain attributes (§4.3) —
 * exposed with the prefix stripped; system IAL keys (id/title/created/updated) are dropped.
 * Timestamps: 'yyyyMMddHHmmss' local-time strings → epoch ms; IAL 'updated' is the only
 * timestamp surfaced for documents/blocks (createdAt falls back to it, then to 0).
 */

import type { KnowledgeCapabilities } from '../../capabilities.ts';
import type { ContextMode, ContextPayload } from '../../context.ts';
import { KnowledgeError } from '../../errors.ts';
import {
  buildProposalDiff,
  createProposalDraft,
  DEFAULT_MAX_BLOCK_BYTES,
  isAllowedAttributeName,
  MutationValidationError,
  normalizeDocumentPath,
  PartialApplyError,
  validateOpsWhitelist,
  type MutationOp,
} from '../../mutations.ts';
import {
  hashKnowledgeContent,
  type ApplyResult,
  type KnowledgeConnection,
  type KnowledgeNode,
  type KnowledgeProvider,
  type MutationInput,
  type MutationProposal,
  type SearchInput,
  type SearchPage,
} from '../../provider.ts';
import { canonicalKnowledgeRef, siyuanDeepLink, type KnowledgeKind, type KnowledgeRef } from '../../refs.ts';
import { nativeOpenUnsupportedError } from './deep-links.ts';
import { executeMutationOps, type MutationExecutionResult } from './mutation-adapter.ts';
import {
  SIYUAN_MIN_SUPPORTED_VERSION,
  SiyuanKernelClient,
  type SiyuanBacklinkPath,
  type SiyuanSearchBlock,
  type SiyuanSqlRow,
} from './client.ts';

// ---------------------------------------------------------------------------
// Options

export interface SiyuanKnowledgeProviderOptions {
  /** Connection record (K-04); baseUrl honoured for external-local/remote modes. */
  connection: KnowledgeConnection;
  /**
   * API token (SiYuan Settings → About). Fetched via CredentialManager
   * ('source_bearer::{workspaceId}::{connectionId}') by the handler layer.
   */
  token?: string;
  /** Pre-built client injection (tests / shared clients); wins over token/baseUrl. */
  client?: SiyuanKernelClient;
  /** Forwarded to SiyuanKernelClient when it is constructed here. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Kernel search `types` keys (verbatim client wire: fullTextSearchBlock.types).
// ORDER deterministic — re-tested via request-body fixtures.

const BLOCK_SEARCH_TYPES = [
  'heading',
  'list',
  'listItem',
  'codeBlock',
  'mathBlock',
  'table',
  'blockquote',
  'superBlock',
  'paragraph',
  'htmlBlock',
  'embedBlock',
  'databaseBlock',
  'audioBlock',
  'videoBlock',
  'iframeBlock',
  'widgetBlock',
  'callout',
] as const;

const DEFAULT_SEARCH_KINDS: KnowledgeKind[] = ['document', 'block'];
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;

/** IAL keys that are node metadata, not domain attributes (§4.3). */
const SYSTEM_IAL_KEYS: Record<string, true> = { id: true, title: true, updated: true, created: true };

// ---------------------------------------------------------------------------

export class SiyuanKnowledgeProvider implements KnowledgeProvider {
  readonly connection: SiyuanKnowledgeProviderOptions['connection'];
  private readonly client: SiyuanKernelClient;

  constructor(options: SiyuanKnowledgeProviderOptions) {
    this.connection = options.connection;
    this.client =
      options.client ??
      new SiyuanKernelClient({
        baseUrl: options.connection.baseUrl,
        token: options.token ?? '',
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      });
  }

  // -- capabilities (K-03 §3.6) ----------------------------------------------

  async capabilities(): Promise<KnowledgeCapabilities> {
    const version = await this.client.getVersion();
    return {
      provider: 'siyuan',
      version,
      minSupportedVersion: SIYUAN_MIN_SUPPORTED_VERSION,
      features: {
        search: true,
        backlinks: true,
        attributes: true,
        databases: false, // attribute-view reads are out of P1 scope
        assets: false,
        liveReference: true,
        watch: false, // PUSH knowledge:changed arrives with the watch slice
        deepLinks: true,
      },
      mutations: {
        // P3 (K-05 §3.4.1): the four whitelisted ops execute via ./mutation-adapter.ts
        // (sequential, soft partial-apply compensation). K-03 §3.6: UI/MCP read THIS matrix
        // only — flags must reflect real behavior.
        createDocument: true,
        appendBlock: true,
        updateBlock: true,
        setAttribute: true,
        // FALSE, deliberately: the kernel has no multi-op atomicity on this path — batches run
        // sequentially with best-effort inverse compensation (K-05 §3.2 invariant), which is
        // NOT a transaction; claiming one would let callers skip hash/overlap discipline.
        transactions: false,
        // FALSE, deliberately: rollback is SOFT and bridge-driven (K-05 §3.8/T10 — inverse ops
        // flow back through proposeMutation/applyMutation as a second pass). The provider
        // itself owns no rollback primitive, so the flag does not claim one; the bridge's
        // persisted proposals store holds the inverse patch.
        rollback: false,
      },
    };
  }

  // -- search -----------------------------------------------------------------

  async search(input: SearchInput): Promise<SearchPage> {
    const kinds = input.kinds ?? DEFAULT_SEARCH_KINDS;
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
    const offset = parseCursor(input.cursor);

    const fullTextKinds = kinds.filter((kind) => kind === 'document' || kind === 'block' || kind === 'database');
    if (fullTextKinds.length === 0) {
      // notebook/asset kinds have no full-text surface (kernel `types` map) → empty page.
      return { items: [], totalEstimate: 0 };
    }

    if (input.attributes && Object.keys(input.attributes).length > 0) {
      return this.attributeSearch(input, fullTextKinds, limit, offset);
    }

    const page = Math.floor(offset / limit) + 1;
    const result = await this.client.fullTextSearchBlock({
      query: input.query,
      page,
      pageSize: limit,
      ...(input.notebookId ? { paths: [input.notebookId] } : {}),
      ...(isDefaultKinds(fullTextKinds) ? {} : { types: kindsToSearchTypes(fullTextKinds) }),
    });

    const inPageOffset = offset % limit;
    let hits = result.blocks.map(searchBlockToHit);
    if (input.pathPrefix) {
      hits = hits.filter((hit) => hit.notebookPath.startsWith(input.pathPrefix!));
    }
    if (inPageOffset > 0) hits = hits.slice(inPageOffset);

    const pageOut: SearchPage = { items: hits, totalEstimate: result.matchedBlockCount };
    if (page < result.pageCount) pageOut.nextCursor = String(page * limit);
    return pageOut;
  }

  /**
   * Attribute-constrained search via read-only SQL blocks⋈attributes (endpoint allows no
   * structured attribute filter; client.sql() enforces SELECT-only + single-statement).
   * Pagination stays limit/offset — deterministic under ORDER BY updated DESC, id ASC.
   */
  private async attributeSearch(
    input: SearchInput,
    kinds: KnowledgeKind[],
    limit: number,
    offset: number,
  ): Promise<SearchPage> {
    const joins = Object.entries(input.attributes ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([name, value], index) =>
          `JOIN attributes AS a${index} ON a${index}.block_id = b.id AND a${index}.name = ${sqlString(kernelAttrSearchName(name))} AND a${index}.value = ${sqlString(value)}`,
      );
    const where: string[] = [];
    const query = input.query.trim();
    if (query) where.push(`instr(lower(b.content), lower(${sqlString(query)})) > 0`);
    if (input.notebookId) where.push(`b.box = ${sqlString(input.notebookId)}`);
    if (input.pathPrefix) where.push(`b.hpath LIKE ${sqlString(`${input.pathPrefix}%`)}`);
    const kindCondition = sqlKindCondition(kinds);
    if (kindCondition) where.push(kindCondition);
    const from = `FROM blocks AS b ${joins.join(' ')}`;
    const whereClause = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    const countRows = await this.client.sql<{ c: number | string }>(
      `SELECT COUNT(DISTINCT b.id) AS c ${from}${whereClause}`,
    );
    const total = Number(countRows[0]?.c ?? 0);

    const rows = await this.client.sql(
      `SELECT DISTINCT b.* ${from}${whereClause} ORDER BY b.updated DESC, b.id ASC LIMIT ${limit} OFFSET ${offset}`,
    );

    const page: SearchPage = { items: rows.map(sqlRowToHit), totalEstimate: total };
    if (offset + limit < total) page.nextCursor = String(offset + limit);
    return page;
  }

  // -- get ---------------------------------------------------------------------

  async get(ref: KnowledgeRef): Promise<KnowledgeNode> {
    const valid = canonicalKnowledgeRef(ref);
    switch (valid.kind) {
      case 'document':
        return this.getDocument(valid);
      case 'block':
        return this.getBlock(valid);
      case 'notebook':
        return this.getNotebook(valid);
      default:
        throw new KnowledgeError(
          'UNSUPPORTED_OPERATION',
          `Reading knowledge kind "${valid.kind}" is outside the P1 scope (read-only document/block/notebook); ${siyuanDeepLink(valid)} is not readable headlessly`,
          { ref: valid },
        );
    }
  }

  private async getDocument(ref: KnowledgeRef): Promise<KnowledgeNode> {
    await this.assertExists(ref);
    const [{ hPath, content }, info, ial] = await Promise.all([
      this.client.exportMdContent(ref.id),
      this.client.getDocInfo(ref.id),
      this.client.getBlockAttrs(ref.id),
    ]);
    const { attributes, createdAt, updatedAt } = ialToAttributes(ial);
    return {
      ref: { ...ref },
      title: info.name,
      markdown: content,
      path: hPath,
      attributes,
      createdAt,
      updatedAt,
      contentHash: await hashKnowledgeContent(content),
    };
  }

  private async getBlock(ref: KnowledgeRef): Promise<KnowledgeNode> {
    await this.assertExists(ref);
    const [kramdown, info, attrs] = await Promise.all([
      this.client.getBlockKramdown(ref.id),
      this.client.getBlockInfo(ref.id),
      this.client.getBlockAttrs(ref.id),
    ]);
    const hPath = info.rootID ? await this.client.getHPathByID(info.rootID) : '';
    const { attributes, createdAt, updatedAt } = ialToAttributes(attrs);
    return {
      ref: { ...ref },
      title: info.rootTitle,
      markdown: kramdown,
      path: hPath,
      attributes,
      createdAt,
      updatedAt,
      contentHash: await hashKnowledgeContent(kramdown),
    };
  }

  private async getNotebook(ref: KnowledgeRef): Promise<KnowledgeNode> {
    const notebook = (await this.client.listNotebooks()).find((box) => box.id === ref.id);
    if (!notebook) {
      throw new KnowledgeError('NOT_FOUND', `SiYuan notebook "${ref.id}" does not exist`, { ref });
    }
    return {
      ref: { ...ref },
      title: notebook.name,
      path: `/${notebook.name}`,
      attributes: [],
      createdAt: 0,
      updatedAt: 0,
      contentHash: await hashKnowledgeContent(''),
    };
  }

  private async assertExists(ref: KnowledgeRef): Promise<void> {
    if (!(await this.client.checkBlockExist(ref.id))) {
      throw new KnowledgeError('NOT_FOUND', `SiYuan ${ref.kind} "${ref.id}" does not exist`, { ref });
    }
  }

  // -- getContext (K-03 §3.2) ---------------------------------------------------

  async getContext(ref: KnowledgeRef, mode: ContextMode): Promise<ContextPayload> {
    const valid = canonicalKnowledgeRef(ref);
    // P1: both modes read fresh state — 'snapshot' = capture-now, 'live-reference' = re-read-now;
    // persisted replay is the server-core snapshots store, not the adapter.
    const [node, children, backlink] = await Promise.all([
      this.get(valid),
      this.client.getChildBlocks(valid.id),
      this.client.getBacklink(valid.id, { k: '', mk: '' }), // k/mk are kernel-mandatory
    ]);
    return {
      ref: { ...valid },
      mode,
      blockId: valid.id,
      content: node.markdown ?? '',
      children: children.map((child) => ({ blockId: child.id, content: child.markdown ?? child.content ?? '' })),
      backlinks: backlink.backlinks.map(backlinkPathToRef),
      attributes: node.attributes.map((attribute) => ({ ...attribute })),
      capturedAt: Date.now(),
      contentHash: node.contentHash,
    };
  }

  // -- mutations (P3 — docs/specs/2026-08-07-siyuan-integration/05-mutation-safety.md) ----------

  /**
   * Provider-side op-batch registry for the bridge's propose→apply pair (bridge-service
   * executeViaProvider issues them back-to-back). Bounded so a crashed pass can never grow the
   * map without limit — entries past the cap drop oldest-first (a dropped draft applies as
   * NOT_FOUND, which the bridge maps to its own typed failure, never to a silent write).
   */
  private readonly proposals = new Map<string, MutationProposal>();
  private static readonly MAX_QUEUED_PROPOSALS = 256;

  /**
   * T1 provider-side: VALIDATE (§3.4.1 structural guards) → READ via get() (§3.1 same-reader
   * rule: apply RE-READs through this same code path) → in-memory DRAFT proposal carrying
   * baseHash/preState/diff preview. Status stays 'draft' — review/approve (T2/T3) is the
   * bridge-side engine's job; the provider proposal never models it.
   *
   * Validation scope (deliberate): ops whitelist + path/title/256KB/attr-prefix guards hold
   * for BOTH original ops and bridge-derived T10 inverse ops. Selection-proof freshness/match
   * and the §3.6 permission gate are NOT re-run here: the bridge proves them at propose, and
   * its rollback pass legitimately sends inverse ops targeting kernel-created ids that carry
   * no proof — enforcing here would break soft rollback end-to-end (InMemory's
   * enforceSelectionProofs:false precedent; mutation-adapter "ops are assumed already
   * validated" contract).
   */
  async proposeMutation(input: MutationInput): Promise<MutationProposal> {
    const ops = validateOpsWhitelist(input.ops);
    assertStructuralOpGuards(ops);
    if (!input.targetRef) {
      throw new KnowledgeError('INVALID_REF', 'Siyuan proposeMutation requires targetRef (v1: one target per proposal)');
    }
    const targetRef = canonicalKnowledgeRef(input.targetRef);
    for (const op of ops) {
      // createDocument's baseHash protects the CONTAINING notebook read; anything else makes
      // the T1/T6 same-reader hash meaningless (op targets a different notebook than the read).
      if (op.op === 'createDocument' && (targetRef.kind !== 'notebook' || targetRef.id !== op.notebook)) {
        throw new KnowledgeError(
          'INVALID_REF',
          `createDocument needs targetRef = the containing notebook "${op.notebook}", got ${targetRef.kind}/${targetRef.id}`,
        );
      }
    }

    // READ: get() preflights existence (NOT_FOUND). Notebooks have no markdown → preState ''
    // and baseHash = sha256('') mark a not-yet-existing createDocument target.
    const node = await this.get(targetRef);
    const preState = node.markdown ?? '';
    const preStateAttributes = {
      [node.ref.id]: Object.fromEntries(node.attributes.map((attribute) => [attribute.key, attribute.value])),
    };
    const baseHash = await hashKnowledgeContent(preState);
    const baseReadAt = new Date().toISOString();

    const draft = createProposalDraft(
      {
        id: `sp_${crypto.randomUUID()}`,
        connectionId: this.connection.id,
        targetRef,
        ops,
        baseHash,
        baseReadAt,
        preState,
        preStateAttributes,
        selectionProofs: input.selectionProofs,
        sessionId: input.sessionId,
        actor: input.actor ?? 'user',
      },
      { enforceSelectionProofs: false }, // proof/scope gates are bridge-side (see method header)
    );
    // Diff PREVIEW rides the draft for consumers that read provider proposals directly; the
    // engine's T2 hop (draft → pending_review) is the bridge's, so status stays 'draft' while
    // the diff field is filled by the same buildProposalDiff the engine would use.
    const proposal: MutationProposal = { ...draft.proposal, diffDocument: buildProposalDiff(preState, ops) };
    if (this.proposals.size >= SiyuanKnowledgeProvider.MAX_QUEUED_PROPOSALS) {
      const oldest = this.proposals.keys().next().value;
      if (oldest !== undefined) this.proposals.delete(oldest);
    }
    this.proposals.set(proposal.id, proposal);
    return structuredClone(proposal);
  }

  /**
   * T5→T6/T7 provider-side defense in depth: RE-READ via get() → HASH CHECK vs the
   * propose-time baseHash → executeMutationOps (strictly sequential; a mid-batch failure is
   * soft-compensated inside the adapter and surfaces as PartialApplyError). PartialApplyError
   * and kernel-typed KnowledgeErrors propagate VERBATIM — the bridge maps them to its own
   * T7/T8 bookkeeping; hash drift RETURNS the conflicted ApplyResult the wire type describes
   * (reason/currentHash populated — UI toast routing keys on them).
   */
  async applyMutation(proposalId: string): Promise<ApplyResult> {
    const stored = this.proposals.get(proposalId);
    if (!stored) throw new KnowledgeError('NOT_FOUND', `Mutation proposal "${proposalId}" not found`);
    if (stored.status !== 'draft') {
      // §3.2 T11: a resolved provider-side proposal is terminal; a repeat write is a NEW pass.
      throw new KnowledgeError(
        'PROVIDER_ERROR',
        `Mutation proposal "${proposalId}" already resolved (${stored.status}); repeat apply needs a new proposal (§3.2 T11)`,
      );
    }

    // RE-READ + HASH CHECK through the same reader as propose. createDocument reads the
    // notebook (content '' both times) — the check is vacuous by construction: there is no
    // prior content to protect.
    const reRead = await this.get(stored.targetRef);
    const currentHash = await hashKnowledgeContent(reRead.markdown ?? '');
    if (currentHash !== stored.baseHash) {
      this.proposals.set(proposalId, { ...stored, status: 'conflict', updatedAt: new Date().toISOString() });
      return { proposalId, applied: false, conflicted: true, status: 'conflict', reason: 'hash-mismatch', currentHash };
    }

    let execution: MutationExecutionResult;
    try {
      execution = await executeMutationOps(this.client, stored.ops, {
        preState: { content: stored.preState ?? '', attributes: stored.preStateAttributes },
      });
    } catch (error) {
      if (error instanceof PartialApplyError) {
        // Local mirror of the bridge's T7 bookkeeping; the error itself propagates verbatim.
        this.proposals.set(proposalId, { ...stored, status: 'conflict', updatedAt: new Date().toISOString() });
      }
      throw error;
    }

    const appliedAt = new Date().toISOString();
    // Wire ApplyResult carries ONE createdRef (v1 contract): the document wins over child
    // blocks; the full per-op-index capture lives on MutationExecutionResult.createdIdsByOpIndex.
    const createdRef: KnowledgeRef | undefined =
      execution.createdIds.documentIds.length > 0
        ? { scheme: 'siyuan', kind: 'document', id: execution.createdIds.documentIds[0]! }
        : execution.createdIds.blockIds.length > 0
          ? { scheme: 'siyuan', kind: 'block', id: execution.createdIds.blockIds[0]! }
          : undefined;

    // Verify RE-READ (§3.1 same-reader): created nodes verify on themselves, everything else on
    // the target. currentHash on SUCCESS is the post-apply hash — the bridge's own T6 verify
    // re-derives it; on the conflict path above it was the observed drift hash.
    const verified = await this.get(createdRef ?? stored.targetRef);
    const postHash = await hashKnowledgeContent(verified.markdown ?? '');

    this.proposals.set(proposalId, { ...stored, status: 'applied', appliedAt, appliedHash: postHash, updatedAt: appliedAt });
    const result: ApplyResult = { proposalId, applied: true, conflicted: false, status: 'applied', appliedAt, currentHash: postHash };
    if (createdRef) result.createdRef = createdRef;
    return result;
  }

  // -- open (Electron-side navigation, K-03 §3.5.3) ------------------------------

  async open(ref: KnowledgeRef): Promise<void> {
    throw nativeOpenUnsupportedError(canonicalKnowledgeRef(ref));
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers (module-private; behavior verified through adapter tests).

type SearchTypes = NonNullable<Parameters<SiyuanKernelClient['fullTextSearchBlock']>[0]['types']>;

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isDefaultKinds(kinds: KnowledgeKind[]): boolean {
  return kinds.includes('document') && kinds.includes('block');
}

function kindsToSearchTypes(kinds: KnowledgeKind[]): SearchTypes {
  const types: Record<string, boolean> = {};
  for (const kind of kinds) {
    if (kind === 'document') types['document'] = true;
    else if (kind === 'block') for (const key of BLOCK_SEARCH_TYPES) types[key] = true;
    else if (kind === 'database') types['databaseBlock'] = true;
  }
  return types;
}

/** 'yyyyMMddHHmmss' local-time (SiYuan Block.Created/Updated) or ISO-ish fallback → epoch ms. */
function parseSiyuanTimestamp(raw: unknown): number {
  if (typeof raw !== 'string' || raw.length === 0) return 0;
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(raw);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime();
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Plain-text snippet: kernel highlights with mark tags — strip markup, collapse whitespace. */
function stripSearchMarkup(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;?/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function hPathTitle(hPath: string, fallback: string): string {
  const segments = hPath.split('/').filter(Boolean);
  return segments.at(-1) || fallback || '(untitled)';
}

function searchBlockToHit(block: SiyuanSearchBlock): SearchPage['items'][number] {
  const isDocument = block.type === 'NodeDocument';
  const snippetSource = block.fcontent || block.content || block.markdown;
  return {
    ref: {
      scheme: 'siyuan',
      kind: isDocument ? 'document' : 'block',
      id: isDocument ? block.rootID || block.id : block.id,
    },
    title: isDocument ? block.name || hPathTitle(block.hPath, '') : hPathTitle(block.hPath, block.name),
    snippet: stripSearchMarkup(snippetSource),
    notebookPath: block.hPath,
    updatedAt: parseSiyuanTimestamp(block.updated),
  };
}

/** Domain attribute name → kernel attributes.name (`domain` → `custom-domain`). */
function kernelAttrSearchName(domainName: string): string {
  return domainName.startsWith('custom-') ? domainName : `custom-${domainName}`;
}

function sqlRowToHit(row: SiyuanSqlRow): SearchPage['items'][number] {
  const type = String(row['type'] ?? '');
  const isDocument = type === 'NodeDocument';
  const hPath = String(row['hpath'] ?? '');
  const name = String(row['name'] ?? '');
  const snippetSource = String(row['fcontent'] ?? row['content'] ?? row['markdown'] ?? '');
  return {
    ref: { scheme: 'siyuan', kind: isDocument ? 'document' : 'block', id: String(row['id'] ?? '') },
    title: isDocument ? name || hPathTitle(hPath, '') : hPathTitle(hPath, name),
    snippet: stripSearchMarkup(snippetSource),
    notebookPath: hPath,
    updatedAt: parseSiyuanTimestamp(row['updated']),
  };
}

function backlinkPathToRef(path: SiyuanBacklinkPath): ContextPayload['backlinks'][number] {
  return {
    ref: { scheme: 'siyuan', kind: 'document', id: path.id },
    title: path.name || hPathTitle(path.hPath, ''),
  };
}

function ialToAttributes(ial: Record<string, string>): {
  attributes: KnowledgeNode['attributes'];
  createdAt: number;
  updatedAt: number;
} {
  const attributes: KnowledgeNode['attributes'] = [];
  for (const [key, value] of Object.entries(ial)) {
    // §4.3 convention: domain attributes are custom-* IAL keys ONLY — built-in SiYuan IAL keys
    // (name/alias/memo/bookmark/anchor/…, beyond the SYSTEM_IAL_KEYS subset) are kernel node
    // metadata and must never surface as domain attributes. SYSTEM_IAL_KEYS stays as
    // belt+braces for the system subset even though the custom-* gate already excludes it.
    if (SYSTEM_IAL_KEYS[key]) continue;
    if (!key.startsWith('custom-')) continue;
    attributes.push({ key: key.slice('custom-'.length), value });
  }
  attributes.sort((a, b) => a.key.localeCompare(b.key));
  const updatedAt = parseSiyuanTimestamp(ial['updated']);
  return { attributes, createdAt: parseSiyuanTimestamp(ial['created']) || updatedAt, updatedAt };
}

const structuralGuardEncoder = new TextEncoder();

/**
 * §3.4.1 guards that hold for BOTH original ops and bridge-derived inverse ops: document-path
 * sanity + non-empty title, appendBlock 256KB cap, attribute-name prefix. Ops-whitelist shape
 * is validateOpsWhitelist (called first); selection-proof freshness/match is a bridge-side
 * permission gate — T10 rollback inverse ops target kernel-created ids that carry no proofs,
 * so the provider must not require them (see proposeMutation header).
 */
function assertStructuralOpGuards(ops: readonly MutationOp[]): void {
  for (const op of ops) {
    switch (op.op) {
      case 'createDocument':
        normalizeDocumentPath(op.path); // throws 'invalid-path' on '..'/resolving to root
        if (op.title.trim() === '') {
          throw new MutationValidationError('empty-title', 'createDocument title must be non-empty');
        }
        break;
      case 'appendBlock':
        if (structuralGuardEncoder.encode(op.markdown).length > DEFAULT_MAX_BLOCK_BYTES) {
          throw new MutationValidationError(
            'block-too-large',
            `appendBlock markdown exceeds maxBlockBytes (${DEFAULT_MAX_BLOCK_BYTES})`,
          );
        }
        break;
      case 'setAttribute':
        if (!isAllowedAttributeName(op.name)) {
          throw new MutationValidationError(
            'attribute-name-not-allowed',
            `setAttribute name "${op.name}" must match ^(craft-|knowledge-) (system SiYuan attrs are read-only)`,
          );
        }
        break;
      case 'updateBlock':
        break; // whitelist shape is the whole structural guard; the proof gate is bridge-side
    }
  }
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlKindCondition(kinds: KnowledgeKind[]): string | null {
  const conditions: string[] = [];
  if (kinds.includes('document')) conditions.push("b.type = 'NodeDocument'");
  if (kinds.includes('block')) conditions.push("b.type != 'NodeDocument'");
  if (kinds.includes('database')) conditions.push("b.type = 'NodeAttributeView'");
  if (conditions.length === 0) return null;
  if (kinds.includes('document') && kinds.includes('block')) return null; // default kind set = all types
  return `(${conditions.join(' OR ')})`;
}
