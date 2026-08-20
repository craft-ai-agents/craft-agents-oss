/**
 * SiyuanKernelClient — typed HTTP client for the SiYuan kernel REST API (external-local mode, K-07).
 *
 * Verified against siyuan-note/siyuan kernel master (kernel/api/router.go + handlers, commit
 * eef1056838, checked 2026-08-07; public doc: docs/API.md). Endpoint surface used by P1:
 *
 *   POST /api/system/version                 data: string kernel version ("3.1.28")
 *   POST /api/system/currentTime             data: number (epoch ms)
 *   POST /api/notebook/lsNotebooks           data: { notebooks: Box[], boxDocEnabled: boolean }
 *   POST /api/search/fullTextSearchBlock     data: { blocks: Block[], matchedBlockCount, matchedRootCount, pageCount, docMode }
 *                                            NOTE: /api/search/searchBlock does NOT exist in the kernel;
 *                                            the full-text endpoint above is the canonical block search.
 *   POST /api/query/sql                      data: row[]  (we always send mode: 'readonly' — server-side
 *                                            single-statement + read-only check; admin role required)
 *   POST /api/block/getBlockInfo             data: { box, path, rootID, rootTitle, rootTitleEmpty, rootChildID, rootIcon }
 *   POST /api/block/getBlockKramdown         data: { id, kramdown }  (mode: 'md' | 'textmark')
 *   POST /api/block/getChildBlocks           data: ChildBlock[] { id, type, subType?, content?, markdown? }  (admin role)
 *   POST /api/block/getDocInfo               data: BlockInfo { id, rootID, name, refCount, subFileCount, refIDs, ial, icon, attrViews }
 *   POST /api/block/checkBlockExist          data: boolean
 *   POST /api/attr/getBlockAttrs             data: Record<name, value>
 *   POST /api/ref/getBacklink                data: { backlinks: Path[], linkRefsCount, backmentions: Path[], mentionsCount, k, mk, box }
 *                                            NOTE: k/mk are MANDATORY string args (kernel panics without them); we send ''.
 *   POST /api/ref/getBackmentionDoc          data: { backmentions, keywords }
 *   POST /api/filetree/getHPathByID          data: string human path
 *   POST /api/filetree/getPathByID           data: { path, notebook }
 *   POST /api/export/exportMdContent         data: { hPath, content }  (admin role)
 *
 * Soft plugin/petal endpoints (plugin bridge feed — optional enrichment; callers soft-fail):
 *   POST /api/bazaar/getInstalledPlugin      args { frontend: 'desktop' } → installed plugin packages
 *   POST /api/bazaar/getBazaarPlugin         args { frontend, keyword? } → remote Bazaar catalog packages
 *   POST /api/bazaar/installBazaarPlugin     args { frontend, repoURL, repoHash, packageName, keyword? } → kernel installs (G2: no Craft-side zip download)
 *   POST /api/bazaar/uninstallBazaarPlugin   args { packageName, frontend?, keyword? } → kernel uninstalls
 *   POST /api/petal/loadPetals               args { frontend: 'desktop' } → petal enable state
 *   POST /api/petal/setPetalEnabled          args { packageName, enabled } → enable/disable petal
 *
 * Envelope everywhere: `{ code: 0, msg: '', data: T }` — code != 0 is a kernel-level error
 * (code 1 = generic/query error, -1 = exception, 3 = index in progress).
 *
 * P3 WRITE WHITELIST (K-05 §3.4.1, docs/specs/2026-08-07-siyuan-integration/05-mutation-safety.md) —
 * the ONLY mutating endpoints this client wraps. Arg names/response shapes verified verbatim
 * against siyuan-note/siyuan @ eef10568384e2e7cf547adb029ae46a72e43c287 (2026-08-07); NOTE: the
 * public API doc MOVED from repo-root API_zh_CN.md to docs/API.zh-CN.md:
 *
 *   POST /api/filetree/createDocWithMd   args { notebook, path, markdown } → data: string (new doc id)
 *      docs/API.zh-CN.md §"通过 Markdown 创建文档" L336-362; same-path re-call never overwrites.
 *   POST /api/block/appendBlock          args { dataType: 'markdown'|'dom', data, parentID } →
 *      data: [{ doOperations: [{ action:'insert', id: NEW_BLOCK_ID, parentID, ... }] }]  (§"插入后置子块" L733-778)
 *   POST /api/block/updateBlock          args { dataType: 'markdown'|'dom', data, id } →
 *      data: [{ doOperations: [{ action:'update', id, ... }] }]  (§"更新块" L780-821)
 *   POST /api/attr/setBlockAttrs         args { id, attrs } → data: null
 *      (§"设置块属性" L1033-1056; kernel requires custom-* attr names — craft-* and knowledge-* allowlist
 *      guard lives in mutations.ts validators, §3.4.1)
 *
 * §3.4.2 DELIBERATE ABSENCE — no delete/remove/move/rename endpoint is or will be wrapped by this
 * client in v1: no /api/block/deleteBlock (doc L823-860), no /api/filetree/removeDoc, no
 * /api/filetree/renameDoc, no notebook-level writes. §3.8 rollback is SOFT: tombstone updateBlock +
 * craft-rolled-back attribute. query/sql is SELECT-only, enforced client-side by assertSelectOnly
 * (../../mutations.ts, throw before any network I/O) on top of server-side mode: 'readonly'.
 * setPetalEnabled / installBazaarPlugin / uninstallBazaarPlugin are soft plugin-lifecycle calls for the bridge — not knowledge mutations.
 */

import { KnowledgeError } from '../..';
import { assertSelectOnly } from '../../mutations.ts';

export const SIYUAN_DEFAULT_BASE_URL = 'http://127.0.0.1:6806';
/** P1 compatibility floor (K-03 §3.6); enforced by settings/connection UI, not here. */
export const SIYUAN_MIN_SUPPORTED_VERSION = '3.0.0';

const DEFAULT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Wire types (verified field-for-field against kernel Go structs)

export interface SiyuanNotebook {
  id: string;
  name: string;
  icon: string;
  sort: number;
  sortMode: number;
  closed: boolean;
  subFileCount: number;
  encrypted?: boolean;
  unlocked?: boolean;
}

export interface SiyuanSearchBlock {
  box: string;
  path: string;
  hPath: string;
  id: string;
  rootID: string;
  parentID: string;
  name: string;
  alias: string;
  memo: string;
  tag: string;
  content: string;
  fcontent: string;
  markdown: string;
  folded: boolean;
  /** Full AST node type ('NodeDocument' | 'NodeParagraph' | 'NodeHeading' | ...): FromAbbrType in kernel. */
  type: string;
  subType: string;
  refText: string;
  defID: string;
  defPath: string;
  ial: Record<string, string>;
  depth: number;
  count: number;
  refCount: number;
  sort: number;
  /** 'yyyyMMddHHmmss' local time. */
  created: string;
  /** 'yyyyMMddHHmmss' local time. */
  updated: string;
}

export type SiyuanSearchMethod = 0 | 1 | 2 | 3; // 0 keyword, 1 query syntax, 2 SQL, 3 regex
export type SiyuanSearchOrderBy = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; // 0 type, 1 created↑, 2 created↓, 3 updated↑, 4 updated↓, 5 content order, 6 relevance↑, 7 relevance↓
export type SiyuanSearchGroupBy = 0 | 1; // 0 none, 1 group by document

export interface SiyuanFullTextSearchInput {
  query: string;
  page?: number;                         // 1-based, default 1
  pageSize?: number;                     // kernel default 32
  paths?: string[];                      // 'boxId' or 'boxId/doc/path' segments (kernel splits first segment as box)
  types?: Record<string, boolean>;       // document|heading|list|listItem|codeBlock|mathBlock|table|blockquote|superBlock|paragraph|htmlBlock|embedBlock|databaseBlock|audioBlock|videoBlock|iframeBlock|widgetBlock|callout
  subTypes?: Record<string, boolean>;    // h1..h6 | o|u|t
  method?: SiyuanSearchMethod;
  orderBy?: SiyuanSearchOrderBy;
  groupBy?: SiyuanSearchGroupBy;
}

export interface SiyuanFullTextSearchResult {
  blocks: SiyuanSearchBlock[];
  matchedBlockCount: number;
  matchedRootCount: number;
  pageCount: number;
  docMode: boolean;
}

export interface SiyuanBlockInfo {
  box: string;
  path: string;
  rootID: string;
  rootTitle: string;
  rootTitleEmpty: boolean;
  rootChildID: string;
  rootIcon: string;
}

export interface SiyuanDocInfo {
  id: string;
  rootID: string;
  name: string;
  refCount: number;
  subFileCount: number;
  refIDs: string[];
  ial: Record<string, string>;
  icon: string;
  attrViews: Array<{ id: string; name: string }>;
}

export interface SiyuanChildBlock {
  id: string;
  /** Abbreviated type ('p' | 'h' | 'i' | 'd' | ...), per treenode.TypeAbbr. */
  type: string;
  subType?: string;
  content?: string;
  markdown?: string;
}

export interface SiyuanBacklinkPath {
  id: string;
  box: string;
  name: string;
  hPath: string;
  type: string;
  nodeType: string;
  subType: string;
  blocks?: SiyuanSearchBlock[];
  children?: SiyuanBacklinkPath[];
  depth: number;
  count: number;
  folded: boolean;
  created: string;
  updated: string;
}

export interface SiyuanGetBacklinkResult {
  backlinks: SiyuanBacklinkPath[];
  linkRefsCount: number;
  backmentions: SiyuanBacklinkPath[];
  mentionsCount: number;
  k: string;
  mk: string;
  box: string;
}

export interface SiyuanSqlRow {
  [column: string]: unknown;
}

// -- Write-endpoint response shapes (P3 §3.4.1; docs/API.zh-CN.md refs in the file header) ------

/** One operation inside a kernel transaction response (appendBlock/updateBlock). */
export interface SiyuanTransactionOperation {
  action: string; // 'insert' | 'update' | ...
  data: string | null; // rendered DOM of the affected block
  id: string; // affected block id (created block id for appendBlock)
  parentID?: string;
  previousID?: string;
  retData?: unknown;
}

export interface SiyuanBlockTransaction {
  doOperations: SiyuanTransactionOperation[];
  undoOperations: unknown;
}

// -- Plugin / petal feed (soft; bridge list/enable) --------------------------------------------

/** One installed plugin package as returned by /api/bazaar/getInstalledPlugin (loose). */
export interface SiyuanInstalledPluginPackage {
  name: string;
  version?: string;
  displayName?: string | Record<string, string>;
  description?: string | Record<string, string>;
  author?: string;
  enabled?: boolean;
  /** Present when kernel embeds full plugin.json fields. */
  [key: string]: unknown;
}

/** One remote Bazaar package as returned by /api/bazaar/getBazaarPlugin (loose). */
export interface SiyuanBazaarPluginPackage {
  name: string;
  version?: string;
  displayName?: string | Record<string, string>;
  description?: string | Record<string, string>;
  author?: string;
  /** True when already installed in the answering workspace. */
  installed?: boolean;
  hasUpdate?: boolean;
  repoURL?: string;
  repoHash?: string;
  iconURL?: string;
  minAppVersion?: string;
  backends?: string[];
  frontends?: string[];
  /** Present when kernel embeds fuller plugin.json fields. */
  [key: string]: unknown;
}

/** One petal row from /api/petal/loadPetals (loose). */
export interface SiyuanPetalInfo {
  name: string;
  enabled: boolean;
  version?: string;
  displayName?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------

export interface SiyuanKernelClientOptions {
  /** Kernel HTTP endpoint; default {@link SIYUAN_DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** API token (SiYuan Settings → About); sent as `Authorization: Token <token>`. */
  token: string;
  /** Per-request timeout; default 10s. Timeout maps to CONNECTION_UNAVAILABLE. */
  timeoutMs?: number;
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch;
}

interface SiyuanEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

export class SiyuanKernelClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SiyuanKernelClientOptions) {
    if (!options.token) {
      throw new KnowledgeError('CONNECTION_UNAVAILABLE', 'SiYuan kernel token is required');
    }
    this.baseUrl = (options.baseUrl ?? SIYUAN_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /** POST <baseUrl><endpoint> with auth + timeout; unwraps the kernel envelope. */
  private async post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw this.transportError(endpoint, error);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw this.httpError(endpoint, response.status);
    }

    let envelope: SiyuanEnvelope<T>;
    try {
      envelope = (await response.json()) as SiyuanEnvelope<T>;
    } catch {
      throw new KnowledgeError('PROVIDER_ERROR', `SiYuan kernel returned non-JSON for ${endpoint}`, {
        httpStatus: response.status,
      });
    }

    if (typeof envelope?.code !== 'number') {
      throw new KnowledgeError('PROVIDER_ERROR', `SiYuan kernel returned malformed envelope for ${endpoint}`, {
        body: envelope,
      });
    }
    if (envelope.code !== 0) {
      // code 3 (index in progress) is transient — surfaced with retryable flag (K-03 §3.6 degraded state)
      throw new KnowledgeError('PROVIDER_ERROR', `SiYuan kernel error (${endpoint}): ${envelope.msg}`, {
        kernelCode: envelope.code,
        kernelMsg: envelope.msg,
        retryable: envelope.code === 3,
      });
    }
    return envelope.data;
  }

  private transportError(endpoint: string, error: unknown): KnowledgeError {
    const cause = error instanceof Error ? error : new Error(String(error));
    const timedOut = cause.name === 'AbortError' || /aborted|timeout/i.test(cause.message);
    const message = timedOut
      ? `SiYuan kernel timed out after ${this.timeoutMs}ms (${endpoint})`
      : `SiYuan kernel unreachable (${endpoint}): ${cause.message}`;
    return new KnowledgeError('CONNECTION_UNAVAILABLE', message, { cause: cause.message, timedOut });
  }

  private httpError(endpoint: string, status: number): KnowledgeError {
    const details = { endpoint, httpStatus: status };
    if (status === 401 || status === 403) {
      // Token rejected/missing — settings UI flips KnowledgeConnection.status to 'needs_auth'
      return new KnowledgeError('PROVIDER_ERROR', `SiYuan kernel rejected the API token (HTTP ${status})`, details);
    }
    if (status >= 500) {
      return new KnowledgeError('CONNECTION_UNAVAILABLE', `SiYuan kernel unavailable (HTTP ${status})`, details);
    }
    return new KnowledgeError('PROVIDER_ERROR', `SiYuan kernel HTTP ${status} (${endpoint})`, details);
  }

  // -- System ---------------------------------------------------------------

  /** Kernel version string, e.g. "3.1.28" — the ENGINE_STATUS / capability-discovery probe (K-03 §3.6). */
  getVersion(): Promise<string> {
    return this.post<string>('/api/system/version', {});
  }

  getCurrentTime(): Promise<number> {
    return this.post<number>('/api/system/currentTime', {});
  }

  // -- Notebooks ------------------------------------------------------------

  async listNotebooks(): Promise<SiyuanNotebook[]> {
    const data = await this.post<{ notebooks: SiyuanNotebook[]; boxDocEnabled: boolean }>(
      '/api/notebook/lsNotebooks',
      {},
    );
    return data?.notebooks ?? [];
  }

  // -- Search ---------------------------------------------------------------

  async fullTextSearchBlock(input: SiyuanFullTextSearchInput): Promise<SiyuanFullTextSearchResult> {
    const body: Record<string, unknown> = { query: input.query };
    if (input.page !== undefined) body.page = input.page;
    if (input.pageSize !== undefined) body.pageSize = input.pageSize;
    if (input.paths?.length) body.paths = input.paths;
    if (input.types) body.types = input.types;
    if (input.subTypes) body.subTypes = input.subTypes;
    if (input.method !== undefined) body.method = input.method;
    if (input.orderBy !== undefined) body.orderBy = input.orderBy;
    if (input.groupBy !== undefined) body.groupBy = input.groupBy;
    return this.post<SiyuanFullTextSearchResult>('/api/search/fullTextSearchBlock', body);
  }

  /**
   * Read-only SQL projection (blocks table). READ-ONLY: always sent with mode: 'readonly'
   * (server-side single-statement + non-mutating check; admin role). SELECT only — enforced
   * client-side by assertSelectOnly (§3.4.2: non-SELECT throws before any network I/O).
   */
  sql<T extends SiyuanSqlRow = SiyuanSqlRow>(stmt: string): Promise<T[]> {
    assertSelectOnly(stmt);
    return this.post<T[]>('/api/query/sql', { stmt, mode: 'readonly' });
  }

  // -- Blocks ---------------------------------------------------------------

  getBlockInfo(id: string): Promise<SiyuanBlockInfo> {
    return this.post<SiyuanBlockInfo>('/api/block/getBlockInfo', { id });
  }

  async getBlockKramdown(id: string, mode: 'md' | 'textmark' = 'md'): Promise<string> {
    const data = await this.post<{ id: string; kramdown: string }>('/api/block/getBlockKramdown', { id, mode });
    return data?.kramdown ?? '';
  }

  async getChildBlocks(id: string): Promise<SiyuanChildBlock[]> {
    return (await this.post<SiyuanChildBlock[]>('/api/block/getChildBlocks', { id })) ?? [];
  }

  getDocInfo(id: string): Promise<SiyuanDocInfo> {
    return this.post<SiyuanDocInfo>('/api/block/getDocInfo', { id });
  }

  checkBlockExist(id: string): Promise<boolean> {
    return this.post<boolean>('/api/block/checkBlockExist', { id });
  }

  // -- Attributes -----------------------------------------------------------

  async getBlockAttrs(id: string): Promise<Record<string, string>> {
    return (await this.post<Record<string, string>>('/api/attr/getBlockAttrs', { id })) ?? {};
  }

  // -- Backlinks / mentions (K-03 §3.2 backlinks) ---------------------------

  /** k/mk are mandatory on the kernel side; empty strings mean "no sub-filter". */
  getBacklink(id: string, options: { k?: string; mk?: string; beforeLen?: number } = {}): Promise<SiyuanGetBacklinkResult> {
    return this.post<SiyuanGetBacklinkResult>('/api/ref/getBacklink', {
      id,
      k: options.k ?? '',
      mk: options.mk ?? '',
      ...(options.beforeLen !== undefined ? { beforeLen: options.beforeLen } : {}),
    });
  }

  getBackmentionDoc(defID: string, refTreeID: string): Promise<{ backmentions: unknown[]; keywords: string[] }> {
    return this.post('/api/ref/getBackmentionDoc', { defID, refTreeID, keyword: '' });
  }

  // -- Filetree -------------------------------------------------------------

  getHPathByID(id: string): Promise<string> {
    return this.post<string>('/api/filetree/getHPathByID', { id });
  }

  getPathByID(id: string): Promise<{ path: string; notebook: string }> {
    return this.post<{ path: string; notebook: string }>('/api/filetree/getPathByID', { id });
  }

  // -- Export (read-only markdown projection of a document) ------------------

  /** Body markdown of a document. yfm/addTitle off: stable body for contentHash. */
  exportMdContent(id: string): Promise<{ hPath: string; content: string }> {
    return this.post<{ hPath: string; content: string }>('/api/export/exportMdContent', {
      id,
      yfm: false,
      addTitle: false,
    });
  }

  // -- Mutations (P3 whitelist §3.4.1 — verbatim arg names/refs in the file header) -------------
  //
  // These four are the ONLY write methods this class will ever expose (§3.4.2). Nothing named
  // delete*/remove*/move*/rename* may be added; rollback is soft (tombstone + craft-rolled-back).

  /**
   * createDocument: create a document from GFM markdown; resolves to the new document id
   * (kernel: same-path re-call never overwrites an existing document).
   */
  createDocWithMd(input: { notebook: string; path: string; markdown: string }): Promise<string> {
    return this.post<string>('/api/filetree/createDocWithMd', {
      notebook: input.notebook,
      path: input.path,
      markdown: input.markdown,
    });
  }

  /**
   * appendBlock: append markdown as trailing children of parentID (document id for doc-end
   * appends). Resolves to the FIRST created block id (data[0].doOperations[0].id) — the anchor
   * for the §3.8 soft-rollback tombstone.
   */
  async appendBlock(input: { parentID: string; data: string; dataType?: 'markdown' | 'dom' }): Promise<string> {
    const transactions = await this.post<SiyuanBlockTransaction[]>('/api/block/appendBlock', {
      dataType: input.dataType ?? 'markdown',
      data: input.data,
      parentID: input.parentID,
    });
    const createdId = transactions?.[0]?.doOperations?.[0]?.id;
    if (!createdId) {
      throw new KnowledgeError('PROVIDER_ERROR', 'SiYuan kernel appendBlock returned no created block id', {
        endpoint: '/api/block/appendBlock',
      });
    }
    return createdId;
  }

  /** updateBlock: replace a block's content (markdown). Transaction response carries no state we need. */
  async updateBlock(input: { id: string; data: string; dataType?: 'markdown' | 'dom' }): Promise<void> {
    await this.post<SiyuanBlockTransaction[]>('/api/block/updateBlock', {
      dataType: input.dataType ?? 'markdown',
      data: input.data,
      id: input.id,
    });
  }

  /**
   * setAttribute: set IAL attrs on a block/document. Kernel requires custom-* names (doc L1050);
   * the craft-* and knowledge-* allowlist guard runs in mutations.ts validators before this call.
   */
  async setBlockAttrs(input: { id: string; attrs: Record<string, string> }): Promise<void> {
    await this.post<null>('/api/attr/setBlockAttrs', { id: input.id, attrs: input.attrs });
  }

  // -- Plugins / petals (soft bridge feed; callers MUST soft-fail) ------------------------------

  /**
   * Installed Bazaar plugins for a frontend. Kernel shapes vary slightly across versions —
   * data may be a package array or `{ packages: [...] }`. Normalized to an array.
   */
  async getInstalledPlugin(frontend: string = 'desktop'): Promise<SiyuanInstalledPluginPackage[]> {
    const data = await this.post<unknown>('/api/bazaar/getInstalledPlugin', { frontend });
    return normalizeInstalledPluginPackages(data);
  }

  /**
   * Remote Bazaar plugin catalog for a frontend (optional keyword filter).
   * Kernel returns `{ packages: [...] }` (sometimes a bare array). Soft-fail callers
   * must tolerate network/auth failures — this method still throws on kernel errors.
   */
  async getBazaarPlugin(
    frontend: string = 'desktop',
    keyword: string = '',
  ): Promise<SiyuanBazaarPluginPackage[]> {
    const data = await this.post<unknown>('/api/bazaar/getBazaarPlugin', { frontend, keyword });
    return normalizeBazaarPluginPackages(data);
  }

  /**
   * Load petal (plugin enable) state for a frontend. data may be an array or a map.
   */
  async loadPetals(frontend: string = 'desktop'): Promise<SiyuanPetalInfo[]> {
    const data = await this.post<unknown>('/api/petal/loadPetals', { frontend });
    return normalizePetalInfos(data);
  }

  /** Enable/disable a petal package in the running kernel (soft; does not rewrite disk from Craft). */
  async setPetalEnabled(packageName: string, enabled: boolean): Promise<void> {
    await this.post<unknown>('/api/petal/setPetalEnabled', { packageName, enabled });
  }

  /**
   * Install a Bazaar plugin via the kernel (kernel downloads/installs the package).
   * Craft never downloads the plugin zip itself (G2).
   */
  async installBazaarPlugin(input: {
    packageName: string
    repoURL: string
    repoHash: string
    frontend?: string
    keyword?: string
  }): Promise<void> {
    await this.post<unknown>('/api/bazaar/installBazaarPlugin', {
      frontend: input.frontend ?? 'desktop',
      repoURL: input.repoURL,
      repoHash: input.repoHash,
      packageName: input.packageName,
      ...(input.keyword !== undefined ? { keyword: input.keyword } : {}),
    })
  }

  /**
   * Uninstall a Bazaar plugin via the kernel. Does not rewrite petals.json from Craft.
   */
  async uninstallBazaarPlugin(input: {
    packageName: string
    frontend?: string
    keyword?: string
  }): Promise<void> {
    await this.post<unknown>('/api/bazaar/uninstallBazaarPlugin', {
      packageName: input.packageName,
      ...(input.frontend !== undefined ? { frontend: input.frontend } : {}),
      ...(input.keyword !== undefined ? { keyword: input.keyword } : {}),
    })
  }
}

function isNamedPackage(item: unknown): item is SiyuanInstalledPluginPackage {
  if (!item || typeof item !== 'object') return false;
  if (!('name' in item)) return false;
  return typeof item.name === 'string' && item.name.length > 0;
}

function normalizeInstalledPluginPackages(data: unknown): SiyuanInstalledPluginPackage[] {
  if (Array.isArray(data)) return data.filter(isNamedPackage);
  if (data && typeof data === 'object' && 'packages' in data) {
    const packages = data.packages;
    if (Array.isArray(packages)) return packages.filter(isNamedPackage);
  }
  return [];
}

function normalizeBazaarPluginPackages(data: unknown): SiyuanBazaarPluginPackage[] {
  // Same envelope shapes as installed: bare array or { packages: [...] }.
  return normalizeInstalledPluginPackages(data);
}

function normalizePetalInfos(data: unknown): SiyuanPetalInfo[] {
  if (Array.isArray(data)) {
    const out: SiyuanPetalInfo[] = [];
    for (const item of data) {
      if (!item || typeof item !== 'object' || !('name' in item)) continue;
      const name = item.name;
      if (typeof name !== 'string' || !name) continue;
      const enabled = 'enabled' in item && typeof item.enabled === 'boolean' ? item.enabled : true;
      const row: SiyuanPetalInfo = { name, enabled };
      if ('version' in item && typeof item.version === 'string') row.version = item.version;
      if ('displayName' in item && typeof item.displayName === 'string') row.displayName = item.displayName;
      out.push(row);
    }
    return out;
  }
  if (data && typeof data === 'object') {
    const out: SiyuanPetalInfo[] = [];
    for (const [name, value] of Object.entries(data as Record<string, unknown>)) {
      if (!name) continue;
      if (typeof value === 'boolean') {
        out.push({ name, enabled: value });
        continue;
      }
      if (value && typeof value === 'object') {
        const enabled = 'enabled' in value && typeof value.enabled === 'boolean' ? value.enabled : true;
        out.push({ name, enabled });
      }
    }
    return out;
  }
  return [];
}
