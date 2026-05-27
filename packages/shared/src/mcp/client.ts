/**
 * MCP client using official @modelcontextprotocol/sdk
 * Supports both Streamable HTTP and stdio transports for remote and local MCP servers
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { FetchLike, Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '../utils/debug.ts';

/**
 * Streamable HTTP transport config for remote MCP servers
 */
export interface HttpMcpClientConfig {
  transport: 'streamable_http';
  url: string;
  headers?: Record<string, string>;
}

/**
 * Stdio transport config for local MCP servers (spawns subprocess)
 */
export interface StdioMcpClientConfig {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Unified config supporting both transport types
 */
export type McpClientConfig = HttpMcpClientConfig | StdioMcpClientConfig;

/**
 * Sensitive environment variables that should NOT be passed to MCP subprocesses.
 * These could contain API keys, tokens, or credentials that MCP servers don't need
 * and shouldn't have access to.
 * NOTE: This list is duplicated in packages/session-tools-core/src/handlers/transform-data.ts (BLOCKED_ENV_VARS).
 * If you add a new entry here, update it there too.
 */
const BLOCKED_ENV_VARS = [
  // MDP auth (set by the app itself)
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',

  // AWS credentials
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',

  // Common API keys/tokens
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'STRIPE_SECRET_KEY',
  'NPM_TOKEN',
];

const log = createLogger('mcp-client');
const STANDALONE_SSE_DISABLED_RESPONSE = new Response(null, {
  status: 405,
  statusText: 'Method Not Allowed',
});

/**
 * 将 HeadersInit 统一转换为普通对象，便于完整打印请求头与响应头。
 *
 * @param headers 原始 HeadersInit。
 * @returns 便于日志输出的键值对象。
 */
function normalizeHeadersForLog(headers?: RequestInit['headers']): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  const headerRecord = headers as Record<string, string | readonly string[]>;
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headerRecord)) {
    normalized[key] = typeof value === 'string' ? value : Array.from(value).join(', ');
  }
  return normalized;
}

/**
 * 将请求体转换为可读日志文本，优先保留 JSON-RPC 原始内容。
 *
 * @param body Fetch 请求体。
 * @returns 可直接写入日志的文本。
 */
function stringifyBodyForLog(body: RequestInit['body'] | null | undefined): string | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return `[ArrayBuffer ${body.byteLength} bytes]`;
  if (ArrayBuffer.isView(body)) return `[${body.constructor.name} ${body.byteLength} bytes]`;
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return `[Blob ${body.type || 'application/octet-stream'} ${body.size} bytes]`;
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return '[FormData]';
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return '[ReadableStream]';
  }
  return `[${Object.prototype.toString.call(body)}]`;
}

function isStandaloneSseGet(method: string, headers: Record<string, string>): boolean {
  if (method.toUpperCase() !== 'GET') return false;
  const accept = Object.entries(headers).find(([key]) => key.toLowerCase() === 'accept')?.[1];
  return accept?.toLowerCase().includes('text/event-stream') ?? false;
}

/**
 * 生成 MCP HTTP transport 的日志包装 fetch，打印完整请求与响应头信息。
 *
 * @param label 日志标签，通常为 MCP 服务器 URL。
 * @returns 带日志能力的 fetch 包装器。
 */
function createMcpLoggingFetch(label: string): FetchLike {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const requestHeaders = normalizeHeadersForLog(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const requestBody = stringifyBodyForLog(init?.body);
    const startedAt = Date.now();

    log.debug(`[http] => ${method.toUpperCase()} ${requestUrl}`, {
      server: label,
      headers: requestHeaders,
      body: requestBody,
    });

    // The MCP Streamable HTTP standalone GET/SSE channel is optional. Some
    // servers return 200 text/event-stream and immediately close it, which makes
    // the SDK reconnect repeatedly. Returning 405 tells the SDK to use POST-only
    // request/response transport without changing tool-call behavior.
    if (isStandaloneSseGet(method, requestHeaders)) {
      log.debug(`[http] <= 405 Method Not Allowed ${requestUrl}`, {
        server: label,
        durationMs: Date.now() - startedAt,
        headers: {},
        body: 'Standalone SSE disabled by client',
      });
      return STANDALONE_SSE_DISABLED_RESPONSE.clone();
    }

    const response = await fetch(input, init);
    const durationMs = Date.now() - startedAt;
    const responseHeaders = normalizeHeadersForLog(response.headers);
    const contentType = response.headers.get('content-type') ?? '';
    let responseBody: string | undefined;

    if (!contentType.includes('text/event-stream')) {
      try {
        responseBody = await response.clone().text();
      } catch (error) {
        responseBody = `[failed to read body: ${error instanceof Error ? error.message : String(error)}]`;
      }
    } else {
      responseBody = '[SSE stream body omitted]';
    }

    log.debug(`[http] <= ${response.status} ${response.statusText} ${requestUrl}`, {
      server: label,
      durationMs,
      headers: responseHeaders,
      body: responseBody,
    });

    return response;
  };
}

/**
 * Interface for clients managed by McpClientPool.
 * Both CraftMcpClient (remote MCP sources) and ApiSourcePoolClient (API sources) implement this.
 */
export interface PoolClient {
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export class CraftMcpClient {
  private client: Client;
  private transport: Transport;
  private connected = false;

  constructor(config: McpClientConfig) {
    this.client = new Client({
      name: 'craft-agent',
      version: '1.0.0',
    });

    // Create transport based on config type
    if (config.transport === 'stdio') {
      // Stdio transport for local MCP servers - merge with process env,
      // but filter out sensitive credentials to prevent leaking secrets to subprocesses
      const processEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && !BLOCKED_ENV_VARS.includes(key)) {
          processEnv[key] = value;
        }
      }
      this.transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...processEnv, ...config.env },
      });
    } else {
      // HTTP transport for remote MCP servers
      const loggingFetch = createMcpLoggingFetch(config.url);
      this.transport = new StreamableHTTPClientTransport(
        new URL(config.url),
        {
          requestInit: {
            headers: config.headers,
          },
          fetch: loggingFetch,
        }
      );
    }
  }

  /**
   * 建立 MCP 连接，并通过一次 listTools 健康检查确认链路可用。
   *
   * @returns 连接成功后无返回值。
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    log.debug('Connecting MCP client');
    await this.client.connect(this.transport);

    // Verify connection works by listing tools
    try {
      await this.client.listTools();
    } catch (error) {
      await this.client.close();
      throw new Error(
        `MCP connection failed health check: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    this.connected = true;
    log.debug('MCP client connected');
  }

  /**
   * 拉取 MCP 服务暴露的工具列表，并输出数量日志。
   *
   * @returns MCP 工具定义数组。
   */
  async listTools(): Promise<Tool[]> {
    if (!this.connected) {
      await this.connect();
    }

    const result = await this.client.listTools();
    log.debug('Fetched MCP tools', { toolCount: result.tools.length });
    return result.tools;
  }

  /**
   * Returns server name/version reported during the MCP handshake.
   * Available after `connect()` resolves; undefined otherwise.
   */
  getServerInfo(): { name: string; version: string } | undefined {
    const info = this.client.getServerVersion();
    if (!info) return undefined;
    return { name: info.name, version: info.version };
  }

  /**
   * 调用指定 MCP 工具，并记录工具名与参数，便于对照请求日志。
   *
   * @param name MCP 工具名。
   * @param args MCP 工具参数。
   * @returns MCP 原始工具调用结果。
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) {
      await this.connect();
    }

    log.debug('Calling MCP tool', { name, args });
    const result = await this.client.callTool({ name, arguments: args });
    log.debug('MCP tool call completed', { name });
    return result;
  }

  /**
   * 关闭 MCP 客户端连接，释放底层 transport。
   *
   * @returns 关闭完成后无返回值。
   */
  async close(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
      log.debug('MCP client closed');
    }
  }
}
