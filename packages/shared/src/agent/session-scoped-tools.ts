/**
 * Session-Scoped Tools
 *
 * Tools that are scoped to a specific session. Each session gets its own
 * instance of these tools with session-specific callbacks and state.
 *
 * Tools included:
 * - SubmitPlan: Submit a plan file for user review/display
 * - change_working_directory: Change the working directory for the session
 * - secret_write: Store a secret in the encrypted credential store
 * - secret_read: Retrieve a secret (masked by default)
 * - secret_delete: Delete a secret
 * - secret_list: List all secret names
 * - config_validate: Validate configuration files
 * - source_test: Test a source connection (MCP or API)
 * - oauth_trigger: Start OAuth authentication for a source
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { existsSync, readFileSync, statSync } from 'fs';
import { getSessionPlansPath } from '../sessions/storage.ts';
import { debug } from '../utils/debug.ts';
import { getCredentialManager } from '../credentials/index.ts';
import type { CredentialId, StoredCredential } from '../credentials/types.ts';
import {
  validateConfig,
  validateSource,
  validateAllSources,
  validatePreferences,
  validateAll,
  formatValidationResult,
} from '../config/validators.ts';
import {
  validateMcpConnection,
  getValidationErrorMessage,
  type McpValidationResult,
} from '../mcp/validation.ts';
import {
  getAnthropicApiKey,
  getClaudeOAuthToken,
} from '../config/storage.ts';
import {
  loadSourceConfig,
  saveSourceConfig,
  loadSourceGuide,
  saveSourceGuide,
  updateSourceCache,
  setNestedValue,
  sourceExists,
} from '../sources/storage.ts';
import type { FolderSourceConfig, SourceGuide } from '../sources/types.ts';
import { CraftOAuth, type OAuthConfig, type OAuthCallbacks } from '../auth/oauth.ts';

// ============================================================
// Session-Scoped Tool Callbacks
// ============================================================

/**
 * Credential input modes for different auth types
 */
export type CredentialInputMode = 'bearer' | 'basic' | 'header' | 'query';

/**
 * Credential request from agent - triggers secure input UI
 */
export interface CredentialRequest {
  requestId: string;
  sessionId: string;
  sourceSlug: string;
  sourceName: string;
  mode: CredentialInputMode;
  labels?: {
    credential?: string;
    username?: string;
    password?: string;
  };
  description?: string;
  hint?: string;
  headerName?: string;
}

/**
 * Credential response from user
 */
export interface CredentialResponse {
  type: 'credential';
  value?: string;
  username?: string;
  password?: string;
  cancelled: boolean;
}

/**
 * Callbacks for session-scoped tool operations.
 * These are registered per-session and invoked by tools.
 */
export interface SessionScopedToolCallbacks {
  /** Called when a plan is submitted - triggers plan message display in UI */
  onPlanSubmitted?: (planPath: string) => void;
  /** Called when the working directory changes - syncs with UI and persists */
  onWorkingDirectoryChange?: (path: string) => void;
  /** Called when OAuth flow needs to open a browser URL - returns promise that resolves when auth completes */
  onOAuthBrowserOpen?: (url: string) => Promise<void>;
  /** Called when OAuth flow completes successfully */
  onOAuthSuccess?: (sourceSlug: string) => void;
  /** Called when OAuth flow fails */
  onOAuthError?: (sourceSlug: string, error: string) => void;
  /** Called when credential input is needed - returns promise that resolves with user response */
  onCredentialRequest?: (request: CredentialRequest) => Promise<CredentialResponse>;
}

/**
 * Registry mapping session IDs to their callbacks.
 */
const sessionScopedToolCallbackRegistry = new Map<string, SessionScopedToolCallbacks>();

/**
 * Register callbacks for a session's tools.
 * Called by CraftAgent when initializing.
 */
export function registerSessionScopedToolCallbacks(
  sessionId: string,
  callbacks: SessionScopedToolCallbacks
): void {
  sessionScopedToolCallbackRegistry.set(sessionId, callbacks);
  debug(`[SessionScopedTools] Registered callbacks for session ${sessionId}`);
}

/**
 * Unregister callbacks for a session.
 * Called by CraftAgent on dispose.
 */
export function unregisterSessionScopedToolCallbacks(sessionId: string): void {
  sessionScopedToolCallbackRegistry.delete(sessionId);
  debug(`[SessionScopedTools] Unregistered callbacks for session ${sessionId}`);
}

/**
 * Get callbacks for a session.
 */
function getSessionScopedToolCallbacks(sessionId: string): SessionScopedToolCallbacks | undefined {
  return sessionScopedToolCallbackRegistry.get(sessionId);
}

// ============================================================
// Plan File State (per session)
// ============================================================

/**
 * Track the last submitted plan file per session
 */
const sessionPlanFiles = new Map<string, string>();

/**
 * Get the last submitted plan file path for a session
 */
export function getLastPlanFilePath(sessionId: string): string | null {
  return sessionPlanFiles.get(sessionId) ?? null;
}

/**
 * Set the last submitted plan file path for a session
 */
function setLastPlanFilePath(sessionId: string, path: string): void {
  sessionPlanFiles.set(sessionId, path);
}

/**
 * Clear plan file state for a session
 */
export function clearPlanFileState(sessionId: string): void {
  sessionPlanFiles.delete(sessionId);
}

// ============================================================
// Tool Factories
// ============================================================

/**
 * Create a session-scoped SubmitPlan tool.
 * The sessionId is captured at creation time.
 *
 * This is a UNIVERSAL tool - the agent can use it anytime to submit
 * a plan for user review, regardless of Safe Mode status.
 */
export function createSubmitPlanTool(sessionId: string) {
  return tool(
    'SubmitPlan',
    `Submit a plan for user review.

Call this after you have written your plan to a markdown file using the Write tool.
The plan will be displayed to the user in a special formatted view.

This tool can be used anytime - it's not restricted to any particular mode.
Use it whenever you want to present a structured plan to the user.

**Safe Mode Workflow:** When you are in Safe Mode and have completed your research/exploration,
use this tool to present your implementation plan. The plan UI includes an "Accept Plan" button
that exits Safe Mode and allows you to begin implementation immediately.

**Format your plan as markdown:**
\`\`\`markdown
# Plan Title

## Summary
Brief description of what this plan accomplishes.

## Steps
1. **Step description** - Details and approach
2. **Another step** - More details
3. ...
\`\`\`

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** to present the plan to the user
- No further tool calls or text output will be processed after this tool returns
- The conversation will resume when the user responds (accept, modify, or reject the plan)
- Do NOT include any text or tool calls after SubmitPlan - they will not be executed`,
    {
      planPath: z.string().describe('Absolute path to the plan markdown file you wrote'),
    },
    async (args) => {
      debug('[SubmitPlan] Called with planPath:', args.planPath);
      debug('[SubmitPlan] sessionId (from closure):', sessionId);

      // Verify the file exists
      if (!existsSync(args.planPath)) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: Plan file not found at ${args.planPath}. Please write the plan file first using the Write tool.`,
          }],
        };
      }

      // Read the plan content to verify it's valid
      let planContent: string;
      try {
        planContent = readFileSync(args.planPath, 'utf-8');
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error reading plan file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
        };
      }

      // Store the plan file path
      setLastPlanFilePath(sessionId, args.planPath);

      // Get callbacks and notify UI
      const callbacks = getSessionScopedToolCallbacks(sessionId);
      debug('[SubmitPlan] Registry callbacks found:', !!callbacks);

      if (callbacks?.onPlanSubmitted) {
        callbacks.onPlanSubmitted(args.planPath);
        debug('[SubmitPlan] Callback completed');
      } else {
        debug('[SubmitPlan] No callback registered for session');
      }

      return {
        content: [{
          type: 'text' as const,
          text: 'Plan submitted for review. Waiting for user feedback.',
        }],
        isError: false,
      };
    }
  );
}

/**
 * Create a session-scoped change_working_directory tool.
 * The sessionId is captured at creation time.
 *
 * This tool allows the agent to change the working directory for bash commands
 * and file operations.
 */
export function createChangeWorkingDirectoryTool(sessionId: string) {
  return tool(
    'change_working_directory',
    `Change the working directory for this session.

This changes the directory used for:
- Bash command execution
- File operations (Read, Write, Edit, Glob, Grep)
- Git operations

The change is persisted for the session and reflected in the UI.

Use this when:
- The user asks to work in a different directory
- You need to switch context to a different project
- The current working directory doesn't match the task`,
    {
      path: z.string().describe('Absolute path to the new working directory'),
    },
    async (args) => {
      debug('[change_working_directory] Called with path:', args.path);
      debug('[change_working_directory] sessionId (from closure):', sessionId);

      // Validate the path exists
      if (!existsSync(args.path)) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: Directory does not exist: ${args.path}`,
          }],
          isError: true,
        };
      }

      // Validate it's a directory
      try {
        const stats = statSync(args.path);
        if (!stats.isDirectory()) {
          return {
            content: [{
              type: 'text' as const,
              text: `Error: Path is not a directory: ${args.path}`,
            }],
            isError: true,
          };
        }
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error checking path: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }

      // Get callbacks and notify
      const callbacks = getSessionScopedToolCallbacks(sessionId);
      debug('[change_working_directory] Registry callbacks found:', !!callbacks);

      if (callbacks?.onWorkingDirectoryChange) {
        callbacks.onWorkingDirectoryChange(args.path);
        debug('[change_working_directory] Callback completed');
      } else {
        debug('[change_working_directory] No callback registered for session');
        return {
          content: [{
            type: 'text' as const,
            text: `Error: Unable to change working directory - no handler registered`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `Working directory changed to: ${args.path}`,
        }],
        isError: false,
      };
    }
  );
}

// ============================================================
// Secret Management Tools
// ============================================================

/**
 * Helper to create a CredentialId for agent secrets.
 * Agent secrets use the format: agent_secret::{name}
 */
function createSecretCredentialId(name: string): CredentialId {
  return { type: 'agent_secret', name };
}

/**
 * Mask a secret value for display.
 * Shows first 4 chars and last 4 chars with *** in between.
 */
function maskSecretValue(value: string): string {
  if (value.length <= 8) {
    return '****';
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/**
 * Create a session-scoped secret_write tool.
 * Stores a secret in the encrypted credential store.
 */
export function createSecretWriteTool(sessionId: string) {
  return tool(
    'secret_write',
    `Store a secret securely in the encrypted credential store.

Use this to save sensitive values like:
- API keys
- Access tokens
- Passwords
- Other secrets the user provides

The secret is encrypted at rest using AES-256-GCM and is only accessible
to the agent through the secret_read tool.

**Important:** Always confirm with the user before storing sensitive information.`,
    {
      name: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/).describe(
        'Unique identifier for the secret (alphanumeric, underscore, hyphen only)'
      ),
      value: z.string().min(1).describe('The secret value to store'),
      description: z.string().optional().describe('Optional description of what this secret is for'),
    },
    async (args) => {
      debug('[secret_write] Storing secret:', args.name);

      try {
        const credentialManager = getCredentialManager();
        const credentialId = createSecretCredentialId(args.name);

        // Store the secret with optional description in a metadata-like way
        // We use the tokenType field to store description since StoredCredential
        // doesn't have a dedicated description field
        const credential: StoredCredential = {
          value: args.value,
          tokenType: args.description,
        };

        await credentialManager.set(credentialId, credential);

        return {
          content: [{
            type: 'text' as const,
            text: `Secret '${args.name}' stored successfully.${args.description ? ` Description: ${args.description}` : ''}`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[secret_write] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error storing secret: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create a session-scoped secret_read tool.
 * Retrieves a secret from the encrypted credential store.
 */
export function createSecretReadTool(sessionId: string) {
  return tool(
    'secret_read',
    `Retrieve a secret from the encrypted credential store.

By default, the secret value is masked for safety. Use unmask=true only when
you need to actually use the secret value (e.g., to include in an API call).

**Security:** Prefer to keep secrets masked unless absolutely necessary.
When using unmask=true, avoid displaying the raw value to the user.`,
    {
      name: z.string().describe('The identifier of the secret to retrieve'),
      unmask: z.boolean().default(false).describe(
        'If true, return the actual value. If false (default), return a masked version.'
      ),
    },
    async (args) => {
      debug('[secret_read] Reading secret:', args.name, 'unmask:', args.unmask);

      try {
        const credentialManager = getCredentialManager();
        const credentialId = createSecretCredentialId(args.name);

        const credential = await credentialManager.get(credentialId);

        if (!credential) {
          return {
            content: [{
              type: 'text' as const,
              text: `Secret '${args.name}' not found.`,
            }],
            isError: false,
          };
        }

        const displayValue = args.unmask ? credential.value : maskSecretValue(credential.value);
        const description = credential.tokenType ? ` (${credential.tokenType})` : '';

        return {
          content: [{
            type: 'text' as const,
            text: `Secret '${args.name}'${description}: ${displayValue}`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[secret_read] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error reading secret: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create a session-scoped secret_delete tool.
 * Removes a secret from the encrypted credential store.
 */
export function createSecretDeleteTool(sessionId: string) {
  return tool(
    'secret_delete',
    `Delete a secret from the encrypted credential store.

**Warning:** This action is irreversible. The secret will be permanently removed.
Always confirm with the user before deleting secrets.`,
    {
      name: z.string().describe('The identifier of the secret to delete'),
    },
    async (args) => {
      debug('[secret_delete] Deleting secret:', args.name);

      try {
        const credentialManager = getCredentialManager();
        const credentialId = createSecretCredentialId(args.name);

        const deleted = await credentialManager.delete(credentialId);

        if (deleted) {
          return {
            content: [{
              type: 'text' as const,
              text: `Secret '${args.name}' deleted successfully.`,
            }],
            isError: false,
          };
        } else {
          return {
            content: [{
              type: 'text' as const,
              text: `Secret '${args.name}' not found (may have already been deleted).`,
            }],
            isError: false,
          };
        }
      } catch (error) {
        debug('[secret_delete] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error deleting secret: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create a session-scoped secret_list tool.
 * Lists all agent-managed secrets (names only, not values).
 */
export function createSecretListTool(sessionId: string) {
  return tool(
    'secret_list',
    `List all stored secrets by name.

Returns only the secret names (identifiers), not the values.
Use secret_read to retrieve individual secret values.

Optionally filter by prefix to find secrets in a specific category.`,
    {
      prefix: z.string().optional().describe(
        'Optional prefix to filter secrets (e.g., "api_" to list all API-related secrets)'
      ),
    },
    async (args) => {
      debug('[secret_list] Listing secrets, prefix:', args.prefix);

      try {
        const credentialManager = getCredentialManager();

        // List all agent_secret credentials
        const allSecrets = await credentialManager.list({ type: 'agent_secret' });

        // Extract names and filter by prefix if provided
        let secretNames = allSecrets
          .map((id) => id.name)
          .filter((name): name is string => name !== undefined);

        if (args.prefix) {
          secretNames = secretNames.filter((name) => name.startsWith(args.prefix!));
        }

        if (secretNames.length === 0) {
          const filterNote = args.prefix ? ` matching prefix '${args.prefix}'` : '';
          return {
            content: [{
              type: 'text' as const,
              text: `No secrets found${filterNote}.`,
            }],
            isError: false,
          };
        }

        const secretList = secretNames.map((name) => `- ${name}`).join('\n');
        const filterNote = args.prefix ? ` (filtered by prefix '${args.prefix}')` : '';

        return {
          content: [{
            type: 'text' as const,
            text: `Found ${secretNames.length} secret(s)${filterNote}:\n${secretList}`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[secret_list] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error listing secrets: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Config Validation Tool
// ============================================================

/**
 * Create a session-scoped config_validate tool.
 * Validates configuration files and returns structured error reports.
 */
export function createConfigValidateTool(sessionId: string, workspaceSlug: string) {
  return tool(
    'config_validate',
    `Validate Craft Agent configuration files.

Use this after editing configuration files to check for errors before they take effect.
Returns structured validation results with errors, warnings, and suggestions.

**Targets:**
- \`config\`: Validates ~/.craft-agent/config.json (workspaces, model, settings)
- \`sources\`: Validates all sources in ~/.craft-agent/workspaces/{workspace}/sources/*/config.json
- \`preferences\`: Validates ~/.craft-agent/preferences.json (user preferences)
- \`all\`: Validates all configuration files

**For specific source validation:** Use target='sources' with sourceSlug parameter.

**Example workflow:**
1. Edit a config file using Write/Edit tools
2. Call config_validate to check for errors
3. If errors found, fix them and re-validate
4. Once valid, changes take effect on next reload`,
    {
      target: z.enum(['config', 'sources', 'preferences', 'all']).describe(
        'Which config file(s) to validate'
      ),
      sourceSlug: z.string().optional().describe(
        'Validate a specific source by slug (only used when target is "sources")'
      ),
    },
    async (args) => {
      debug('[config_validate] Validating:', args.target, 'sourceSlug:', args.sourceSlug);

      try {
        let result;

        switch (args.target) {
          case 'config':
            result = validateConfig();
            break;
          case 'sources':
            if (args.sourceSlug) {
              result = validateSource(workspaceSlug, args.sourceSlug);
            } else {
              result = validateAllSources(workspaceSlug);
            }
            break;
          case 'preferences':
            result = validatePreferences();
            break;
          case 'all':
            result = validateAll(workspaceSlug);
            break;
        }

        const formatted = formatValidationResult(result);

        return {
          content: [{
            type: 'text' as const,
            text: formatted,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[config_validate] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error validating config: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Source Test Tool
// ============================================================

/**
 * Test an API source by making a simple HEAD/GET request.
 */
async function testApiSource(
  source: FolderSourceConfig,
  workspaceSlug: string
): Promise<{ success: boolean; status?: number; error?: string }> {
  if (!source.api?.baseUrl) {
    return { success: false, error: 'No API URL configured' };
  }

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    // Get credentials if needed
    if (source.api.authType && source.api.authType !== 'none') {
      const credentialManager = getCredentialManager();
      // Try different source credential types based on auth type
      const credType = source.api.authType === 'oauth' ? 'source_oauth' : 'source_bearer';
      const cred = await credentialManager.get({
        type: credType,
        workspaceSlug,
        sourceSlug: source.slug,
      });

      if (cred?.value) {
        if (source.api.authType === 'bearer') {
          const scheme = source.api.authScheme || 'Bearer';
          headers['Authorization'] = `${scheme} ${cred.value}`;
        } else if (source.api.authType === 'header' && source.api.headerName) {
          headers[source.api.headerName] = cred.value;
        }
        // Query param auth would need URL modification, skip for now
      }
    }

    // Try HEAD first (lighter), fall back to GET
    let response = await fetch(source.api.baseUrl, { method: 'HEAD', headers });

    // Some APIs don't support HEAD, try GET
    if (response.status === 405) {
      response = await fetch(source.api.baseUrl, { method: 'GET', headers });
    }

    if (response.ok || response.status === 401 || response.status === 403) {
      // 401/403 means server is reachable but auth may be needed
      return {
        success: response.ok,
        status: response.status,
        error: response.ok ? undefined : `HTTP ${response.status} - Authentication may be required`
      };
    }

    return { success: false, status: response.status, error: `HTTP ${response.status}` };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Create a session-scoped source_test tool.
 * Tests if an MCP or API source is reachable.
 */
export function createSourceTestTool(sessionId: string, workspaceSlug: string) {
  return tool(
    'source_test',
    `Test a source to verify it's reachable and working.

**Supports:**
- **MCP sources**: Validates server URL, authentication, tool availability, and schema compatibility
- **API sources**: Tests endpoint reachability and authentication

**Usage:**
- Provide a source slug to test an existing source from the current workspace
- The tool will use the source's configured URL and any stored credentials

**Returns:**
- Success status with server info (MCP) or HTTP status (API)
- Detailed error information if connection fails
- Authentication hints if credentials are missing or invalid`,
    {
      sourceSlug: z.string().describe('The slug of the source to test'),
    },
    async (args) => {
      debug('[source_test] Testing source:', args.sourceSlug);

      try {
        // Load the source config
        const source = loadSourceConfig(workspaceSlug, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check that the folder exists in ~/.craft-agent/workspaces/${workspaceSlug}/sources/`,
            }],
            isError: true,
          };
        }

        // Handle API sources
        if (source.type === 'api') {
          const result = await testApiSource(source, workspaceSlug);

          // Update the source's lastTestedAt timestamp
          source.lastTestedAt = Date.now();
          saveSourceConfig(workspaceSlug, source);

          if (result.success) {
            return {
              content: [{
                type: 'text' as const,
                text: `**API Source '${args.sourceSlug}' is working**\n\nURL: ${source.api?.baseUrl}\nStatus: ${result.status}`,
              }],
              isError: false,
            };
          } else {
            return {
              content: [{
                type: 'text' as const,
                text: `**API Source '${args.sourceSlug}' failed**\n\nURL: ${source.api?.baseUrl}\nError: ${result.error}`,
              }],
              isError: true,
            };
          }
        }

        // Handle local sources
        if (source.type === 'local') {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is type 'local'. Local sources don't require network testing.`,
            }],
            isError: false,
          };
        }

        // Handle MCP sources
        if (source.type !== 'mcp') {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' has unknown type '${source.type}'.`,
            }],
            isError: true,
          };
        }

        if (!source.mcp?.url) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' has no MCP URL configured.`,
            }],
            isError: true,
          };
        }

        // Get MCP access token if the source is authenticated
        let mcpAccessToken: string | undefined;
        if (source.isAuthenticated && source.mcp.authType !== 'none') {
          const credentialManager = getCredentialManager();
          // Try OAuth first, then bearer
          const oauthCred = await credentialManager.get({
            type: 'source_oauth',
            workspaceSlug,
            sourceSlug: args.sourceSlug,
          });
          if (oauthCred?.value) {
            mcpAccessToken = oauthCred.value;
          } else {
            const bearerCred = await credentialManager.get({
              type: 'source_bearer',
              workspaceSlug,
              sourceSlug: args.sourceSlug,
            });
            if (bearerCred?.value) {
              mcpAccessToken = bearerCred.value;
            }
          }
        }

        // Get Claude credentials for the validation request
        const claudeApiKey = await getAnthropicApiKey();
        const claudeOAuthToken = await getClaudeOAuthToken();

        if (!claudeApiKey && !claudeOAuthToken) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Cannot test MCP source: No Claude API key or OAuth token configured. Complete setup first.',
            }],
            isError: true,
          };
        }

        // Run the validation
        const result = await validateMcpConnection({
          mcpUrl: source.mcp.url,
          mcpAccessToken,
          claudeApiKey: claudeApiKey ?? undefined,
          claudeOAuthToken: claudeOAuthToken ?? undefined,
        });

        // Update the source's lastTestedAt timestamp
        source.lastTestedAt = Date.now();
        saveSourceConfig(workspaceSlug, source);

        if (result.success) {
          const lines: string[] = [
            `**MCP Source '${args.sourceSlug}' is working**`,
            '',
          ];

          if (result.serverInfo) {
            lines.push(`Server: ${result.serverInfo.name} v${result.serverInfo.version}`);
          }

          if (result.tools && result.tools.length > 0) {
            lines.push(`Tools available: ${result.tools.length}`);
            // List first few tools
            const preview = result.tools.slice(0, 5);
            for (const toolName of preview) {
              lines.push(`  - ${toolName}`);
            }
            if (result.tools.length > 5) {
              lines.push(`  ... and ${result.tools.length - 5} more`);
            }
          }

          return {
            content: [{
              type: 'text' as const,
              text: lines.join('\n'),
            }],
            isError: false,
          };
        } else {
          const lines: string[] = [
            `**MCP Source '${args.sourceSlug}' failed**`,
            '',
            `Error: ${getValidationErrorMessage(result)}`,
          ];

          if (result.errorType === 'invalid-schema' && result.invalidProperties) {
            lines.push('');
            lines.push('Invalid tool properties:');
            for (const prop of result.invalidProperties.slice(0, 10)) {
              lines.push(`  - ${prop.toolName}: ${prop.propertyPath} (key: '${prop.propertyKey}')`);
            }
            if (result.invalidProperties.length > 10) {
              lines.push(`  ... and ${result.invalidProperties.length - 10} more`);
            }
          }

          if (result.errorType === 'needs-auth') {
            lines.push('');
            lines.push('Use the oauth_trigger tool to authenticate this source.');
          }

          return {
            content: [{
              type: 'text' as const,
              text: lines.join('\n'),
            }],
            isError: true,
          };
        }
      } catch (error) {
        debug('[source_test] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error testing source: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// OAuth Trigger Tool
// ============================================================

/**
 * Create a session-scoped oauth_trigger tool.
 * Initiates OAuth authentication for an MCP source.
 */
export function createOAuthTriggerTool(sessionId: string, workspaceSlug: string) {
  return tool(
    'oauth_trigger',
    `Start OAuth authentication for an MCP source.

This tool initiates the OAuth 2.0 + PKCE flow for sources that require authentication.
A browser window will open for the user to complete authentication.

**Prerequisites:**
- Source must exist in the current workspace
- Source must be type 'mcp' with authType 'oauth'
- Source must have a valid MCP URL

**Flow:**
1. Tool checks if auth is needed (may already be authenticated)
2. If needed, opens browser for user to authenticate
3. User completes OAuth flow in browser
4. Tokens are securely stored in credential store
5. Source is marked as authenticated

**Returns:**
- Success message if already authenticated or auth completes
- Error message if OAuth flow fails or is cancelled`,
    {
      sourceSlug: z.string().describe('The slug of the source to authenticate'),
    },
    async (args) => {
      debug('[oauth_trigger] Starting OAuth for source:', args.sourceSlug);

      try {
        // Load the source config
        const source = loadSourceConfig(workspaceSlug, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check that the folder exists in ~/.craft-agent/workspaces/${workspaceSlug}/sources/`,
            }],
            isError: true,
          };
        }

        if (source.type !== 'mcp') {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is type '${source.type}'. OAuth is only for MCP sources.`,
            }],
            isError: true,
          };
        }

        if (source.mcp?.authType !== 'oauth') {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' uses '${source.mcp?.authType || 'none'}' auth, not OAuth. No authentication needed.`,
            }],
            isError: false,
          };
        }

        if (!source.mcp?.url) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' has no MCP URL configured.`,
            }],
            isError: true,
          };
        }

        // Get session callbacks for browser open
        const callbacks = getSessionScopedToolCallbacks(sessionId);

        // Create OAuth config
        const oauthConfig: OAuthConfig = {
          mcpBaseUrl: source.mcp.url,
        };

        // Create OAuth callbacks
        const oauthCallbacks: OAuthCallbacks = {
          onStatus: (message: string) => {
            debug('[oauth_trigger] Status:', message);
          },
          onError: (error: string) => {
            debug('[oauth_trigger] Error:', error);
            callbacks?.onOAuthError?.(args.sourceSlug, error);
          },
        };

        // Create OAuth client
        const oauth = new CraftOAuth(oauthConfig, oauthCallbacks);

        // Check if auth is actually needed
        const needsAuth = await oauth.checkAuthRequired();
        if (!needsAuth && source.isAuthenticated) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is already authenticated.`,
            }],
            isError: false,
          };
        }

        // Run the OAuth flow
        const result = await oauth.authenticate();

        // Store the tokens
        const credentialManager = getCredentialManager();
        await credentialManager.set(
          {
            type: 'source_oauth',
            workspaceSlug,
            sourceSlug: args.sourceSlug,
          },
          {
            value: result.tokens.accessToken,
            refreshToken: result.tokens.refreshToken,
            expiresAt: result.tokens.expiresAt,
            clientId: result.clientId,
            tokenType: result.tokens.tokenType,
          }
        );

        // Update source status
        source.isAuthenticated = true;
        source.updatedAt = Date.now();
        saveSourceConfig(workspaceSlug, source);

        // Notify success callback
        callbacks?.onOAuthSuccess?.(args.sourceSlug);

        return {
          content: [{
            type: 'text' as const,
            text: `**Source '${args.sourceSlug}' authenticated successfully**\n\nOAuth tokens have been stored securely. You can now use source_test to verify it's working.`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[oauth_trigger] Error:', error);

        // Notify error callback
        const callbacks = getSessionScopedToolCallbacks(sessionId);
        callbacks?.onOAuthError?.(args.sourceSlug, error instanceof Error ? error.message : 'Unknown error');

        return {
          content: [{
            type: 'text' as const,
            text: `OAuth authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Source Cache Tools
// ============================================================

/**
 * Create a session-scoped source_cache_update tool.
 * Updates cached values in a source's guide.md frontmatter.
 */
export function createSourceCacheUpdateTool(sessionId: string, workspaceSlug: string) {
  return tool(
    'source_cache_update',
    `Update cached values in a source's guide.md frontmatter.

Use this to store frequently-used data like project IDs, folder mappings, or other
values that you discover during conversations. This avoids re-fetching the same
information in future sessions.

**Cache is stored in YAML frontmatter:**
\`\`\`yaml
---
cache:
  projectIds:
    Backend: "proj_123"
    Frontend: "proj_456"
  lastUpdated: "2025-01-15T10:30:00Z"
---
\`\`\`

**Examples:**
- \`path: "projectIds.Backend", value: "proj_123"\` - Store a project ID
- \`path: "userIds.alice", value: "user_789"\` - Store a user mapping
- \`path: "defaultFolder", value: "Documents"\` - Store a preference

The cache is persisted between sessions and can be read from the guide.md file.`,
    {
      sourceSlug: z.string().describe('The slug of the source to update'),
      path: z.string().describe('Dot-notation path in the cache object (e.g., "projectIds.Backend")'),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]).describe('The value to store'),
    },
    async (args) => {
      debug('[source_cache_update] Updating cache:', args.sourceSlug, args.path, args.value);

      try {
        // Check if source exists
        if (!sourceExists(workspaceSlug, args.sourceSlug)) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check that the folder exists in ~/.craft-agent/workspaces/${workspaceSlug}/sources/`,
            }],
            isError: true,
          };
        }

        // Build the update object using dot notation
        const updates: Record<string, unknown> = {};
        setNestedValue(updates, args.path, args.value);

        // Update the cache
        updateSourceCache(workspaceSlug, args.sourceSlug, updates);

        return {
          content: [{
            type: 'text' as const,
            text: `Cache updated for source '${args.sourceSlug}': ${args.path} = ${JSON.stringify(args.value)}`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[source_cache_update] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error updating cache: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create a session-scoped source_guide_append tool.
 * Appends content to a specific section of a source's guide.md.
 */
export function createSourceGuideAppendTool(sessionId: string, workspaceSlug: string) {
  return tool(
    'source_guide_append',
    `Append content to a specific section of a source's guide.md file.

Use this to add notes, guidelines, or context that you learn during conversations.
This helps build up a knowledge base about the source over time.

**Available sections:**
- \`scope\`: What this source is for, what data it accesses
- \`guidelines\`: How to use this source effectively
- \`context\`: Background information, project structure, etc.
- \`apiNotes\`: API-specific notes, endpoints, rate limits, etc.

**Note:** Content is appended to the end of the specified section.
If the section doesn't exist, it will be created.`,
    {
      sourceSlug: z.string().describe('The slug of the source to update'),
      section: z.enum(['scope', 'guidelines', 'context', 'apiNotes']).describe('Which section to append to'),
      content: z.string().describe('The markdown content to append'),
    },
    async (args) => {
      debug('[source_guide_append] Appending to guide:', args.sourceSlug, args.section);

      try {
        // Check if source exists
        if (!sourceExists(workspaceSlug, args.sourceSlug)) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check that the folder exists in ~/.craft-agent/workspaces/${workspaceSlug}/sources/`,
            }],
            isError: true,
          };
        }

        // Load current guide
        const guide = loadSourceGuide(workspaceSlug, args.sourceSlug) || { raw: '' };

        // Map section name to header
        const sectionHeaders: Record<string, string> = {
          scope: '## Scope',
          guidelines: '## Guidelines',
          context: '## Context',
          apiNotes: '## API Notes',
        };

        const header = sectionHeaders[args.section];
        if (!header) {
          return {
            content: [{
              type: 'text' as const,
              text: `Invalid section: ${args.section}`,
            }],
            isError: true,
          };
        }

        let newRaw = guide.raw;

        // Check if section exists
        const sectionRegex = new RegExp(`^${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`, 'm');
        const sectionMatch = sectionRegex.exec(newRaw);

        if (sectionMatch) {
          // Find the end of this section (next ## or end of file)
          const sectionStart = sectionMatch.index + sectionMatch[0].length;
          const nextSectionMatch = /\n## /.exec(newRaw.slice(sectionStart));
          const sectionEnd = nextSectionMatch ? sectionStart + nextSectionMatch.index : newRaw.length;

          // Insert content before the next section (or at end)
          const beforeSection = newRaw.slice(0, sectionEnd).trimEnd();
          const afterSection = newRaw.slice(sectionEnd);
          newRaw = `${beforeSection}\n\n${args.content.trim()}${afterSection}`;
        } else {
          // Section doesn't exist, add it at the end
          newRaw = `${newRaw.trimEnd()}\n\n${header}\n\n${args.content.trim()}\n`;
        }

        // Save the updated guide
        saveSourceGuide(workspaceSlug, args.sourceSlug, { ...guide, raw: newRaw });

        return {
          content: [{
            type: 'text' as const,
            text: `Content appended to ${args.section} section in source '${args.sourceSlug}'.`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[source_guide_append] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error appending to guide: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create a session-scoped source_cache_read tool.
 * Reads cached values from a source's guide.md frontmatter.
 */
export function createSourceCacheReadTool(sessionId: string, workspaceSlug: string) {
  return tool(
    'source_cache_read',
    `Read cached values from a source's guide.md frontmatter.

Use this to retrieve previously stored cache values like project IDs,
user mappings, or other data discovered in previous sessions.

**Returns the entire cache object or a specific path:**
- No path: Returns the full cache object
- With path: Returns the value at that path (e.g., "projectIds.Backend")`,
    {
      sourceSlug: z.string().describe('The slug of the source to read from'),
      path: z.string().optional().describe('Optional dot-notation path to read (e.g., "projectIds.Backend")'),
    },
    async (args) => {
      debug('[source_cache_read] Reading cache:', args.sourceSlug, args.path);

      try {
        // Check if source exists
        if (!sourceExists(workspaceSlug, args.sourceSlug)) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check that the folder exists in ~/.craft-agent/workspaces/${workspaceSlug}/sources/`,
            }],
            isError: true,
          };
        }

        // Load guide to get cache
        const guide = loadSourceGuide(workspaceSlug, args.sourceSlug);
        if (!guide?.cache) {
          return {
            content: [{
              type: 'text' as const,
              text: `No cache found for source '${args.sourceSlug}'.`,
            }],
            isError: false,
          };
        }

        // Get value at path or full cache
        let value: unknown = guide.cache;
        if (args.path) {
          const keys = args.path.split('.');
          for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
              value = (value as Record<string, unknown>)[key];
            } else {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Path '${args.path}' not found in cache for source '${args.sourceSlug}'.`,
                }],
                isError: false,
              };
            }
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: `Cache for source '${args.sourceSlug}'${args.path ? ` at '${args.path}'` : ''}:\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[source_cache_read] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error reading cache: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Source CRUD Tools
// ============================================================

/**
 * List all sources in the workspace.
 */
export function createSourceListTool(sessionId: string, workspaceSlug: string) {
  return tool(
    'source_list',
    `List all configured sources in the current workspace.

Returns source names, types, providers, and authentication status.
Use this to see what sources are available before creating or modifying them.`,
    {},
    async () => {
      debug('[source_list] Listing sources for workspace:', workspaceSlug);

      try {
        const { loadWorkspaceSources } = await import('../sources/storage.ts');
        const sources = loadWorkspaceSources(workspaceSlug);

        if (sources.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: 'No sources configured in this workspace.',
            }],
            isError: false,
          };
        }

        const lines: string[] = ['**Configured Sources**\n'];
        for (const source of sources) {
          const status = source.config.isAuthenticated ? '✓' : '○';
          const enabled = source.config.enabled ? '' : ' (disabled)';
          lines.push(`- ${status} **${source.config.name}** (${source.config.type}/${source.config.provider})${enabled}`);
          if (source.config.type === 'mcp' && source.config.mcp?.url) {
            lines.push(`  URL: ${source.config.mcp.url}`);
          } else if (source.config.type === 'api' && source.config.api?.baseUrl) {
            lines.push(`  URL: ${source.config.api.baseUrl}`);
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: lines.join('\n'),
          }],
          isError: false,
        };
      } catch (error) {
        debug('[source_list] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error listing sources: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create a new source in the workspace.
 */
export function createSourceCreateTool(sessionId: string, workspaceSlug: string) {
  return tool(
    'source_create',
    `Create a new source in the workspace.

**Source Types:**
- \`mcp\`: Model Context Protocol server
- \`api\`: REST API
- \`local\`: Local filesystem

**MCP Auth Types:** oauth, bearer, none
**API Auth Types:** bearer, header, query, basic, oauth, none

**Examples:**
- MCP with OAuth: \`{ name: "Linear", provider: "linear", type: "mcp", mcp: { url: "https://mcp.linear.app", authType: "oauth" } }\`
- API with bearer: \`{ name: "My API", provider: "custom", type: "api", api: { baseUrl: "https://api.example.com", authType: "bearer" } }\``,
    {
      name: z.string().describe('Human-readable name for the source'),
      provider: z.string().describe('Provider identifier (e.g., "linear", "github", "custom")'),
      type: z.enum(['mcp', 'api', 'local']).describe('Source type'),
      mcpUrl: z.string().optional().describe('MCP server URL (required for type=mcp)'),
      mcpAuthType: z.enum(['oauth', 'bearer', 'none']).optional().describe('MCP auth type (default: none)'),
      apiBaseUrl: z.string().optional().describe('API base URL (required for type=api)'),
      apiAuthType: z.enum(['bearer', 'header', 'query', 'basic', 'oauth', 'none']).optional().describe('API auth type (default: none)'),
      apiHeaderName: z.string().optional().describe('Header name for header auth (e.g., "X-API-Key")'),
      localPath: z.string().optional().describe('Local path (required for type=local)'),
      iconUrl: z.string().optional().describe('Icon URL: relative path (./icon.png), direct image URL, or domain for favicon lookup'),
      enabled: z.boolean().optional().describe('Whether source is enabled (default: true)'),
    },
    async (args) => {
      debug('[source_create] Creating source:', args.name);

      try {
        const { createSource } = await import('../sources/storage.ts');

        // Build the source input
        const input: {
          name: string;
          provider: string;
          type: 'mcp' | 'api' | 'local';
          mcp?: { url: string; authType: 'oauth' | 'bearer' | 'none' };
          api?: { baseUrl: string; authType: 'bearer' | 'header' | 'query' | 'basic' | 'oauth' | 'none'; headerName?: string };
          local?: { path: string };
          iconUrl?: string;
          enabled?: boolean;
        } = {
          name: args.name,
          provider: args.provider,
          type: args.type,
          enabled: args.enabled ?? true,
        };

        // Add iconUrl if provided
        if (args.iconUrl) {
          input.iconUrl = args.iconUrl;
        }

        // Add type-specific config
        if (args.type === 'mcp') {
          if (!args.mcpUrl) {
            return {
              content: [{
                type: 'text' as const,
                text: 'Error: mcpUrl is required for MCP sources.',
              }],
              isError: true,
            };
          }
          input.mcp = {
            url: args.mcpUrl,
            authType: args.mcpAuthType ?? 'none',
          };
        } else if (args.type === 'api') {
          if (!args.apiBaseUrl) {
            return {
              content: [{
                type: 'text' as const,
                text: 'Error: apiBaseUrl is required for API sources.',
              }],
              isError: true,
            };
          }
          input.api = {
            baseUrl: args.apiBaseUrl,
            authType: args.apiAuthType ?? 'none',
            headerName: args.apiHeaderName,
          };
        } else if (args.type === 'local') {
          if (!args.localPath) {
            return {
              content: [{
                type: 'text' as const,
                text: 'Error: localPath is required for local sources.',
              }],
              isError: true,
            };
          }
          input.local = {
            path: args.localPath,
          };
        }

        const config = createSource(workspaceSlug, input);

        const authNote = args.type === 'mcp' && args.mcpAuthType === 'oauth'
          ? '\n\nUse `oauth_trigger` to authenticate this source.'
          : args.type === 'mcp' && args.mcpAuthType === 'bearer'
          ? '\n\nA bearer token will need to be configured for authentication.'
          : '';

        return {
          content: [{
            type: 'text' as const,
            text: `**Source created successfully**\n\nName: ${config.name}\nSlug: ${config.slug}\nType: ${config.type}\nProvider: ${config.provider}${authNote}`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[source_create] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error creating source: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Update an existing source in the workspace.
 */
export function createSourceUpdateTool(sessionId: string, workspaceSlug: string) {
  return tool(
    'source_update',
    `Update an existing source's configuration.

Only the provided fields will be updated; others remain unchanged.`,
    {
      sourceSlug: z.string().describe('The slug of the source to update'),
      name: z.string().optional().describe('New name for the source'),
      enabled: z.boolean().optional().describe('Enable or disable the source'),
      mcpUrl: z.string().optional().describe('New MCP URL'),
      mcpAuthType: z.enum(['oauth', 'bearer', 'none']).optional().describe('New MCP auth type'),
      apiBaseUrl: z.string().optional().describe('New API base URL'),
      apiAuthType: z.enum(['bearer', 'header', 'query', 'basic', 'oauth', 'none']).optional().describe('New API auth type'),
      iconUrl: z.string().optional().describe('Icon URL: relative path (./icon.png), direct image URL, or domain for favicon lookup'),
    },
    async (args) => {
      debug('[source_update] Updating source:', args.sourceSlug);

      try {
        const config = loadSourceConfig(workspaceSlug, args.sourceSlug);
        if (!config) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found.`,
            }],
            isError: true,
          };
        }

        // Update fields
        if (args.name !== undefined) config.name = args.name;
        if (args.enabled !== undefined) config.enabled = args.enabled;

        if (config.mcp) {
          if (args.mcpUrl !== undefined) config.mcp.url = args.mcpUrl;
          if (args.mcpAuthType !== undefined) config.mcp.authType = args.mcpAuthType;
        }

        if (config.api) {
          if (args.apiBaseUrl !== undefined) config.api.baseUrl = args.apiBaseUrl;
          if (args.apiAuthType !== undefined) config.api.authType = args.apiAuthType;
        }

        if (args.iconUrl !== undefined) config.iconUrl = args.iconUrl;

        saveSourceConfig(workspaceSlug, config);

        return {
          content: [{
            type: 'text' as const,
            text: `**Source '${config.name}' updated successfully**`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[source_update] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error updating source: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Delete a source from the workspace.
 */
export function createSourceDeleteTool(sessionId: string, workspaceSlug: string) {
  return tool(
    'source_delete',
    `Delete a source from the workspace.

**Warning:** This permanently removes the source and any stored credentials.`,
    {
      sourceSlug: z.string().describe('The slug of the source to delete'),
    },
    async (args) => {
      debug('[source_delete] Deleting source:', args.sourceSlug);

      try {
        const { deleteSource, sourceExists } = await import('../sources/storage.ts');

        if (!sourceExists(workspaceSlug, args.sourceSlug)) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found.`,
            }],
            isError: true,
          };
        }

        deleteSource(workspaceSlug, args.sourceSlug);

        return {
          content: [{
            type: 'text' as const,
            text: `**Source '${args.sourceSlug}' deleted successfully**`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[source_delete] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error deleting source: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Credential Prompt Tool
// ============================================================

/**
 * Create a session-scoped credential_prompt tool.
 * Prompts the user to enter credentials for a source via the secure input UI.
 */
export function createCredentialPromptTool(sessionId: string, workspaceSlug: string) {
  return tool(
    'credential_prompt',
    `Prompt the user to enter credentials for a source.

Use this when a source requires authentication that isn't OAuth.
The user will see a secure input UI with appropriate fields based on the auth mode.

**Auth Modes:**
- \`bearer\`: Single token field (Bearer Token, API Key)
- \`basic\`: Username and Password fields
- \`header\`: API Key with custom header name shown
- \`query\`: API Key for query parameter auth

**After user enters credentials:**
- Credentials are securely stored in the encrypted credential store
- Source is marked as authenticated
- Returns success or cancellation status

**Example usage:**
\`\`\`
credential_prompt({
  sourceSlug: "my-api",
  mode: "bearer",
  labels: { credential: "API Key" },
  description: "Enter your API key from the dashboard",
  hint: "Find it at https://example.com/settings/api"
})
\`\`\``,
    {
      sourceSlug: z.string().describe('The slug of the source to authenticate'),
      mode: z.enum(['bearer', 'basic', 'header', 'query']).describe('Type of credential input'),
      labels: z.object({
        credential: z.string().optional().describe('Label for primary credential field'),
        username: z.string().optional().describe('Label for username field (basic auth)'),
        password: z.string().optional().describe('Label for password field (basic auth)'),
      }).optional().describe('Custom field labels'),
      description: z.string().optional().describe('Description shown to user'),
      hint: z.string().optional().describe('Hint about where to find credentials'),
    },
    async (args) => {
      debug('[credential_prompt] Prompting for credentials:', args.sourceSlug, args.mode);

      try {
        // Load source to get name and validate
        const source = loadSourceConfig(workspaceSlug, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check that the folder exists in ~/.craft-agent/workspaces/${workspaceSlug}/sources/`,
            }],
            isError: true,
          };
        }

        // Get callbacks
        const callbacks = getSessionScopedToolCallbacks(sessionId);
        if (!callbacks?.onCredentialRequest) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: No credential input handler available. This tool requires a UI to prompt for credentials.',
            }],
            isError: true,
          };
        }

        // Build request
        const request: CredentialRequest = {
          requestId: crypto.randomUUID(),
          sessionId,
          sourceSlug: args.sourceSlug,
          sourceName: source.name,
          mode: args.mode,
          labels: args.labels,
          description: args.description,
          hint: args.hint,
          headerName: source.api?.headerName,
        };

        // Wait for user response
        const response = await callbacks.onCredentialRequest(request);

        if (response.cancelled) {
          return {
            content: [{
              type: 'text' as const,
              text: `User cancelled credential input for '${source.name}'.`,
            }],
            isError: false,
          };
        }

        // Store credentials based on mode
        const credManager = getCredentialManager();

        if (args.mode === 'basic') {
          // Encode basic auth as base64 (username:password)
          const encoded = Buffer.from(`${response.username}:${response.password}`).toString('base64');
          await credManager.set(
            { type: 'source_basic', workspaceSlug, sourceSlug: args.sourceSlug },
            { value: encoded }
          );
        } else if (args.mode === 'bearer') {
          await credManager.set(
            { type: 'source_bearer', workspaceSlug, sourceSlug: args.sourceSlug },
            { value: response.value! }
          );
        } else {
          // header or query - stored as API key
          await credManager.set(
            { type: 'source_apikey', workspaceSlug, sourceSlug: args.sourceSlug },
            { value: response.value! }
          );
        }

        // Mark source as authenticated
        source.isAuthenticated = true;
        source.updatedAt = Date.now();
        saveSourceConfig(workspaceSlug, source);

        return {
          content: [{
            type: 'text' as const,
            text: `Credentials saved for '${source.name}'. The source is now authenticated.`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[credential_prompt] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error prompting for credentials: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// Session-Scoped Tools Provider
// ============================================================

/**
 * Cache of session-scoped tool providers, keyed by sessionId.
 */
const sessionScopedToolsCache = new Map<string, ReturnType<typeof createSdkMcpServer>>();

/**
 * Get the session-scoped tools provider for a session.
 * Creates and caches the provider if it doesn't exist.
 *
 * @param sessionId - Unique session identifier
 * @param workspaceSlug - Workspace slug for source-scoped operations
 */
export function getSessionScopedTools(sessionId: string, workspaceSlug: string): ReturnType<typeof createSdkMcpServer> {
  // Include workspaceSlug in cache key to handle workspace changes
  const cacheKey = `${sessionId}::${workspaceSlug}`;
  let cached = sessionScopedToolsCache.get(cacheKey);
  if (!cached) {
    // Create session-scoped tools that capture the sessionId and workspaceSlug in their closures
    cached = createSdkMcpServer({
      name: 'session',
      version: '1.0.0',
      tools: [
        createSubmitPlanTool(sessionId),
        createChangeWorkingDirectoryTool(sessionId),
        // Secret management tools
        createSecretWriteTool(sessionId),
        createSecretReadTool(sessionId),
        createSecretDeleteTool(sessionId),
        createSecretListTool(sessionId),
        // Config validation tool
        createConfigValidateTool(sessionId, workspaceSlug),
        // Source tools (workspace-scoped)
        createSourceTestTool(sessionId, workspaceSlug),
        createOAuthTriggerTool(sessionId, workspaceSlug),
        createCredentialPromptTool(sessionId, workspaceSlug),
        createSourceCacheUpdateTool(sessionId, workspaceSlug),
        createSourceCacheReadTool(sessionId, workspaceSlug),
        createSourceGuideAppendTool(sessionId, workspaceSlug),
        // Source CRUD tools
        createSourceListTool(sessionId, workspaceSlug),
        createSourceCreateTool(sessionId, workspaceSlug),
        createSourceUpdateTool(sessionId, workspaceSlug),
        createSourceDeleteTool(sessionId, workspaceSlug),
      ],
    });
    sessionScopedToolsCache.set(cacheKey, cached);
    debug(`[SessionScopedTools] Created tools provider for session ${sessionId} in workspace ${workspaceSlug}`);
  }
  return cached;
}

/**
 * Clean up session-scoped tools when a session is disposed.
 * Removes the cached provider and clears all session state.
 *
 * @param sessionId - Unique session identifier
 * @param workspaceSlug - Optional workspace slug; if provided, only cleans up that specific workspace's cache
 */
export function cleanupSessionScopedTools(sessionId: string, workspaceSlug?: string): void {
  if (workspaceSlug) {
    // Clean up specific workspace cache
    const cacheKey = `${sessionId}::${workspaceSlug}`;
    sessionScopedToolsCache.delete(cacheKey);
  } else {
    // Clean up all workspace caches for this session
    for (const key of sessionScopedToolsCache.keys()) {
      if (key.startsWith(`${sessionId}::`)) {
        sessionScopedToolsCache.delete(key);
      }
    }
  }
  sessionScopedToolCallbackRegistry.delete(sessionId);
  sessionPlanFiles.delete(sessionId);
  debug(`[SessionScopedTools] Cleaned up session ${sessionId}`);
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Get the plans directory for a session
 */
export function getSessionPlansDir(workspaceSlug: string, sessionId: string): string {
  return getSessionPlansPath(workspaceSlug, sessionId);
}

/**
 * Check if a file path is within the plans directory
 */
export function isPathInPlansDir(filePath: string, workspaceSlug: string, sessionId: string): boolean {
  const plansDir = getSessionPlansPath(workspaceSlug, sessionId);
  // Normalize paths for comparison
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPlansDir = plansDir.replace(/\\/g, '/');
  return normalizedPath.startsWith(normalizedPlansDir);
}
