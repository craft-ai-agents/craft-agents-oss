/**
 * MCP Client Manager
 *
 * Manages connections to MCP (Model Context Protocol) servers and bridges their
 * tools into OpenAI function-calling format. Used by OpenAIAgent (and any future
 * non-Anthropic backends) to integrate sources and session tools.
 *
 * Responsibilities:
 * - Connect/disconnect MCP clients for each configured server
 * - Discover and cache the tools available from each server
 * - Convert MCP tool schemas to OpenAI ChatCompletionTool format
 * - Route tool-call requests to the correct MCP server and return results
 *
 * Each MCP server is identified by a slug (its key in the mcpServers map).
 * Tool names are prefixed with the server slug to avoid collisions:
 *   "github__search_repositories" → calls the "search_repositories" tool on
 *   the "github" MCP server.
 *
 * The double-underscore separator (`__`) was chosen because it is unlikely to
 * appear in real tool names while remaining readable.
 */

import { CraftMcpClient } from '../../mcp/client.ts';
import type { SdkMcpServerConfig } from '../backend/types.ts';
import { createLogger } from '../../utils/debug.ts';

const log = createLogger('mcp-client-manager');

// ============================================================
// Types
// ============================================================

/** OpenAI function parameter schema (JSON Schema subset) */
interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  [key: string]: unknown;
}

/** OpenAI ChatCompletionTool format */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: JsonSchema;
  };
}

/** Internal record of a tool and which server handles it */
interface RegisteredTool {
  serverSlug: string;
  originalName: string;
  schema: OpenAITool;
}

// ============================================================
// McpClientManager
// ============================================================

export class McpClientManager {
  /** Active MCP clients keyed by server slug */
  private clients: Map<string, CraftMcpClient> = new Map();

  /** Tools discovered from all servers, keyed by prefixed tool name */
  private tools: Map<string, RegisteredTool> = new Map();

  /** Whether tools have been loaded from all current servers */
  private toolsLoaded = false;

  /**
   * Connect to the given set of MCP servers.
   * Disconnects any servers no longer in the map, connects new ones.
   * Call this whenever the source servers change (setSourceServers).
   */
  async update(mcpServers: Record<string, SdkMcpServerConfig>): Promise<void> {
    const incoming = new Set(Object.keys(mcpServers));
    const existing = new Set(this.clients.keys());

    // Disconnect removed servers
    for (const slug of existing) {
      if (!incoming.has(slug)) {
        await this.disconnectServer(slug);
      }
    }

    // Connect new servers
    for (const [slug, config] of Object.entries(mcpServers)) {
      if (!existing.has(slug)) {
        await this.connectServer(slug, config);
      }
    }

    // Invalidate tool cache so next listTools() re-fetches
    this.toolsLoaded = false;
    this.tools.clear();
  }

  /**
   * Get all available tools in OpenAI function-calling format.
   * Fetches from all connected MCP servers on first call (then cached until update()).
   */
  async listTools(): Promise<OpenAITool[]> {
    if (this.toolsLoaded) {
      return Array.from(this.tools.values()).map(t => t.schema);
    }

    this.tools.clear();
    for (const [slug, client] of this.clients) {
      try {
        const mcpTools = await client.listTools();
        for (const mcpTool of mcpTools) {
          const prefixedName = `${slug}__${mcpTool.name}`;
          const schema: OpenAITool = {
            type: 'function',
            function: {
              name: prefixedName,
              description: mcpTool.description,
              parameters: (mcpTool.inputSchema as JsonSchema) ?? { type: 'object', properties: {} },
            },
          };
          this.tools.set(prefixedName, {
            serverSlug: slug,
            originalName: mcpTool.name,
            schema,
          });
        }
        log.debug(`Loaded ${mcpTools.length} tools from MCP server: ${slug}`);
      } catch (err) {
        log.warn(`Failed to list tools from MCP server "${slug}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.toolsLoaded = true;
    return Array.from(this.tools.values()).map(t => t.schema);
  }

  /**
   * Call a tool by its prefixed name (e.g. "github__search_repositories").
   * Returns the tool result as a string.
   */
  async callTool(prefixedName: string, args: Record<string, unknown>): Promise<string> {
    const registered = this.tools.get(prefixedName);
    if (!registered) {
      throw new Error(`Unknown MCP tool: ${prefixedName}`);
    }
    const client = this.clients.get(registered.serverSlug);
    if (!client) {
      throw new Error(`MCP server "${registered.serverSlug}" is not connected`);
    }
    try {
      const result = await client.callTool(registered.originalName, args);
      return formatMcpResult(result);
    } catch (err) {
      throw new Error(
        `MCP tool call failed (${prefixedName}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Check if a given tool name (prefixed) is handled by this MCP manager.
   * Use this before calling callTool() to distinguish MCP vs built-in tools.
   */
  isMcpTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Disconnect all MCP servers and clean up resources.
   */
  async destroy(): Promise<void> {
    for (const slug of [...this.clients.keys()]) {
      await this.disconnectServer(slug);
    }
    this.tools.clear();
    this.toolsLoaded = false;
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private async connectServer(slug: string, config: SdkMcpServerConfig): Promise<void> {
    try {
      const client = createClientFromConfig(config);
      await client.connect();
      this.clients.set(slug, client);
      log.debug(`Connected to MCP server: ${slug}`);
    } catch (err) {
      log.warn(`Failed to connect to MCP server "${slug}": ${err instanceof Error ? err.message : String(err)}`);
      // Non-fatal: agent can still function without this server's tools
    }
  }

  private async disconnectServer(slug: string): Promise<void> {
    const client = this.clients.get(slug);
    if (!client) return;
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
    this.clients.delete(slug);
    // Remove tools from this server
    for (const [prefixedName, info] of this.tools) {
      if (info.serverSlug === slug) {
        this.tools.delete(prefixedName);
      }
    }
    log.debug(`Disconnected from MCP server: ${slug}`);
  }
}

// ============================================================
// Utilities
// ============================================================

/**
 * Map a SdkMcpServerConfig to a CraftMcpClient.
 */
function createClientFromConfig(config: SdkMcpServerConfig): CraftMcpClient {
  if (config.type === 'stdio') {
    return new CraftMcpClient({
      transport: 'stdio',
      command: config.command,
      args: config.args,
      env: config.env,
    });
  }
  // http or sse
  return new CraftMcpClient({
    transport: 'http',
    url: config.url,
    headers: config.headers,
  });
}

/**
 * Convert an MCP tool call result to a string.
 * MCP results are arrays of content blocks (text, image, etc.).
 */
function formatMcpResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return String(result);

  // MCP CallToolResult shape: { content: Array<{ type, text?, ... }>, isError?: boolean }
  const r = result as { content?: unknown[]; isError?: boolean };
  if (Array.isArray(r.content)) {
    const texts = r.content
      .filter((block): block is { type: string; text: string } =>
        typeof block === 'object' && block !== null && 'text' in block
      )
      .map(block => block.text);
    return texts.join('\n') || JSON.stringify(result);
  }
  return JSON.stringify(result);
}
