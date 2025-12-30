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
  loadSourceConfigWithFallback,
  saveSourceConfigWithContext,
  type SourceWithContext,
} from '../sources/storage.ts';
import type { FolderSourceConfig, SourceGuide, LoadedSource } from '../sources/types.ts';
import { createSourceService } from '../sources/service.ts';
import { CraftOAuth, getMcpBaseUrl, type OAuthConfig, type OAuthCallbacks } from '../auth/oauth.ts';
import { startGmailOAuth } from '../auth/gmail-oauth.ts';

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
  /** Called when sources change (created/authenticated/deleted) - triggers reload of MCP servers */
  onSourcesChanged?: () => Promise<void>;
  /** Called to activate a source for the current session (adds to enabled sources) */
  onSourceActivated?: (sourceSlug: string) => Promise<void>;
  /** Called when agents change (created/synced/deleted) - triggers reload of agent list */
  onAgentsChanged?: () => Promise<void>;
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
): Promise<{ success: boolean; status?: number; error?: string; credentialType?: string }> {
  if (!source.api?.baseUrl) {
    return { success: false, error: 'No API URL configured' };
  }

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    let credentialType: string | undefined;
    let credValue: string | undefined;

    // Get credentials if needed - try multiple credential types
    if (source.api.authType && source.api.authType !== 'none') {
      const credentialManager = getCredentialManager();
      const baseId = { workspaceSlug, sourceSlug: source.slug };

      // Try credential types in order of preference
      const credTypesToTry: Array<'source_oauth' | 'source_bearer' | 'source_apikey' | 'source_basic'> = [
        'source_oauth',
        'source_bearer',
        'source_apikey',
        'source_basic',
      ];

      for (const credType of credTypesToTry) {
        const cred = await credentialManager.get({ type: credType, ...baseId });
        if (cred?.value) {
          credValue = cred.value;
          credentialType = credType;
          debug(`[testApiSource] Found credential type ${credType} for ${source.slug}`);
          break;
        }
      }

      if (credValue) {
        // Apply credential based on authType config
        if (source.api.authType === 'bearer' || source.api.authType === 'oauth') {
          const scheme = source.api.authScheme || 'Bearer';
          headers['Authorization'] = `${scheme} ${credValue}`;
        } else if (source.api.authType === 'header' && source.api.headerName) {
          headers[source.api.headerName] = credValue;
        } else if (source.api.authType === 'basic') {
          // Basic auth - credValue should already be base64 encoded
          headers['Authorization'] = `Basic ${credValue}`;
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
        error: response.ok ? undefined : `HTTP ${response.status} - Authentication may be required`,
        credentialType,
      };
    }

    return { success: false, status: response.status, error: `HTTP ${response.status}`, credentialType };
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
export function createSourceTestTool(sessionId: string, workspaceSlug: string, activeAgentSlug?: string) {
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
        // Load the source config (checks agent folder first if activeAgentSlug set, then workspace)
        const sourceResult = loadSourceConfigWithFallback(workspaceSlug, args.sourceSlug, activeAgentSlug);
        if (!sourceResult) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check that the folder exists in ~/.craft-agent/workspaces/${workspaceSlug}/sources/`,
            }],
            isError: true,
          };
        }
        const source = sourceResult.config;
        const sourceContext = { isAgentScoped: sourceResult.isAgentScoped, agentSlug: sourceResult.agentSlug };

        // Handle API sources
        if (source.type === 'api') {
          const result = await testApiSource(source, workspaceSlug);

          // Update the source's status and timestamp
          source.lastTestedAt = Date.now();
          if (result.success) {
            source.connectionStatus = 'connected';
            source.connectionError = undefined;
          } else {
            source.connectionStatus = 'failed';
            source.connectionError = result.error;
          }
          saveSourceConfigWithContext(workspaceSlug, source, sourceContext);

          if (result.success) {
            const lines: string[] = [
              `**API Source '${args.sourceSlug}' is working**`,
              '',
              `URL: ${source.api?.baseUrl}`,
              `Status: ${result.status}`,
            ];

            if (result.credentialType) {
              lines.push(`Credential: ${result.credentialType}`);
            }

            // Verify the source can be built for session use
            const sourceService = createSourceService(workspaceSlug);
            const loadedSource: LoadedSource = {
              config: source,
              guide: null,
              folderPath: '', // Not needed for credential lookup
              workspaceSlug,
              agentSlug: sourceContext.agentSlug,
            };
            const apiServer = await sourceService.buildApiServer(loadedSource);

            if (!apiServer) {
              lines.push('');
              lines.push('⚠️ **Warning**: API is reachable, but session credential lookup failed.');
              lines.push('The source may not work in this session. Try re-authenticating with the correct auth type.');
              if (source.api?.authType) {
                lines.push(`Current authType: ${source.api.authType}`);
              }
            } else {
              lines.push('');
              lines.push('✓ Source is ready for session use.');
            }

            return {
              content: [{
                type: 'text' as const,
                text: lines.join('\n'),
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
          // Update status - local sources are always connected
          source.lastTestedAt = Date.now();
          source.connectionStatus = 'connected';
          source.connectionError = undefined;
          saveSourceConfigWithContext(workspaceSlug, source, sourceContext);

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

        // Update the source's status and timestamp
        source.lastTestedAt = Date.now();
        if (result.success) {
          source.connectionStatus = 'connected';
          source.connectionError = undefined;
        } else if (result.errorType === 'needs-auth') {
          source.connectionStatus = 'needs_auth';
          source.connectionError = undefined;
        } else {
          source.connectionStatus = 'failed';
          source.connectionError = getValidationErrorMessage(result);
        }
        saveSourceConfigWithContext(workspaceSlug, source, sourceContext);

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

          // Verify the source can be built for session use
          // This checks if credentials are properly configured for the session's credential lookup
          const sourceService = createSourceService(workspaceSlug);
          const loadedSource: LoadedSource = {
            config: source,
            guide: null,
            folderPath: '', // Not needed for credential lookup
            workspaceSlug,
            agentSlug: sourceContext.agentSlug,
          };
          const mcpConfig = await sourceService.buildMcpServerConfig(loadedSource);

          if (!mcpConfig) {
            lines.push('');
            lines.push('⚠️ **Warning**: MCP server is reachable, but session credential lookup failed.');
            lines.push('The source may not work in this session. Try re-authenticating with the correct auth type.');
            if (source.mcp?.authType) {
              lines.push(`Current authType: ${source.mcp.authType}`);
            }
          } else {
            lines.push('');
            lines.push('✓ Source is ready for session use.');
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
export function createOAuthTriggerTool(sessionId: string, workspaceSlug: string, activeAgentSlug?: string) {
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
        // Load the source config (checks agent folder first if activeAgentSlug set, then workspace)
        const sourceResult = loadSourceConfigWithFallback(workspaceSlug, args.sourceSlug, activeAgentSlug);
        if (!sourceResult) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check that the folder exists in ~/.craft-agent/workspaces/${workspaceSlug}/sources/`,
            }],
            isError: true,
          };
        }
        const source = sourceResult.config;
        const sourceContext = { isAgentScoped: sourceResult.isAgentScoped, agentSlug: sourceResult.agentSlug };

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

        // Create OAuth config - strip /mcp or /sse suffix for OAuth discovery
        const oauthConfig: OAuthConfig = {
          mcpBaseUrl: getMcpBaseUrl(source.mcp.url),
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
        source.connectionStatus = 'connected';
        source.connectionError = undefined;
        source.updatedAt = Date.now();
        saveSourceConfigWithContext(workspaceSlug, source, sourceContext);

        // Notify success callback
        callbacks?.onOAuthSuccess?.(args.sourceSlug);

        // Activate the source for this session
        try {
          await callbacks?.onSourceActivated?.(args.sourceSlug);
          debug('[oauth_trigger] Source activated for session:', args.sourceSlug);
        } catch (err) {
          console.log('[oauth_trigger] onSourceActivated callback error:', err);
        }

        // Trigger source reload callback so new tools are available (don't let failures affect tool result)
        try {
          await callbacks?.onSourcesChanged?.();
        } catch (err) {
          console.log('[oauth_trigger] onSourcesChanged callback error:', err);
        }

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

/**
 * Create a session-scoped gmail_oauth_trigger tool.
 * Initiates Gmail OAuth authentication for a Gmail source.
 */
export function createGmailOAuthTriggerTool(sessionId: string, workspaceSlug: string, activeAgentSlug?: string) {
  return tool(
    'gmail_oauth_trigger',
    `Trigger Gmail OAuth authentication flow.

Opens a browser window for the user to sign in with their Google account and authorize Gmail access.
After successful authentication, the tokens are stored and the source is marked as authenticated.

**Prerequisites:**
- The source must be type 'api' with provider 'gmail'
- Gmail OAuth must be configured in the build (GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET)

**Returns:**
- Success message with the authenticated email address
- Error message if OAuth flow fails or is not configured`,
    {
      sourceSlug: z.string().describe('The slug of the Gmail source to authenticate'),
    },
    async (args) => {
      debug('[gmail_oauth_trigger] Starting Gmail OAuth for source:', args.sourceSlug);

      try {
        // Load the source config (checks agent folder first if activeAgentSlug set, then workspace)
        const sourceResult = loadSourceConfigWithFallback(workspaceSlug, args.sourceSlug, activeAgentSlug);
        if (!sourceResult) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check that the folder exists in ~/.craft-agent/workspaces/${workspaceSlug}/sources/`,
            }],
            isError: true,
          };
        }
        const source = sourceResult.config;
        const sourceContext = { isAgentScoped: sourceResult.isAgentScoped, agentSlug: sourceResult.agentSlug };

        // Verify this is a Gmail source
        if (source.provider !== 'gmail') {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is provider '${source.provider}'. gmail_oauth_trigger is only for Gmail sources. Use oauth_trigger for MCP sources.`,
            }],
            isError: true,
          };
        }

        if (source.isAuthenticated) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is already authenticated.`,
            }],
            isError: false,
          };
        }

        // Run the Gmail OAuth flow
        const result = await startGmailOAuth('electron');

        if (!result.success) {
          const callbacks = getSessionScopedToolCallbacks(sessionId);
          callbacks?.onOAuthError?.(args.sourceSlug, result.error || 'Unknown error');

          return {
            content: [{
              type: 'text' as const,
              text: `Gmail OAuth failed: ${result.error || 'Unknown error'}`,
            }],
            isError: true,
          };
        }

        // Store the tokens
        const credentialManager = getCredentialManager();
        await credentialManager.set(
          {
            type: 'source_oauth',
            workspaceSlug,
            sourceSlug: args.sourceSlug,
          },
          {
            value: result.accessToken!,
            refreshToken: result.refreshToken,
            expiresAt: result.expiresAt,
          }
        );

        // Update source status with email info
        source.isAuthenticated = true;
        source.connectionStatus = 'connected';
        source.connectionError = undefined;
        source.updatedAt = Date.now();
        saveSourceConfigWithContext(workspaceSlug, source, sourceContext);

        // Notify success callback
        const callbacks = getSessionScopedToolCallbacks(sessionId);
        callbacks?.onOAuthSuccess?.(args.sourceSlug);

        // Activate the source for this session
        try {
          await callbacks?.onSourceActivated?.(args.sourceSlug);
          debug('[gmail_oauth_trigger] Source activated for session:', args.sourceSlug);
        } catch (err) {
          console.log('[gmail_oauth_trigger] onSourceActivated callback error:', err);
        }

        // Trigger source reload callback so new tools are available (don't let failures affect tool result)
        try {
          await callbacks?.onSourcesChanged?.();
        } catch (err) {
          console.log('[gmail_oauth_trigger] onSourcesChanged callback error:', err);
        }

        return {
          content: [{
            type: 'text' as const,
            text: `**Gmail source '${args.sourceSlug}' authenticated successfully**\n\nConnected as: ${result.email}\n\nYou can now access Gmail tools for this source.`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[gmail_oauth_trigger] Error:', error);

        const callbacks = getSessionScopedToolCallbacks(sessionId);
        callbacks?.onOAuthError?.(args.sourceSlug, error instanceof Error ? error.message : 'Unknown error');

        return {
          content: [{
            type: 'text' as const,
            text: `Gmail OAuth failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
 * Create a new source in the workspace or scoped to an agent.
 * When called in an agent context (activeAgentSlug is set), sources are agent-scoped by default.
 */
export function createSourceCreateTool(sessionId: string, workspaceSlug: string, activeAgentSlug?: string) {
  const scopeDescription = activeAgentSlug
    ? `By default, sources are scoped to the current agent (\`${activeAgentSlug}\`).
To create a workspace-scoped source instead, explicitly set \`scope: "workspace"\`.`
    : `By default, sources are workspace-scoped (available to all agents).
To create an agent-scoped source, provide an \`agentSlug\`.`;

  return tool(
    'source_create',
    `Create a new source in the workspace or scoped to a specific agent.

**Source Types:**
- \`mcp\`: Model Context Protocol server
- \`api\`: REST API
- \`local\`: Local filesystem

**Scoping:**
${scopeDescription}

**MCP Auth Types:** oauth, bearer, none
**API Auth Types:** bearer, header, query, basic, oauth, none

**Examples:**
- Workspace MCP: \`{ name: "Linear", provider: "linear", type: "mcp", mcpUrl: "https://mcp.linear.app", mcpAuthType: "oauth", scope: "workspace" }\`
- Agent-scoped API: \`{ name: "Exa", provider: "exa", type: "api", apiBaseUrl: "https://api.exa.ai", apiAuthType: "header", apiHeaderName: "x-api-key" }\``,
    {
      name: z.string().describe('Human-readable name for the source'),
      provider: z.string().describe('Provider identifier (e.g., "linear", "github", "custom")'),
      type: z.enum(['mcp', 'api', 'local']).describe('Source type'),
      scope: z.enum(['agent', 'workspace']).optional().describe('Where to store the source: "agent" (under active agent) or "workspace" (global)'),
      agentSlug: z.string().optional().describe('Override: specific agent to scope source to (defaults to active agent if in agent context)'),
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
      debug('[source_create] Creating source:', args.name, 'agentSlug:', args.agentSlug);

      try {
        const { createSource, createAgentSource } = await import('../sources/storage.ts');

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

        // Determine effective agent slug for scoping:
        // 1. If explicit agentSlug provided, use it
        // 2. If scope is 'workspace', no agent scoping
        // 3. If active agent is a built-in (dot-prefixed like .source-setup), default to workspace
        // 4. Otherwise, default to activeAgentSlug (if in agent context)
        const isBuiltinAgent = activeAgentSlug?.startsWith('.');
        const effectiveAgentSlug = args.agentSlug ?? (
          args.scope === 'workspace' || isBuiltinAgent ? undefined : activeAgentSlug
        );

        // Create source: agent-scoped or workspace-scoped
        const config = effectiveAgentSlug
          ? createAgentSource(workspaceSlug, effectiveAgentSlug, input)
          : createSource(workspaceSlug, input);

        debug('[source_create] Created source:', args.name, 'effectiveAgentSlug:', effectiveAgentSlug);

        // Get callbacks
        const callbacks = getSessionScopedToolCallbacks(sessionId);

        // Determine if source needs authentication
        const needsAuth = (args.type === 'mcp' && args.mcpAuthType && args.mcpAuthType !== 'none') ||
                          (args.type === 'api' && args.apiAuthType && args.apiAuthType !== 'none');

        // Activate source for this session if it doesn't need auth
        // (sources needing auth will be activated after authentication completes)
        if (!needsAuth) {
          try {
            await callbacks?.onSourceActivated?.(config.slug);
            debug('[source_create] Source activated for session:', config.slug);
          } catch (err) {
            console.log('[source_create] onSourceActivated callback error:', err);
          }
        }

        // Trigger source reload callback (don't let failures affect tool result)
        try {
          await callbacks?.onSourcesChanged?.();
        } catch (err) {
          console.log('[source_create] onSourcesChanged callback error:', err);
        }

        const authNote = args.type === 'mcp' && args.mcpAuthType === 'oauth'
          ? '\n\nUse `oauth_trigger` to authenticate this source.'
          : args.type === 'mcp' && args.mcpAuthType === 'bearer'
          ? '\n\nA bearer token will need to be configured for authentication.'
          : args.type === 'api' && args.apiAuthType && args.apiAuthType !== 'none'
          ? '\n\nUse `credential_prompt` to provide credentials for this API.'
          : '';

        const scopeNote = effectiveAgentSlug
          ? `\nScope: Agent (${effectiveAgentSlug})`
          : '\nScope: Workspace';

        return {
          content: [{
            type: 'text' as const,
            text: `**Source created successfully**\n\nName: ${config.name}\nSlug: ${config.slug}\nType: ${config.type}\nProvider: ${config.provider}${scopeNote}${authNote}`,
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
export function createSourceUpdateTool(sessionId: string, workspaceSlug: string, activeAgentSlug?: string) {
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
        // Load source (checks agent folder first if activeAgentSlug set, then workspace)
        const sourceResult = loadSourceConfigWithFallback(workspaceSlug, args.sourceSlug, activeAgentSlug);
        if (!sourceResult) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found.`,
            }],
            isError: true,
          };
        }
        const config = sourceResult.config;
        const sourceContext = { isAgentScoped: sourceResult.isAgentScoped, agentSlug: sourceResult.agentSlug };

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

        saveSourceConfigWithContext(workspaceSlug, config, sourceContext);

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

        // Trigger source reload callback (don't let failures affect tool result)
        const callbacks = getSessionScopedToolCallbacks(sessionId);
        try {
          await callbacks?.onSourcesChanged?.();
        } catch (err) {
          console.log('[source_delete] onSourcesChanged callback error:', err);
        }

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
// Source Safe Mode Tool
// ============================================================

/**
 * Create or update Safe Mode rules for a source.
 * Creates a safe-mode.md file in the source folder.
 */
export function createSourceSafeModeUpdateTool(sessionId: string, workspaceSlug: string, activeAgentSlug?: string) {
  return tool(
    'source_safe_mode_update',
    `Create or update Safe Mode rules for a source.

Safe Mode is a read-only exploration mode. Custom rules let you allow specific operations that would otherwise be blocked.

**Rule Types:**
- \`allowedMcpPatterns\`: Regex patterns for MCP tool names to allow (e.g., \`^mcp__linear__list\`)
- \`allowedApiMethods\`: HTTP methods to allow (e.g., \`POST\` for APIs that use POST for search)
- \`allowedBashPatterns\`: Regex patterns for bash commands to allow
- \`blockedTools\`: Additional tools to block (rarely needed)

Rules are additive - they extend the defaults to make Safe Mode more permissive for this source.`,
    {
      sourceSlug: z.string().describe('The slug of the source to configure'),
      allowedMcpPatterns: z.array(z.object({
        pattern: z.string().describe('Regex pattern for tool names (e.g., ^mcp__linear__list)'),
        comment: z.string().optional().describe('Optional comment explaining the pattern'),
      })).optional().describe('MCP tool patterns to allow'),
      allowedApiMethods: z.array(z.object({
        method: z.string().describe('HTTP method (e.g., POST, HEAD, OPTIONS)'),
        comment: z.string().optional().describe('Optional comment explaining why'),
      })).optional().describe('HTTP methods to allow'),
      allowedBashPatterns: z.array(z.object({
        pattern: z.string().describe('Regex pattern for bash commands'),
        comment: z.string().optional().describe('Optional comment explaining the pattern'),
      })).optional().describe('Bash command patterns to allow'),
      blockedTools: z.array(z.string()).optional().describe('Additional tools to block'),
    },
    async (args) => {
      debug('[source_safe_mode_update] Updating safe mode for source:', args.sourceSlug);

      try {
        const { existsSync, writeFileSync, mkdirSync } = await import('fs');
        const { join } = await import('path');
        const { getSourcePath, getAgentSourcePath, sourceExists, agentSourceExists } = await import('../sources/storage.ts');

        // Check if source exists (agent-scoped first if activeAgentSlug, then workspace)
        // Skip agent scope check for built-in agents (dot-prefixed like .source-setup)
        let sourcePath: string;
        let sourceName = args.sourceSlug;
        const isBuiltinAgent = activeAgentSlug?.startsWith('.');

        if (activeAgentSlug && !isBuiltinAgent && agentSourceExists(workspaceSlug, activeAgentSlug, args.sourceSlug)) {
          sourcePath = getAgentSourcePath(workspaceSlug, activeAgentSlug, args.sourceSlug);
        } else if (sourceExists(workspaceSlug, args.sourceSlug)) {
          sourcePath = getSourcePath(workspaceSlug, args.sourceSlug);
        } else {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found.`,
            }],
            isError: true,
          };
        }

        // Try to get source name from config
        try {
          const configPath = join(sourcePath, 'config.json');
          if (existsSync(configPath)) {
            const { readFileSync } = await import('fs');
            const config = JSON.parse(readFileSync(configPath, 'utf-8'));
            sourceName = config.name || args.sourceSlug;
          }
        } catch {
          // Ignore, use slug as name
        }

        // Generate markdown content
        const lines: string[] = [
          `# Safe Mode Configuration for ${sourceName}`,
          '',
          'Rules here extend the defaults (more permissive).',
          '',
        ];

        if (args.allowedMcpPatterns && args.allowedMcpPatterns.length > 0) {
          lines.push('## Allowed MCP Patterns', '');
          lines.push('Additional MCP tools to allow in Safe Mode:', '');
          for (const { pattern, comment } of args.allowedMcpPatterns) {
            lines.push(comment ? `- \`${pattern}\` - ${comment}` : `- \`${pattern}\``);
          }
          lines.push('');
        }

        if (args.allowedApiMethods && args.allowedApiMethods.length > 0) {
          lines.push('## Allowed API Methods', '');
          lines.push('Additional HTTP methods to allow:', '');
          for (const { method, comment } of args.allowedApiMethods) {
            lines.push(comment ? `- \`${method}\` - ${comment}` : `- \`${method}\``);
          }
          lines.push('');
        }

        if (args.allowedBashPatterns && args.allowedBashPatterns.length > 0) {
          lines.push('## Allowed Bash Patterns', '');
          lines.push('Additional bash commands to allow (regex):', '');
          for (const { pattern, comment } of args.allowedBashPatterns) {
            lines.push(comment ? `- \`${pattern}\` - ${comment}` : `- \`${pattern}\``);
          }
          lines.push('');
        }

        if (args.blockedTools && args.blockedTools.length > 0) {
          lines.push('## Blocked Tools', '');
          lines.push('Additional tools to block:', '');
          for (const tool of args.blockedTools) {
            lines.push(`- \`${tool}\``);
          }
          lines.push('');
        }

        // Write the file
        const safeModePath = join(sourcePath, 'safe-mode.md');
        mkdirSync(sourcePath, { recursive: true });
        writeFileSync(safeModePath, lines.join('\n'), 'utf-8');

        debug('[source_safe_mode_update] Created safe-mode.md at:', safeModePath);

        // Build summary of what was configured
        const summary: string[] = [];
        if (args.allowedMcpPatterns?.length) {
          summary.push(`${args.allowedMcpPatterns.length} MCP pattern(s)`);
        }
        if (args.allowedApiMethods?.length) {
          summary.push(`${args.allowedApiMethods.length} API method(s)`);
        }
        if (args.allowedBashPatterns?.length) {
          summary.push(`${args.allowedBashPatterns.length} bash pattern(s)`);
        }
        if (args.blockedTools?.length) {
          summary.push(`${args.blockedTools.length} blocked tool(s)`);
        }

        return {
          content: [{
            type: 'text' as const,
            text: `**Safe Mode rules created for '${sourceName}'**\n\nConfigured: ${summary.join(', ') || 'empty config'}\n\nFile: \`${safeModePath}\`\n\nThese rules will be applied when Safe Mode is active.`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[source_safe_mode_update] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error creating Safe Mode rules: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
export function createCredentialPromptTool(sessionId: string, workspaceSlug: string, activeAgentSlug?: string) {
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
        // Load source to get name and validate (checks agent folder first if activeAgentSlug set, then workspace)
        const sourceResult = loadSourceConfigWithFallback(workspaceSlug, args.sourceSlug, activeAgentSlug);
        if (!sourceResult) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check that the folder exists in ~/.craft-agent/workspaces/${workspaceSlug}/sources/`,
            }],
            isError: true,
          };
        }
        const source = sourceResult.config;
        const sourceContext = { isAgentScoped: sourceResult.isAgentScoped, agentSlug: sourceResult.agentSlug };

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

        // Update source authType to match the credential mode
        // This ensures getCredentialId() returns the correct credential type later
        if (source.type === 'mcp' && source.mcp) {
          source.mcp.authType = args.mode === 'bearer' ? 'bearer' : source.mcp.authType;
        } else if (source.type === 'api' && source.api) {
          source.api.authType = args.mode;
        }

        // Mark source as authenticated and connected
        source.isAuthenticated = true;
        source.connectionStatus = 'connected';
        source.connectionError = undefined;
        source.updatedAt = Date.now();
        saveSourceConfigWithContext(workspaceSlug, source, sourceContext);

        // Activate the source for this session
        try {
          await callbacks?.onSourceActivated?.(args.sourceSlug);
          debug('[credential_prompt] Source activated for session:', args.sourceSlug);
        } catch (err) {
          console.log('[credential_prompt] onSourceActivated callback error:', err);
        }

        // Trigger source reload callback so new tools are available (don't let failures affect tool result)
        try {
          await callbacks?.onSourcesChanged?.();
        } catch (err) {
          console.log('[credential_prompt] onSourcesChanged callback error:', err);
        }

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
// Agent Tools
// ============================================================

/**
 * List all agents in the workspace.
 */
export function createAgentListTool(sessionId: string, workspaceSlug: string) {
  return tool(
    'agent_list',
    `List all agents in the workspace.

Returns a list of all agents with their name, slug, enabled status, and source info.
Use this to discover what agents are available before creating new ones.`,
    {},
    async () => {
      debug('[agent_list] Listing agents in workspace:', workspaceSlug);

      try {
        const { loadWorkspaceAgents } = await import('../agents/folder-storage.ts');
        const agents = loadWorkspaceAgents(workspaceSlug);

        if (agents.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: 'No agents found in this workspace.\n\nUse `agent_create` to create a new agent.',
            }],
            isError: false,
          };
        }

        const agentList = agents.map(a => {
          const sourceInfo = a.config.source?.type === 'craft'
            ? ` (from Craft: ${a.config.source.documentId})`
            : a.config.source?.type === 'local'
            ? ' (local)'
            : '';
          return `- **${a.config.name}** (\`${a.config.slug}\`)${a.config.enabled ? '' : ' [disabled]'}${sourceInfo}`;
        }).join('\n');

        return {
          content: [{
            type: 'text' as const,
            text: `**Agents in workspace (${agents.length}):**\n\n${agentList}`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[agent_list] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error listing agents: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create a new agent in the workspace.
 */
export function createAgentCreateTool(sessionId: string, workspaceSlug: string) {
  return tool(
    'agent_create',
    `Create a new agent in the workspace.

An agent is a specialized configuration with custom instructions. After creation:
- The agent appears in the agent list
- Users can activate it to use its specialized capabilities
- The agent can have sources attached for MCP servers and APIs

**Example:**
\`\`\`
agent_create({
  name: "Research Assistant",
  instructions: "You are a research assistant that helps with deep research tasks...",
  useSources: ["exa-search", "web-archive"]
})
\`\`\``,
    {
      name: z.string().describe('Display name for the agent'),
      instructions: z.string().describe('Agent instructions (markdown). Describe what the agent does and how it should behave.'),
      useSources: z.array(z.string()).optional().describe('List of workspace source slugs to attach to this agent'),
      enabled: z.boolean().optional().describe('Whether agent is enabled (default: true)'),
    },
    async (args) => {
      debug('[agent_create] Creating agent:', args.name);

      try {
        const { createAgent } = await import('../agents/folder-storage.ts');

        const config = createAgent(workspaceSlug, {
          name: args.name,
          instructions: args.instructions,
          useSources: args.useSources,
          enabled: args.enabled ?? true,
        });

        // Trigger agents reload callback
        const callbacks = getSessionScopedToolCallbacks(sessionId);
        try {
          await callbacks?.onAgentsChanged?.();
        } catch (err) {
          console.log('[agent_create] onAgentsChanged callback error:', err);
        }

        const sourcesNote = args.useSources?.length
          ? `\nAttached sources: ${args.useSources.join(', ')}`
          : '';

        return {
          content: [{
            type: 'text' as const,
            text: `**Agent created successfully**\n\nName: ${config.name}\nSlug: ${config.slug}\nEnabled: ${config.enabled}${sourcesNote}`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[agent_create] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error creating agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Delete an agent from the workspace.
 */
export function createAgentDeleteTool(sessionId: string, workspaceSlug: string) {
  return tool(
    'agent_delete',
    `Delete an agent from the workspace.

**Warning:** This permanently removes the agent and any agent-scoped sources.`,
    {
      agentSlug: z.string().describe('The slug of the agent to delete'),
    },
    async (args) => {
      debug('[agent_delete] Deleting agent:', args.agentSlug);

      try {
        const { deleteAgent, agentExists } = await import('../agents/folder-storage.ts');

        if (!agentExists(workspaceSlug, args.agentSlug)) {
          return {
            content: [{
              type: 'text' as const,
              text: `Agent '${args.agentSlug}' not found.`,
            }],
            isError: true,
          };
        }

        deleteAgent(workspaceSlug, args.agentSlug);

        // Trigger agents reload callback
        const callbacks = getSessionScopedToolCallbacks(sessionId);
        try {
          await callbacks?.onAgentsChanged?.();
        } catch (err) {
          console.log('[agent_delete] onAgentsChanged callback error:', err);
        }

        return {
          content: [{
            type: 'text' as const,
            text: `**Agent '${args.agentSlug}' deleted successfully**`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[agent_delete] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error deleting agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
 * @param activeAgentSlug - Optional active agent slug (sources default to agent scope when set)
 */
export function getSessionScopedTools(sessionId: string, workspaceSlug: string, activeAgentSlug?: string): ReturnType<typeof createSdkMcpServer> {
  // Include workspaceSlug and activeAgentSlug in cache key
  // When agent changes, we need fresh tools with the new context
  const cacheKey = `${sessionId}::${workspaceSlug}::${activeAgentSlug ?? ''}`;
  let cached = sessionScopedToolsCache.get(cacheKey);
  if (!cached) {
    // Create session-scoped tools that capture the sessionId, workspaceSlug, and activeAgentSlug in their closures
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
        // Source tools (agent-aware: checks agent folder first, then workspace)
        createSourceTestTool(sessionId, workspaceSlug, activeAgentSlug),
        createOAuthTriggerTool(sessionId, workspaceSlug, activeAgentSlug),
        createGmailOAuthTriggerTool(sessionId, workspaceSlug, activeAgentSlug),
        createCredentialPromptTool(sessionId, workspaceSlug, activeAgentSlug),
        createSourceCacheUpdateTool(sessionId, workspaceSlug),
        createSourceCacheReadTool(sessionId, workspaceSlug),
        createSourceGuideAppendTool(sessionId, workspaceSlug),
        // Source CRUD tools
        createSourceListTool(sessionId, workspaceSlug),
        createSourceCreateTool(sessionId, workspaceSlug, activeAgentSlug),
        createSourceUpdateTool(sessionId, workspaceSlug, activeAgentSlug),
        createSourceDeleteTool(sessionId, workspaceSlug),
        createSourceSafeModeUpdateTool(sessionId, workspaceSlug, activeAgentSlug),
        // Agent tools
        createAgentListTool(sessionId, workspaceSlug),
        createAgentCreateTool(sessionId, workspaceSlug),
        createAgentDeleteTool(sessionId, workspaceSlug),
      ],
    });
    sessionScopedToolsCache.set(cacheKey, cached);
    debug(`[SessionScopedTools] Created tools provider for session ${sessionId} in workspace ${workspaceSlug}${activeAgentSlug ? ` with agent ${activeAgentSlug}` : ''}`);
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
