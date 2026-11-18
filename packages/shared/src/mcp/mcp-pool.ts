/**
 * Centralized MCP Client Pool
 *
 * Owns all MCP source connections in the main Electron process.
 * All backends (Claude, Pi) receive proxy tool definitions
 * and route tool calls through this pool instead of managing MCP connections
 * themselves.
 *
 * Benefits:
 * - One MCP code path for all backends
 * - Shared clients across sessions (e.g., same Linear connection)
 * - No credential cache files — main process has direct access
 * - Runtime source switching without session restart
 */

import {
  CraftMcpClient,
  type McpClientConfig,
  type PoolCallToolOptions,
  type PoolClient,
  type PoolRequestOptions,
} from './client.ts';
import { ApiSourcePoolClient } from './api-source-pool-client.ts';
import { nextAvailableProxyName, proxyToolName } from './proxy-tool-name.ts';
import type { SdkMcpServerConfig } from '../agent/backend/types.ts';
import type { ContentBlock, Prompt, Resource, ResourceTemplate, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isLocalMcpEnabled } from '../workspaces/storage.ts';
import { guardLargeResult } from '../utils/large-response.ts';
import {
  saveBinaryResponse,
  detectExtensionFromMagic,
  getMimeExtension,
  sanitizeFilename,
} from '../utils/binary-detection.ts';

/**
 * Configuration for an in-process API source server.
 * Used by sync() to connect API sources alongside MCP sources.
 */
export interface ApiServerConfig {
  type: 'sdk';
  instance: McpServer;
}

/**
 * Proxy tool definition — the format passed to backends for registration.
 * Uses mcp__{slug}__{toolName} naming convention.
 */
export interface ProxyToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Result of an MCP tool call, matching the subprocess protocol format.
 */
export interface McpToolResult {
  content: string;
  isError: boolean;
  /** Source slug for error attribution (set on failure) */
  sourceSlug?: string;
}

/** Item count from the first page of an MCP list call. */
export interface McpListCount {
  count: number;
  /** The server returned a next-page cursor, so `count` is a lower bound */
  more: boolean;
}

/**
 * What a connected MCP server offers beyond tools, recorded when it connects so
 * the per-turn source state can point the agent at it. A count is absent when
 * the server did not declare the capability or the list call failed.
 */
export interface McpSourceFeatures {
  /** The server's `instructions` from the initialize handshake */
  instructions?: string;
  resources?: McpListCount;
  resourceTemplates?: McpListCount;
  prompts?: McpListCount;
}

/** Resources and resource templates a source publishes. */
export interface McpResourceListing {
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  /** Listing stopped at the page cap while the server still had pages */
  truncated: boolean;
}

/** Prompts a source publishes. */
export interface McpPromptListing {
  prompts: Prompt[];
  /** Listing stopped at the page cap while the server still had pages */
  truncated: boolean;
}

/** Pages read per list call: a server that keeps paginating must not stall the turn. */
const MAX_LIST_PAGES = 10;

/** Timeout for each connect-time feature probe request (best effort). */
const FEATURE_PROBE_TIMEOUT_MS = 3_000;

/** Pool client methods each feature needs; API source clients have none of them. */
const FEATURE_METHODS = {
  resources: ['getServerCapabilities', 'listResources', 'listResourceTemplates', 'readResource'],
  prompts: ['getServerCapabilities', 'listPrompts', 'getPrompt'],
} as const satisfies Record<'resources' | 'prompts', ReadonlyArray<keyof PoolClient>>;

interface ListPage<T> {
  items: T[];
  nextCursor?: string;
}

// Page readers per list kind; callers check that the client has the method.
const resourcePages = (client: PoolClient, options?: PoolRequestOptions) =>
  async (cursor?: string): Promise<ListPage<Resource>> => {
    const page = await client.listResources!(cursor, options);
    return { items: page.resources, nextCursor: page.nextCursor };
  };
const resourceTemplatePages = (client: PoolClient, options?: PoolRequestOptions) =>
  async (cursor?: string): Promise<ListPage<ResourceTemplate>> => {
    const page = await client.listResourceTemplates!(cursor, options);
    return { items: page.resourceTemplates, nextCursor: page.nextCursor };
  };
const promptPages = (client: PoolClient, options?: PoolRequestOptions) =>
  async (cursor?: string): Promise<ListPage<Prompt>> => {
    const page = await client.listPrompts!(cursor, options);
    return { items: page.prompts, nextCursor: page.nextCursor };
  };

/**
 * Follow `nextCursor` up to MAX_LIST_PAGES. A cursor the server already returned
 * ends the walk: following it would only repeat pages.
 */
async function readAllPages<T>(readPage: (cursor?: string) => Promise<ListPage<T>>): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await readPage(cursor);
    items.push(...result.items);
    if (!result.nextCursor || seen.has(result.nextCursor)) return { items, truncated: false };
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  return { items, truncated: true };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Convert SdkMcpServerConfig (used by backend types) to CraftMcpClient config.
 */
function sdkConfigToClientConfig(config: SdkMcpServerConfig): McpClientConfig | null {
  if (config.type === 'http' || config.type === 'sse') {
    return {
      transport: 'http',
      url: config.url,
      headers: config.headers,
    };
  }
  if (config.type === 'stdio') {
    return {
      transport: 'stdio',
      command: config.command,
      args: config.args,
      env: config.env,
    };
  }
  return null;
}

/**
 * Check if an MCP source's config has changed in a way that requires reconnection.
 * Compares auth headers (token refresh) and URL changes.
 * Ignores stdio sources since they don't use OAuth tokens.
 */
function mcpConfigChanged(oldConfig: SdkMcpServerConfig, newConfig: SdkMcpServerConfig): boolean {
  if (oldConfig.type !== newConfig.type) return true;

  if (
    (oldConfig.type === 'http' || oldConfig.type === 'sse') &&
    (newConfig.type === 'http' || newConfig.type === 'sse')
  ) {
    if (oldConfig.url !== newConfig.url) return true;
    const oldAuth = oldConfig.headers?.['Authorization'];
    const newAuth = newConfig.headers?.['Authorization'];
    if (oldAuth !== newAuth) return true;
  }

  return false;
}

export class McpClientPool {
  /** Active MCP clients keyed by source slug */
  private clients = new Map<string, PoolClient>();

  /** Configs used for active MCP connections (for change detection during sync) */
  protected activeConfigs = new Map<string, SdkMcpServerConfig>();

  /** Cached tool lists keyed by source slug */
  private toolCache = new Map<string, Tool[]>();

  /** What each MCP server offers beyond tools, recorded at connect (keyed by source slug) */
  private features = new Map<string, McpSourceFeatures>();

  /** In-flight feature probes (keyed by source slug); they run after the connection is usable. */
  private featureProbes = new Map<string, Promise<void>>();

  /** Proxy tool name → { slug, originalName } (e.g., "mcp__linear__createIssue" → { slug: "linear", originalName: "createIssue" }) */
  private proxyTools = new Map<string, { slug: string; originalName: string }>();

  /**
   * Assigned proxy name per source tool, keyed by JSON `[slug, originalName]`.
   * This is the single source of truth for which name a tool was registered
   * under: when two distinct tool names sanitize to the same proxy name, the
   * later one is assigned a `__2`/`__3` suffix (#1002), so the name cannot be
   * re-derived from (slug, tool name) alone. Emitters and dispatchers must
   * look the assigned name up here instead of recomputing it.
   */
  private proxyNameByTool = new Map<string, string>();

  /** Optional debug logger */
  private debugFn: ((msg: string) => void) | undefined;

  /** Workspace root path for local MCP filtering */
  private workspaceRootPath?: string;

  /** Session storage path for saving large responses */
  private sessionPath?: string;

  /** Summarize callback for large response handling */
  private summarizeCallback?: (prompt: string) => Promise<string | null>;

  /** Called after sync() connects/disconnects sources, so clients can be notified */
  onToolsChanged?: () => void;

  constructor(options?: { debug?: (msg: string) => void; workspaceRootPath?: string; sessionPath?: string }) {
    this.debugFn = options?.debug;
    this.workspaceRootPath = options?.workspaceRootPath;
    this.sessionPath = options?.sessionPath;
  }

  /**
   * Set the summarize callback for large response handling.
   * Typically called after agent creation: pool.setSummarizeCallback(agent.getSummarizeCallback())
   */
  setSummarizeCallback(fn: (prompt: string) => Promise<string | null>): void {
    this.summarizeCallback = fn;
  }

  private debug(msg: string): void {
    this.debugFn?.(`[McpClientPool] ${msg}`);
  }

  // ============================================================
  // Connection Lifecycle
  // ============================================================

  /**
   * Register a client: connect, cache tools, build proxy mappings.
   * Shared logic for both remote MCP and in-process API sources.
   */
  protected async registerClient(slug: string, client: PoolClient): Promise<void> {
    // listTools() triggers connect() internally for both CraftMcpClient and ApiSourcePoolClient
    const tools = await client.listTools();
    this.clients.set(slug, client);
    this.toolCache.set(slug, tools);

    const takenNames = new Set(this.proxyTools.keys());
    for (const tool of tools) {
      const toolKey = McpClientPool.toolKey(slug, tool.name);
      // Re-registering the same tool (duplicate listTools entry, reconnect of
      // an already-registered client) keeps its existing assignment.
      const alreadyAssigned = this.proxyNameByTool.get(toolKey);
      if (alreadyAssigned) {
        this.proxyTools.set(alreadyAssigned, { slug, originalName: tool.name });
        takenNames.add(alreadyAssigned);
        continue;
      }
      const baseName = proxyToolName(slug, tool.name);
      const proxyName = nextAvailableProxyName(baseName, takenNames);
      takenNames.add(proxyName);
      if (proxyName !== baseName) {
        // Two distinct MCP tool names sanitized to the same proxy name (e.g.
        // `pat.batch` and `pat_batch`). A silent overwrite would route later
        // calls to the wrong original tool (#864), and keep-first would make
        // the later tool uncallable — so the later tool gets a deterministic
        // suffix instead (#1002). Assignments follow registration order, so
        // the same tool list always produces the same names across reconnects.
        console.warn(`[McpClientPool] Proxy name collision on ${baseName} (source ${slug}): registering ${tool.name} as ${proxyName} to keep both tools callable`);
        this.debug(`Proxy name collision on ${baseName}: registering ${tool.name} as ${proxyName}`);
      }
      this.proxyTools.set(proxyName, { slug, originalName: tool.name });
      this.proxyNameByTool.set(toolKey, proxyName);
    }

    // In the background: a slow server must not hold up the source's tools (the probe can
    // take its full timeout). The <sources> block shows the features once they are known.
    const probe = this.probeFeatures(slug, client).then((features) => {
      // A disconnect or reconnect during the probe wins: record nothing for a client that is gone.
      if (this.clients.get(slug) !== client) return;
      if (features) this.features.set(slug, features);
      else this.features.delete(slug);
    }).finally(() => {
      if (this.featureProbes.get(slug) === probe) this.featureProbes.delete(slug);
    });
    this.featureProbes.set(slug, probe);

    this.debug(`Connected source ${slug}: ${tools.length} tools`);
  }

  /** Resolves once the source's feature probe (started at connect) has finished. */
  async whenFeaturesProbed(slug: string): Promise<void> {
    await this.featureProbes.get(slug);
  }

  /**
   * Record what an MCP server offers beyond tools: its instructions (free, from
   * the handshake) and how many resources, resource templates and prompts it
   * lists. Counts rather than capabilities, because common server frameworks
   * (e.g. Python FastMCP) declare resources and prompts even when they publish
   * none. Reads one page per list, in parallel, with a short timeout; best
   * effort, it never fails the connection.
   */
  private async probeFeatures(slug: string, client: PoolClient): Promise<McpSourceFeatures | undefined> {
    const capabilities = client.getServerCapabilities?.();
    if (!capabilities) return undefined;

    const options: PoolRequestOptions = { timeoutMs: FEATURE_PROBE_TIMEOUT_MS };
    const countFirstPage = async (label: string, readPage: (() => Promise<ListPage<unknown>>) | undefined): Promise<McpListCount | undefined> => {
      if (!readPage) return undefined;
      try {
        const page = await readPage();
        return { count: page.items.length, more: !!page.nextCursor };
      } catch (error) {
        this.debug(`Could not list ${label} of ${slug}: ${errorMessage(error)}`);
        return undefined;
      }
    };
    const [resources, resourceTemplates, prompts] = await Promise.all([
      countFirstPage('resources', capabilities.resources && client.listResources ? resourcePages(client, options) : undefined),
      countFirstPage('resource templates', capabilities.resources && client.listResourceTemplates ? resourceTemplatePages(client, options) : undefined),
      countFirstPage('prompts', capabilities.prompts && client.listPrompts ? promptPages(client, options) : undefined),
    ]);
    const instructions = client.getInstructions?.()?.trim() || undefined;

    return {
      ...(instructions ? { instructions } : {}),
      ...(resources ? { resources } : {}),
      ...(resourceTemplates ? { resourceTemplates } : {}),
      ...(prompts ? { prompts } : {}),
    };
  }

  /**
   * Connect to an MCP source server (remote HTTP/SSE/stdio).
   * If already connected, this is a no-op.
   */
  async connect(slug: string, config: SdkMcpServerConfig): Promise<void> {
    if (this.clients.has(slug)) return;
    const clientConfig = sdkConfigToClientConfig(config);
    if (!clientConfig) {
      this.debug(`Unknown MCP server type for ${slug}: ${(config as { type: string }).type}`);
      return;
    }
    await this.registerClient(slug, new CraftMcpClient(clientConfig));
    this.activeConfigs.set(slug, config);
  }

  /**
   * Connect to an in-process MCP server (API source) via in-memory transport.
   */
  async connectInProcess(slug: string, mcpServer: McpServer): Promise<void> {
    if (this.clients.has(slug)) return;
    await this.registerClient(slug, new ApiSourcePoolClient(mcpServer));
  }

  /**
   * Ensure one source is connected with the given config, without touching
   * other pool members (unlike sync(), which reconciles the full set).
   * Reconnects when the config changed (e.g. refreshed OAuth token), and
   * applies the same local-MCP gate as sync(): stdio configs are refused
   * when local MCP is disabled for this workspace.
   *
   * @throws Error for stdio configs while local MCP is disabled, and on
   *   connection failure (propagated from connect()).
   */
  async ensureConnected(slug: string, config: SdkMcpServerConfig): Promise<void> {
    if (config.type === 'stdio' && this.workspaceRootPath && !isLocalMcpEnabled(this.workspaceRootPath)) {
      throw new Error(`Local MCP is disabled for this workspace — cannot connect stdio source "${slug}"`);
    }

    if (this.clients.has(slug)) {
      const oldConfig = this.activeConfigs.get(slug);
      if (!oldConfig || !mcpConfigChanged(oldConfig, config)) return;
      this.debug(`Config changed for ${slug}, reconnecting with fresh credentials`);
      await this.disconnect(slug);
    }

    await this.connect(slug, config);
  }

  /**
   * Disconnect a source and remove its tools from the pool.
   */
  async disconnect(slug: string): Promise<void> {
    const client = this.clients.get(slug);
    if (client) {
      await client.close().catch(() => {});
      this.clients.delete(slug);
    }

    // Remove proxy tool entries for this slug
    for (const [proxyName, info] of this.proxyTools) {
      if (info.slug === slug) this.proxyTools.delete(proxyName);
    }
    for (const toolKey of this.proxyNameByTool.keys()) {
      try {
        if ((JSON.parse(toolKey) as [string, string])[0] === slug) this.proxyNameByTool.delete(toolKey);
      } catch { /* keys are only written by toolKey(); ignore malformed ones */ }
    }
    this.toolCache.delete(slug);
    this.features.delete(slug);
    this.activeConfigs.delete(slug);
    this.debug(`Disconnected source: ${slug}`);
  }

  /**
   * Disconnect all sources and clear all state.
   */
  async disconnectAll(): Promise<void> {
    const closePromises = Array.from(this.clients.values()).map(c => c.close().catch(() => {}));
    await Promise.all(closePromises);
    this.clients.clear();
    this.toolCache.clear();
    this.features.clear();
    this.proxyTools.clear();
    this.proxyNameByTool.clear();
    this.activeConfigs.clear();
    this.debug('Disconnected all MCP clients');
  }

  // ============================================================
  // Sync: Reconcile active sources
  // ============================================================

  /**
   * Sync the pool to match a desired set of MCP + API sources.
   * Connects new sources, disconnects removed ones, keeps existing ones.
   *
   * @param mcpServers - Map of slug → config for desired MCP sources
   * @param apiServers - Map of slug → config for desired API sources
   * @returns List of slugs that failed to connect
   */
  async sync(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, ApiServerConfig> = {}
  ): Promise<string[]> {
    // Filter out stdio sources when local MCP is disabled for this workspace.
    const localEnabled = !this.workspaceRootPath || isLocalMcpEnabled(this.workspaceRootPath);
    const filteredMcp: Record<string, SdkMcpServerConfig> = {};
    for (const [slug, config] of Object.entries(mcpServers)) {
      if (config.type === 'stdio' && !localEnabled) {
        this.debug(`Filtering out stdio source "${slug}" (local MCP disabled)`);
        continue;
      }
      filteredMcp[slug] = config;
    }

    // Extract McpServer instances from API configs
    const apiSlugs = new Map<string, McpServer>();
    for (const [slug, config] of Object.entries(apiServers)) {
      if (config?.type === 'sdk' && config.instance) {
        apiSlugs.set(slug, config.instance);
      }
    }

    const desiredSlugs = new Set([...Object.keys(filteredMcp), ...apiSlugs.keys()]);
    const currentSlugs = new Set(this.clients.keys());
    const failures: string[] = [];

    // Disconnect sources no longer desired — run in parallel, failures are non-fatal.
    await Promise.all(
      [...currentSlugs].filter(slug => !desiredSlugs.has(slug)).map(slug => this.disconnect(slug))
    );

    // Build a list of (slug, connectFn) pairs for sources that need to come up.
    // Changed sources (token refresh, URL change) are disconnected first, then
    // queued alongside new sources so all connections run concurrently.
    const toConnect: Array<{ slug: string; connectFn: () => Promise<void> }> = [];

    for (const [slug, config] of Object.entries(filteredMcp)) {
      if (!currentSlugs.has(slug)) {
        toConnect.push({ slug, connectFn: () => this.connect(slug, config) });
      } else {
        const oldConfig = this.activeConfigs.get(slug);
        if (oldConfig && mcpConfigChanged(oldConfig, config)) {
          this.debug(`Config changed for ${slug}, reconnecting with fresh credentials`);
          await this.disconnect(slug);
          toConnect.push({ slug, connectFn: () => this.connect(slug, config) });
        }
      }
    }

    for (const [slug, server] of apiSlugs) {
      if (!currentSlugs.has(slug)) {
        toConnect.push({ slug, connectFn: () => this.connectInProcess(slug, server) });
      }
    }

    // Connect all new/reconnected sources in parallel and collect failures.
    const connectResults = await Promise.allSettled(toConnect.map(({ connectFn }) => connectFn()));
    connectResults.forEach((result, i) => {
      if (result.status === 'rejected') {
        const slug = toConnect[i]!.slug;
        const msg = result.reason instanceof Error ? (result.reason as Error).message : String(result.reason);
        console.warn(`[McpClientPool] Failed to connect source "${slug}": ${msg}`);
        this.debug(`Failed to connect source ${slug}: ${msg}`);
        failures.push(slug);
      }
    });

    this.onToolsChanged?.();
    return failures;
  }

  // ============================================================
  // Tool Discovery
  // ============================================================

  /**
   * Get cached tools for a source. Returns empty array if not connected.
   */
  getTools(slug: string): Tool[] {
    return this.toolCache.get(slug) || [];
  }

  /**
   * Get all connected source slugs.
   */
  getConnectedSlugs(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Check if a source is connected.
   */
  isConnected(slug: string): boolean {
    return this.clients.has(slug);
  }

  /**
   * What a connected MCP source offers beyond tools (instructions, resource and
   * prompt counts), recorded when it connected. Undefined for API sources and
   * sources that are not connected.
   */
  getSourceFeatures(slug: string): McpSourceFeatures | undefined {
    return this.features.get(slug);
  }

  /**
   * Generate proxy tool definitions for all connected sources (or a subset).
   * These are passed to backends for tool registration.
   */
  getProxyToolDefs(slugs?: string[]): ProxyToolDef[] {
    const targetSlugs = slugs || Array.from(this.toolCache.keys());
    const defs: ProxyToolDef[] = [];
    const seen = new Set<string>();

    for (const slug of targetSlugs) {
      const tools = this.toolCache.get(slug) || [];
      for (const tool of tools) {
        // Emit the name registerClient assigned this tool — after a collision
        // that is the suffixed name, not the recomputed base name — so the
        // emitted defs and the dispatch map stay in sync (#864, #1002). The
        // `seen` guard only dedupes a server listing the exact same tool twice.
        const name = this.resolveProxyName(slug, tool.name);
        if (seen.has(name)) continue;
        seen.add(name);
        // Strip $schema — AJV (Pi agent) fails on unregistered meta-schema URIs.
        // Same pattern as getToolDefsAsJsonSchema() in tool-defs.ts.
        const { $schema, ...cleanSchema } = (tool.inputSchema as Record<string, unknown>) || {};
        defs.push({
          name,
          description: tool.description || `Tool from ${slug}`,
          inputSchema: Object.keys(cleanSchema).length > 0 ? cleanSchema : { type: 'object', properties: {} },
        });
      }
    }

    return defs;
  }

  // ============================================================
  // Tool Execution
  // ============================================================

  /**
   * Execute an MCP tool by its proxy name (mcp__{slug}__{toolName}).
   * Returns a result matching the subprocess protocol format.
   */
  async callTool(proxyName: string, args: Record<string, unknown>, options?: PoolCallToolOptions): Promise<McpToolResult> {
    const info = this.proxyTools.get(proxyName);
    if (!info) {
      return {
        content: `Unknown MCP proxy tool: ${proxyName}`,
        isError: true,
      };
    }

    const { slug, originalName } = info;

    const client = this.clients.get(slug);
    if (!client) {
      return {
        content: `MCP client for source "${slug}" is not connected.`,
        isError: true,
        sourceSlug: slug,
      };
    }

    try {
      const result = await client.callTool(originalName, args, options) as {
        content?: Array<{ type: string; text?: unknown; data?: string; mimeType?: string }>;
        isError?: boolean;
      };

      const contentBlocks = result.content || [];
      const parts: string[] = [];

      // 1. Process each content block — handle text, image, audio
      for (const block of contentBlocks) {
        if (block.type === 'text') {
          // Handle non-string text fields (e.g., objects from non-conforming servers)
          if (typeof block.text === 'string') {
            parts.push(block.text);
          } else if (block.text !== undefined && block.text !== null) {
            parts.push(JSON.stringify(block.text, null, 2));
          }
        } else if ((block.type === 'image' || block.type === 'audio') && block.data) {
          // Decode base64 binary content and save to downloads/ (skipped when it can't be saved)
          const saved = this.saveBase64(proxyName, block.type === 'image' ? 'Image' : 'Audio', block.data, block.mimeType);
          if (saved) parts.push(saved);
        }
      }

      // 2. Combine parts (fallback to JSON.stringify if no content extracted)
      const text = parts.join('\n') || JSON.stringify(result);

      // 3. Centralized binary + large response handling (error results pass through as-is)
      return {
        content: result.isError ? text : await this.guardText(text, proxyName, args, options?.intent),
        isError: !!result.isError,
      };
    } catch (err) {
      return {
        content: `MCP tool "${originalName}" (source: ${slug}) failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
        sourceSlug: slug,
      };
    }
  }

  /**
   * Check if a tool name is an MCP proxy tool managed by this pool.
   */
  isProxyTool(toolName: string): boolean {
    return this.proxyTools.has(toolName);
  }

  /** Map key for one source tool in `proxyNameByTool`. */
  private static toolKey(slug: string, originalName: string): string {
    return JSON.stringify([slug, originalName]);
  }

  /**
   * The proxy name a source tool was assigned at registration. Callers that
   * need to invoke or reference a tool by its (slug, original name) pair must
   * use this instead of recomputing `proxyToolName(...)`: after a collision
   * the assigned name carries a `__2`/`__3` suffix (#1002), and recomputing
   * would silently address the first colliding tool instead. Falls back to
   * the plain sanitized name for tools this pool has not registered.
   */
  resolveProxyName(slug: string, originalName: string): string {
    return this.proxyNameByTool.get(McpClientPool.toolKey(slug, originalName)) ?? proxyToolName(slug, originalName);
  }

  // ============================================================
  // Resources & Prompts
  // ============================================================

  /**
   * The client for a resources/prompts call on a connected source. Throws an
   * error the agent can act on when the source is not connected, is an API
   * source, or its server did not declare the capability (the SDK only checks
   * capabilities in strict mode, so the call would otherwise fail with a vaguer
   * protocol error).
   */
  private requireFeature(slug: string, feature: 'resources' | 'prompts'): PoolClient {
    const client = this.clients.get(slug);
    if (!client) {
      throw new Error(`Source "${slug}" is not connected (it may need authentication or have failed to connect).`);
    }
    if (FEATURE_METHODS[feature].some(method => typeof client[method] !== 'function')) {
      throw new Error(`Source "${slug}" is an API source; only MCP sources offer resources and prompts.`);
    }
    if (!client.getServerCapabilities!()?.[feature]) {
      throw new Error(`Source "${slug}" does not offer ${feature}: its MCP server did not declare the ${feature} capability.`);
    }
    return client;
  }

  /**
   * List a source's resources and resource templates, following pagination up
   * to MAX_LIST_PAGES. Templates are optional within the resources capability
   * (servers without any often answer "method not found"), so a failed template
   * list yields none instead of failing the call.
   */
  async listResources(slug: string): Promise<McpResourceListing> {
    const client = this.requireFeature(slug, 'resources');
    const [resources, templates] = await Promise.allSettled([
      readAllPages(resourcePages(client)),
      readAllPages(resourceTemplatePages(client)),
    ]);
    if (resources.status === 'rejected') throw resources.reason;
    if (templates.status === 'rejected') {
      this.debug(`Could not list resource templates of ${slug}: ${errorMessage(templates.reason)}`);
    }
    const templateItems = templates.status === 'fulfilled' ? templates.value : { items: [], truncated: false };
    return {
      resources: resources.value.items,
      resourceTemplates: templateItems.items,
      truncated: resources.value.truncated || templateItems.truncated,
    };
  }

  /**
   * Read a resource as agent-ready text: text contents joined (with a header per
   * item when there are several), blob contents saved to downloads/ like tool
   * blobs, and the large-result guard tool results get.
   */
  async readResource(slug: string, uri: string): Promise<string> {
    const client = this.requireFeature(slug, 'resources');
    const { contents = [] } = await client.readResource!(uri);
    const parts = contents.map(item => {
      const body = 'text' in item && typeof item.text === 'string'
        ? item.text
        : 'blob' in item && typeof item.blob === 'string'
          ? this.saveBase64(`${slug}_resource`, 'Resource', item.blob, item.mimeType)
            ?? `[Binary content (${item.mimeType ?? 'unknown type'}) could not be saved]`
          : '';
      return contents.length > 1 ? `--- ${item.uri}${item.mimeType ? ` (${item.mimeType})` : ''} ---\n${body}` : body;
    });
    const text = parts.join('\n\n') || `Resource ${uri} has no content.`;
    return this.guardText(text, 'source_read_resource', { sourceSlug: slug, uri });
  }

  /** List a source's prompts, following pagination up to MAX_LIST_PAGES. */
  async listPrompts(slug: string): Promise<McpPromptListing> {
    const client = this.requireFeature(slug, 'prompts');
    const { items, truncated } = await readAllPages(promptPages(client));
    return { prompts: items, truncated };
  }

  /**
   * Get a prompt with its arguments filled in, rendered as text: a role header
   * per message, text as-is, embedded text resources inlined, binary parts saved
   * to downloads/, and the large-result guard tool results get.
   */
  async getPrompt(slug: string, name: string, args?: Record<string, string>): Promise<string> {
    const client = this.requireFeature(slug, 'prompts');
    const result = await client.getPrompt!(name, args);
    const sections = (result.messages ?? []).map(message => `[${message.role}]\n${this.renderPromptContent(slug, message.content)}`);
    if (sections.length === 0) return `Prompt "${name}" returned no messages.`;
    const text = [...(result.description ? [`Description: ${result.description}`] : []), ...sections].join('\n\n');
    return this.guardText(text, 'source_get_prompt', { sourceSlug: slug, name, ...(args ? { arguments: args } : {}) });
  }

  private renderPromptContent(slug: string, content: ContentBlock): string {
    switch (content.type) {
      case 'text':
        return content.text;
      case 'resource': {
        const { resource } = content;
        const label = `${resource.uri}${resource.mimeType ? ` (${resource.mimeType})` : ''}`;
        if ('text' in resource && typeof resource.text === 'string') return `[Resource ${label}]\n${resource.text}`;
        if ('blob' in resource && typeof resource.blob === 'string') {
          return this.saveBase64(`${slug}_resource`, 'Resource', resource.blob, resource.mimeType)
            ?? `[Binary resource ${label} could not be saved]`;
        }
        return `[Resource ${label}]`;
      }
      case 'image':
      case 'audio': {
        const kind = content.type === 'image' ? 'Image' : 'Audio';
        return this.saveBase64(`${slug}_prompt`, kind, content.data, content.mimeType)
          ?? `[${kind} (${content.mimeType}) could not be saved]`;
      }
      case 'resource_link':
        return `[Resource link: ${content.uri}${content.name ? ` (${content.name})` : ''}. Read it with source_read_resource.]`;
      default:
        return `[${(content as { type?: string }).type ?? 'Unknown'} content omitted]`;
    }
  }

  // ============================================================
  // Content handling (shared by tool, resource and prompt results)
  // ============================================================

  /**
   * Decode base64 MCP content (image/audio blocks, resource blobs) into the
   * session's downloads/ folder and describe it for the agent. Null when there
   * is no session folder or the save failed.
   */
  private saveBase64(label: string, kind: string, data: string, mimeType?: string): string | null {
    if (!this.sessionPath) return null;
    try {
      const buffer = Buffer.from(data, 'base64');
      const ext = detectExtensionFromMagic(buffer) || getMimeExtension(mimeType ?? null) || '.bin';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `${sanitizeFilename(label)}_${timestamp}${ext}`;
      const saved = saveBinaryResponse(this.sessionPath, filename, buffer, mimeType ?? null);
      return saved.type === 'file_download' ? `[${kind} saved: ${saved.path} (${saved.sizeHuman})]` : null;
    } catch {
      // Base64 decode failed
      return null;
    }
  }

  /** Large results are saved to long_responses/ and replaced by a summary or preview. */
  private async guardText(text: string, toolName: string, input: Record<string, unknown>, intent?: string): Promise<string> {
    if (!this.sessionPath) return text;
    const guarded = await guardLargeResult(text, {
      sessionPath: this.sessionPath,
      toolName,
      input,
      intent,
      summarize: this.summarizeCallback,
    });
    return guarded ?? text;
  }
}
