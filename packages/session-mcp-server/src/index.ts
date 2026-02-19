#!/usr/bin/env node
/**
 * Session MCP Server
 *
 * This MCP server provides session-scoped tools to Codex via stdio transport.
 * It uses the shared handlers from @craft-agent/session-tools-core to ensure
 * feature parity with Claude's session-scoped tools.
 *
 * Callback Communication:
 * Tools that need to communicate with the main Electron process (e.g., SubmitPlan
 * triggering a plan display, OAuth triggers pausing execution) send structured
 * JSON messages to stderr with a "__CALLBACK__" prefix. The main process monitors
 * stderr and handles these callbacks.
 *
 * Usage:
 *   node session-mcp-server.js --session-id <id> --workspace-root <path> --plans-folder <path>
 *
 * Arguments:
 *   --session-id: Unique session identifier
 *   --workspace-root: Path to workspace folder (~/.craft-agent/workspaces/{id})
 *   --plans-folder: Path to session's plans folder
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Import from session-tools-core
import {
  type SessionToolContext,
  type CallbackMessage,
  type AuthRequest,
  type SourceConfig,
  type LoadedSource,
  type CredentialManagerInterface,
  // Registry
  SESSION_TOOL_REGISTRY,
  getToolDefsAsJsonSchema,
  // Helpers
  loadSourceConfig as loadSourceConfigFromHelpers,
  errorResponse,
} from '@craft-agent/session-tools-core';

// ============================================================
// Types
// ============================================================

interface SessionConfig {
  sessionId: string;
  workspaceRootPath: string;
  plansFolderPath: string;
  callbackPort?: string;
}

// ============================================================
// Callback Communication
// ============================================================

/**
 * Send a callback message to the main process via stderr.
 * These messages are parsed by the main process to trigger UI actions.
 */
function sendCallback(callback: CallbackMessage): void {
  // Write to stderr as a single line JSON (main process parses this)
  console.error(`__CALLBACK__${JSON.stringify(callback)}`);
}

// ============================================================
// Credential Cache Access
// ============================================================

/**
 * Credential cache entry format (matches main process format).
 * Written by Electron main process, read by this server.
 */
interface CredentialCacheEntry {
  value: string;
  expiresAt?: number;
}

/**
 * Get the path to a source's credential cache file.
 * The main process writes decrypted credentials to these files.
 */
function getCredentialCachePath(workspaceRootPath: string, sourceSlug: string): string {
  return `${workspaceRootPath}/sources/${sourceSlug}/.credential-cache.json`;
}

/**
 * Read credentials from the cache file for a source.
 * Returns null if the cache doesn't exist or is expired.
 */
function readCredentialCache(workspaceRootPath: string, sourceSlug: string): string | null {
  const cachePath = getCredentialCachePath(workspaceRootPath, sourceSlug);

  try {
    if (!existsSync(cachePath)) {
      return null;
    }

    const content = readFileSync(cachePath, 'utf-8');
    const cache = JSON.parse(content) as CredentialCacheEntry;

    // Check expiry if set
    if (cache.expiresAt && Date.now() > cache.expiresAt) {
      return null;
    }

    return cache.value || null;
  } catch {
    return null;
  }
}

/**
 * Create a credential manager that reads from credential cache files.
 * This allows the session-mcp-server to access credentials without keychain access.
 */
function createCredentialManager(workspaceRootPath: string): CredentialManagerInterface {
  return {
    hasValidCredentials: async (source: LoadedSource): Promise<boolean> => {
      const token = readCredentialCache(workspaceRootPath, source.config.slug);
      return token !== null;
    },

    getToken: async (source: LoadedSource): Promise<string | null> => {
      return readCredentialCache(workspaceRootPath, source.config.slug);
    },

    refresh: async (_source: LoadedSource): Promise<string | null> => {
      // Cannot refresh from subprocess - would need main process
      return null;
    },
  };
}

// ============================================================
// Codex Context Factory
// ============================================================

/**
 * Create a SessionToolContext for the Codex MCP server.
 * This provides the context needed by all handlers.
 */
function createCodexContext(config: SessionConfig): SessionToolContext {
  const { sessionId, workspaceRootPath, plansFolderPath } = config;

  // File system implementation
  const fs = {
    exists: (path: string) => existsSync(path),
    readFile: (path: string) => readFileSync(path, 'utf-8'),
    readFileBuffer: (path: string) => readFileSync(path),
    writeFile: (path: string, content: string) => writeFileSync(path, content, 'utf-8'),
    isDirectory: (path: string) => existsSync(path) && statSync(path).isDirectory(),
    readdir: (path: string) => readdirSync(path),
    stat: (path: string) => {
      const stats = statSync(path);
      return {
        size: stats.size,
        isDirectory: () => stats.isDirectory(),
      };
    },
  };

  // Callback implementation using stderr
  const callbacks = {
    onPlanSubmitted: (planPath: string) => {
      sendCallback({
        __callback__: 'plan_submitted',
        sessionId,
        planPath,
      });
    },
    onAuthRequest: (request: AuthRequest) => {
      sendCallback({
        __callback__: 'auth_request',
        ...request,
      });
    },
  };

  // Create credential manager that reads from cache files
  const credentialManager = createCredentialManager(workspaceRootPath);

  // Build context
  return {
    sessionId,
    workspacePath: workspaceRootPath,
    get sourcesPath() { return join(workspaceRootPath, 'sources'); },
    get skillsPath() { return join(workspaceRootPath, 'skills'); },
    plansFolderPath,
    callbacks,
    fs,
    loadSourceConfig: (sourceSlug: string): SourceConfig | null => {
      return loadSourceConfigFromHelpers(workspaceRootPath, sourceSlug);
    },

    // Credential manager reads from cache files written by main process
    credentialManager,

    // Note: saveSourceConfig, validators, renderMermaid
    // are not available in Codex context (require Electron internals)
  };
}

// ============================================================
// Tool Definitions (from canonical registry)
// ============================================================

function createTools(): Tool[] {
  return getToolDefsAsJsonSchema().map(def => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema as Tool['inputSchema'],
  }));
}

// ============================================================
// call_llm Handler (backend-specific)
// ============================================================

async function handleCallLlm(
  args: Record<string, unknown>,
  config: SessionConfig,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  // Primary path: PreToolUse intercept injects _precomputedResult (works on Codex).
  const precomputed = args?._precomputedResult as string | undefined;

  if (precomputed) {
    try {
      const parsed = JSON.parse(precomputed);
      if (parsed.error) {
        return errorResponse(`call_llm failed: ${parsed.error}`);
      }
      if (parsed.text !== undefined) {
        return {
          content: [{ type: 'text' as const, text: parsed.text || '(Model returned empty response)' }],
        };
      }
      return errorResponse('call_llm: _precomputedResult has unexpected format (missing text field).');
    } catch {
      return errorResponse(`call_llm: Failed to parse _precomputedResult: ${precomputed.slice(0, 200)}`);
    }
  }

  // Fallback path: HTTP callback to agent (for Copilot where PreToolUse doesn't fire for MCP tools).
  // Uses callbackPort from CLI arg (--callback-port) or env var (CRAFT_LLM_CALLBACK_PORT).
  if (config.callbackPort) {
    try {
      const resp = await fetch(`http://127.0.0.1:${config.callbackPort}/call-llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(30000),
      });
      const result = await resp.json() as { text?: string; model?: string; error?: string };
      if (result.error) {
        return errorResponse(`call_llm failed: ${result.error}`);
      }
      return {
        content: [{ type: 'text' as const, text: result.text || '(Model returned empty response)' }],
      };
    } catch (err) {
      return errorResponse(`call_llm callback failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return errorResponse(
    'call_llm requires either PreToolUse intercept (_precomputedResult) or ' +
    'HTTP callback (CRAFT_LLM_CALLBACK_PORT). Neither is available.'
  );
}

// ============================================================
// MCP Server Setup
// ============================================================

function setupSignalHandlers(): void {
  const shutdown = (signal: string) => {
    console.error(`Session MCP Server received ${signal}, shutting down gracefully`);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection in session MCP server:', reason);
  });
}

async function main() {
  setupSignalHandlers();

  // Parse command line arguments
  const args = process.argv.slice(2);
  let sessionId: string | undefined;
  let workspaceRootPath: string | undefined;
  let plansFolderPath: string | undefined;
  let callbackPort: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session-id' && args[i + 1]) {
      sessionId = args[i + 1];
      i++;
    } else if (args[i] === '--workspace-root' && args[i + 1]) {
      workspaceRootPath = args[i + 1];
      i++;
    } else if (args[i] === '--plans-folder' && args[i + 1]) {
      plansFolderPath = args[i + 1];
      i++;
    } else if (args[i] === '--callback-port' && args[i + 1]) {
      callbackPort = args[i + 1];
      i++;
    }
  }

  if (!sessionId || !workspaceRootPath || !plansFolderPath) {
    console.error('Usage: session-mcp-server --session-id <id> --workspace-root <path> --plans-folder <path>');
    process.exit(1);
  }

  const config: SessionConfig = {
    sessionId,
    workspaceRootPath,
    plansFolderPath,
    // CLI arg takes priority, env var as fallback (Copilot CLI may not forward env to subprocesses)
    callbackPort: callbackPort || process.env.CRAFT_LLM_CALLBACK_PORT,
  };

  // Create the Codex context
  const ctx = createCodexContext(config);

  // Create MCP server
  const server = new Server(
    {
      name: 'craft-agent-session',
      version: '0.3.1',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: createTools(),
  }));

  // Handle tool calls - route via canonical registry + call_llm special case
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;

    try {
      // call_llm has backend-specific execution (precomputed result / HTTP callback)
      if (name === 'call_llm') {
        return await handleCallLlm(toolArgs as Record<string, unknown>, config);
      }

      // All other tools: look up in the canonical registry
      const def = SESSION_TOOL_REGISTRY.get(name);
      if (!def?.handler) {
        return errorResponse(`Unknown tool: ${name}`);
      }

      return await def.handler(ctx, toolArgs);
    } catch (error) {
      return errorResponse(
        `Tool '${name}' failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`Session MCP Server started for session ${sessionId}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
