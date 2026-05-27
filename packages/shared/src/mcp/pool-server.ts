/**
 * MCP Pool Server
 *
 * Serves McpClientPool tools over HTTP using the MCP Streamable HTTP protocol.
 * This allows external SDK subprocesses (Codex, Copilot) to access pool-managed
 * MCP source tools through a single HTTP endpoint instead of connecting to each
 * source independently.
 *
 * Uses Streamable HTTP transport in stateless mode because Codex uses the
 * Streamable HTTP protocol (POST-based JSON-RPC). Stateless mode means no
 * session tracking — each request is independent.
 *
 * Architecture:
 *   Codex/Copilot SDK subprocess
 *       ↓ (HTTP Streamable HTTP protocol)
 *   McpPoolServer (this, in Electron main process)
 *       ↓
 *   McpClientPool
 *       ↓ (per-source MCP connections)
 *   Linear / GitHub / Notion / etc.
 */

import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpClientPool, McpClientPoolCallOptions } from './mcp-pool.ts';

/** Constructor options for {@link McpPoolServer}. */
export interface McpPoolServerOptions {
  /** Optional debug logger. Messages are prefixed with `[McpPoolServer]`. */
  debug?: (msg: string) => void;
  /** Source slugs whose tools should be exposed by tools/list. */
  slugFilter?: string[];
  /** Session storage path used for binary response downloads and large-response files. */
  sessionPath?: string;
  /** Returns additional per-call options, such as the active session summarizer. */
  getCallToolOptions?: () => McpClientPoolCallOptions;
}

export class McpPoolServer {
  private pool: McpClientPool;
  private httpServer: HttpServer | null = null;
  private debugFn: ((msg: string) => void) | undefined;
  private slugFilter: string[] | undefined;
  private sessionPath: string | undefined;
  private getCallToolOptions: (() => McpClientPoolCallOptions) | undefined;
  private _port = 0;

  constructor(pool: McpClientPool, options?: McpPoolServerOptions) {
    this.pool = pool;
    this.debugFn = options?.debug;
    this.slugFilter = options?.slugFilter;
    this.sessionPath = options?.sessionPath;
    this.getCallToolOptions = options?.getCallToolOptions;
  }

  /**
   * Replace the source slug allowlist used when clients list available tools.
   */
  setSlugFilter(slugFilter: string[] | undefined): void {
    this.slugFilter = slugFilter;
  }

  private debug(msg: string): void {
    this.debugFn?.(`[McpPoolServer] ${msg}`);
  }

  private getMergedCallToolOptions(): McpClientPoolCallOptions {
    return {
      ...this.getCallToolOptions?.(),
      ...(this.sessionPath ? { sessionPath: this.sessionPath } : {}),
    };
  }

  private isToolAllowed(exposedName: string): boolean {
    if (!this.slugFilter) return true;
    const sourceSlug = exposedName.split('__')[0];
    return sourceSlug !== undefined && this.slugFilter.includes(sourceSlug);
  }

  get port(): number {
    return this._port;
  }

  get url(): string {
    return `http://127.0.0.1:${this._port}/mcp`;
  }

  /**
   * Start the HTTP MCP server on a random port.
   * Returns the URL clients should connect to.
   */
  async start(): Promise<string> {
    if (this.httpServer) {
      return this.url;
    }

    this.httpServer = createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1`);
      if (url.pathname !== '/mcp') {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      // The MCP SDK requires a fresh transport for every request in stateless mode.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const mcpServer = this.createMcpServer();

      try {
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
      } finally {
        await transport.close().catch(() => {});
        await mcpServer.close().catch(() => {});
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(0, '127.0.0.1', () => {
        const addr = this.httpServer!.address();
        this._port = typeof addr === 'object' && addr ? addr.port : 0;
        this.debug(`Listening on 127.0.0.1:${this._port}`);
        resolve();
      });
      this.httpServer!.on('error', reject);
    });

    return this.url;
  }

  /**
   * Create an MCP Server instance wired to the pool.
   * Tools from pool use `mcp__craft__search_spaces` naming internally.
   * We strip the `mcp__` prefix so Codex (which adds its own `mcp__sources__`
   * prefix based on the POOL_SERVER_MCP_NAME) sees clean names:
   *   pool internal: mcp__craft__search_spaces
   *   exposed here:  craft__search_spaces
   *   Codex sees:    mcp__sources__craft__search_spaces
   */
  private createMcpServer(): Server {
    const server = new Server(
      { name: 'craft-pool-proxy', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    // List tools — proxy from pool, strip `mcp__` prefix
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const proxyDefs = this.pool.getProxyToolDefs(this.slugFilter);
      return {
        tools: proxyDefs.map(def => ({
          name: def.name.replace(/^mcp__/, ''),
          description: def.description,
          inputSchema: def.inputSchema as {
            type: 'object';
            properties?: Record<string, unknown>;
          },
        })),
      };
    });

    // Call tool — add `mcp__` prefix back before routing through pool
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      if (!this.isToolAllowed(name)) {
        return {
          content: [{ type: 'text' as const, text: `MCP source is not enabled for this session: ${name}` }],
          isError: true,
        };
      }

      const internalName = `mcp__${name}`;
      this.debug(`Tool call: ${name} → ${internalName}`);

      const result = await this.pool.callTool(internalName, args || {}, this.getMergedCallToolOptions());

      return {
        content: [{ type: 'text' as const, text: result.content }],
        ...(result.isError ? { isError: true } : {}),
      };
    });

    return server;
  }

  /**
   * Notify that the tool list has changed.
   * In stateless mode this is a no-op — source changes already trigger
   * `regenCodexConfigAndReconnect()` which restarts the app-server,
   * and it re-discovers tools on startup.
   */
  notifyToolsChanged(): void {
    this.debug('Tools changed (stateless mode — clients will discover on next connect)');
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
      this._port = 0;
      this.debug('Stopped');
    }
  }
}
