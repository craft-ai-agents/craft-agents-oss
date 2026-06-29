/**
 * MCP client using official @modelcontextprotocol/sdk
 * Supports both HTTP and stdio transports for remote and local MCP servers
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { debug } from '../utils/debug.ts';

const MCP_CONNECT_TIMEOUT_MS = 30_000;
const MCP_LIST_TOOLS_TIMEOUT_MS = 30_000;
const MCP_CALL_TOOL_TIMEOUT_MS = 120_000;

/**
 * HTTP transport config for remote MCP servers
 */
export interface HttpMcpClientConfig {
  transport: 'http' | 'sse';
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
  // Runner auth (set by the app itself)
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

function timeoutError(label: string, ms: number): Error {
  return new Error(`${label} timed out after ${ms}ms`);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(timeoutError(label, ms)), ms);
    });
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
      const url = new URL(config.url);
      if (config.transport === 'sse') {
        this.transport = new SSEClientTransport(url, {
          requestInit: { headers: config.headers },
          eventSourceInit: config.headers
            ? {
                fetch: (input, init) => {
                  const headers = new Headers(init?.headers);
                  for (const [key, value] of Object.entries(config.headers ?? {})) {
                    headers.set(key, value);
                  }
                  return fetch(input, { ...init, headers });
                },
              }
            : undefined,
        });
      } else {
        // HTTP transport for remote MCP servers
        this.transport = new StreamableHTTPClientTransport(
          url,
          {
            requestInit: {
              headers: config.headers,
            },
          }
        );
      }
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      await withTimeout(this.client.connect(this.transport), MCP_CONNECT_TIMEOUT_MS, 'MCP connect');
      // Verify connection works by listing tools before marking this client usable.
      await withTimeout(this.client.listTools(), MCP_LIST_TOOLS_TIMEOUT_MS, 'MCP listTools health check');
    } catch (error) {
      this.connected = false;
      try {
        await this.client.close();
      } catch (closeError) {
        debug('[CraftMcpClient] Failed to close MCP client after connection failure:', closeError);
      }
      throw new Error(
        `MCP connection failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    this.connected = true;
  }

  async listTools(): Promise<Tool[]> {
    if (!this.connected) {
      await this.connect();
    }

    const result = await withTimeout(this.client.listTools(), MCP_LIST_TOOLS_TIMEOUT_MS, 'MCP listTools');
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) {
      await this.connect();
    }

    const result = await withTimeout(
      this.client.callTool({ name, arguments: args }),
      MCP_CALL_TOOL_TIMEOUT_MS,
      `MCP callTool(${name})`
    );
    return result;
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } finally {
      this.connected = false;
    }
  }
}
