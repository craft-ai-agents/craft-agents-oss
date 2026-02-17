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
  // Handlers
  handleSubmitPlan,
  handleConfigValidate,
  handleSkillValidate,
  handleMermaidValidate,
  handleSourceTest,
  handleSourceOAuthTrigger,
  handleGoogleOAuthTrigger,
  handleSlackOAuthTrigger,
  handleMicrosoftOAuthTrigger,
  handleCredentialPrompt,
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
// Tool Definitions
// ============================================================

function createTools(): Tool[] {
  return [
    {
      name: 'SubmitPlan',
      description: `Submit a plan for user review.

Call this after you have written your plan to a markdown file using the Write tool.
The plan will be displayed to the user in a special formatted view.

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** to present the plan to the user
- No further tool calls or text output will be processed after this tool returns
- The conversation will resume when the user responds`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          planPath: {
            type: 'string',
            description: 'Absolute path to the plan markdown file you wrote',
          },
        },
        required: ['planPath'],
      },
    },
    {
      name: 'config_validate',
      description: `Validate Craft Agent configuration files.

**Targets:**
- config: Validates ~/.craft-agent/config.json
- sources: Validates source config.json files
- statuses: Validates statuses config
- preferences: Validates preferences.json
- permissions: Validates workspace permissions.json
- tool-icons: Validates tool-icons.json
- all: Validates all configuration files`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          target: {
            type: 'string',
            enum: ['config', 'sources', 'statuses', 'preferences', 'permissions', 'tool-icons', 'all'],
            description: 'Which config file(s) to validate',
          },
          sourceSlug: {
            type: 'string',
            description: 'Validate a specific source by slug (used with target "sources")',
          },
        },
        required: ['target'],
      },
    },
    {
      name: 'skill_validate',
      description: `Validate a skill's SKILL.md file.

Checks slug format, SKILL.md existence, YAML frontmatter, and required fields.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          skillSlug: {
            type: 'string',
            description: 'The slug of the skill to validate',
          },
        },
        required: ['skillSlug'],
      },
    },
    {
      name: 'mermaid_validate',
      description: `Validate Mermaid diagram syntax before outputting.

Use this when creating complex diagrams or debugging syntax issues.
Uses @craft-agent/mermaid parser for accurate validation.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          code: {
            type: 'string',
            description: 'The mermaid diagram code to validate',
          },
        },
        required: ['code'],
      },
    },
    {
      name: 'source_oauth_trigger',
      description: `Start OAuth authentication for an MCP source.

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          sourceSlug: {
            type: 'string',
            description: 'The slug of the source to authenticate',
          },
        },
        required: ['sourceSlug'],
      },
    },
    {
      name: 'source_google_oauth_trigger',
      description: `Trigger Google OAuth authentication for a Google API source (Gmail, Calendar, Drive).

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          sourceSlug: {
            type: 'string',
            description: 'The slug of the Google API source to authenticate',
          },
        },
        required: ['sourceSlug'],
      },
    },
    {
      name: 'source_slack_oauth_trigger',
      description: `Trigger Slack OAuth authentication for a Slack API source.

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          sourceSlug: {
            type: 'string',
            description: 'The slug of the Slack API source to authenticate',
          },
        },
        required: ['sourceSlug'],
      },
    },
    {
      name: 'source_microsoft_oauth_trigger',
      description: `Trigger Microsoft OAuth authentication for a Microsoft API source (Outlook, OneDrive, Teams).

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          sourceSlug: {
            type: 'string',
            description: 'The slug of the Microsoft API source to authenticate',
          },
        },
        required: ['sourceSlug'],
      },
    },
    {
      name: 'source_credential_prompt',
      description: `Prompt the user to enter credentials for a source.

**Auth Modes:**
- bearer: Single token field (Bearer Token, API Key)
- basic: Username and Password fields
- header: API Key with custom header name
- query: API Key for query parameter auth

**IMPORTANT:** After calling this tool, execution will be paused for user input.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          sourceSlug: {
            type: 'string',
            description: 'The slug of the source to authenticate',
          },
          mode: {
            type: 'string',
            enum: ['bearer', 'basic', 'header', 'query'],
            description: 'Type of credential input',
          },
          labels: {
            type: 'object',
            description: 'Custom field labels',
            properties: {
              credential: { type: 'string' },
              username: { type: 'string' },
              password: { type: 'string' },
            },
          },
          description: {
            type: 'string',
            description: 'Description shown to user',
          },
          hint: {
            type: 'string',
            description: 'Hint about where to find credentials',
          },
          passwordRequired: {
            type: 'boolean',
            description: 'For basic auth: whether password is required (default: true)',
          },
        },
        required: ['sourceSlug', 'mode'],
      },
    },
    {
      name: 'source_test',
      description: `Validate and test a source configuration.

**Performs:**
1. Schema validation - validates config.json structure
2. Completeness check - warns about missing guide.md/icon
3. Connection test - tests if source endpoint is reachable
4. Auth status - checks if source is authenticated

**Returns:** Detailed validation report with errors and warnings.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          sourceSlug: {
            type: 'string',
            description: 'The slug of the source to test',
          },
        },
        required: ['sourceSlug'],
      },
    },
    {
      name: 'call_llm',
      description: `Invoke a secondary LLM for focused subtasks. Use for:
- Cost optimization: use a smaller model for simple tasks (summarization, classification)
- Structured output: JSON schema compliance
- Parallel processing: call multiple times in one message - all run simultaneously
- Context isolation: process content without polluting main context

Pass file paths via 'attachments' - the tool loads content automatically.
For large files (>2000 lines), use {path, startLine, endLine} to select a portion.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          prompt: {
            type: 'string',
            description: 'Instructions for the LLM',
          },
          attachments: {
            type: 'array',
            description: 'File paths to include as context',
            items: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    startLine: { type: 'number' },
                    endLine: { type: 'number' },
                  },
                  required: ['path'],
                },
              ],
            },
          },
          model: {
            type: 'string',
            description: 'Model ID or short name (e.g., "haiku", "sonnet"). Defaults to Haiku.',
          },
          systemPrompt: {
            type: 'string',
            description: 'Optional system prompt',
          },
          maxTokens: {
            type: 'number',
            description: 'Max output tokens (1-64000). Defaults to 4096',
          },
          temperature: {
            type: 'number',
            description: 'Sampling temperature 0-1',
          },
          outputFormat: {
            type: 'string',
            enum: ['summary', 'classification', 'extraction', 'analysis', 'comparison', 'validation'],
            description: 'Predefined output format',
          },
          outputSchema: {
            type: 'object',
            description: 'Custom JSON Schema for structured output',
          },
          // _precomputedResult is injected at runtime by PreToolUse intercept
          // and intentionally NOT in the schema (hidden from the AI)
        },
        required: ['prompt'],
      },
    },
  ];
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

  // Handle tool calls - route to shared handlers
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;

    try {
      switch (name) {
        case 'SubmitPlan':
          return await handleSubmitPlan(ctx, toolArgs as { planPath: string });

        case 'config_validate':
          return await handleConfigValidate(ctx, toolArgs as { target: 'config' | 'sources' | 'statuses' | 'preferences' | 'permissions' | 'tool-icons' | 'all'; sourceSlug?: string });

        case 'skill_validate':
          return await handleSkillValidate(ctx, toolArgs as { skillSlug: string });

        case 'mermaid_validate':
          return await handleMermaidValidate(ctx, toolArgs as { code: string });

        case 'source_oauth_trigger':
          return await handleSourceOAuthTrigger(ctx, toolArgs as { sourceSlug: string });

        case 'source_google_oauth_trigger':
          return await handleGoogleOAuthTrigger(ctx, toolArgs as { sourceSlug: string });

        case 'source_slack_oauth_trigger':
          return await handleSlackOAuthTrigger(ctx, toolArgs as { sourceSlug: string });

        case 'source_microsoft_oauth_trigger':
          return await handleMicrosoftOAuthTrigger(ctx, toolArgs as { sourceSlug: string });

        case 'source_credential_prompt':
          return await handleCredentialPrompt(ctx, toolArgs as {
            sourceSlug: string;
            mode: 'bearer' | 'basic' | 'header' | 'query';
            labels?: { credential?: string; username?: string; password?: string };
            description?: string;
            hint?: string;
            passwordRequired?: boolean;
          });

        case 'source_test':
          return await handleSourceTest(ctx, toolArgs as { sourceSlug: string });

        case 'call_llm': {
          // Primary path: PreToolUse intercept injects _precomputedResult (works on Codex).
          const args = toolArgs as Record<string, unknown>;
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

        default:
          return errorResponse(`Unknown tool: ${name}`);
      }
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
