/**
 * Session-Scoped Tools
 *
 * Tools that are scoped to a specific session. Each session gets its own
 * instance of these tools with session-specific callbacks and state.
 *
 * Tools included:
 * - SubmitPlan: Submit a plan file for user review/display
 * - change_working_directory: Change the working directory for the session
 * - config_validate: Validate configuration files
 * - source_test: Validate schema, download icons, test connections
 * - source_oauth_trigger: Start OAuth authentication for MCP sources
 * - source_google_oauth_trigger: Start Google OAuth authentication (Gmail, Calendar, Drive)
 * - source_credential_prompt: Prompt user for API credentials
 * - agent_list, agent_create, agent_delete: Agent management
 *
 * Source/agent CRUD is done via standard file editing tools (Read/Write/Edit).
 * See ~/.craft-agent/docs/ for config format documentation.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { existsSync, readFileSync, statSync } from 'fs';
import { basename } from 'path';
import { getSessionPlansPath } from '../sessions/storage.ts';
import { debug } from '../utils/debug.ts';
import { getCredentialManager } from '../credentials/index.ts';
import {
  validateConfig,
  validateSource,
  validateAllSources,
  validatePreferences,
  validateAll,
  formatValidationResult,
} from '../config/validators.ts';
import { PERMISSION_MODE_CONFIG } from './mode-types.ts';
import {
  validateMcpConnection,
  validateStdioMcpConnection,
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
  sourceExists,
  loadSourceConfigWithFallback,
  saveSourceConfigWithContext,
  type SourceWithContext,
} from '../sources/storage.ts';
import type { FolderSourceConfig, LoadedSource } from '../sources/types.ts';
import { getSourceCredentialManager, getSourceServerBuilder, type SourceWithCredential } from '../sources/index.ts';
import { CraftOAuth, getMcpBaseUrl, type OAuthConfig, type OAuthCallbacks } from '../auth/oauth.ts';
import {
  startGoogleOAuth,
  type GoogleOAuthOptions,
  type GoogleOAuthResult,
} from '../auth/google-oauth.ts';
import { inferGoogleServiceFromUrl, type GoogleService } from '../sources/types.ts';
import { DOC_REFS } from '../docs/index.ts';

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
  const exploreName = PERMISSION_MODE_CONFIG['safe'].displayName;

  return tool(
    'SubmitPlan',
    `Submit a plan for user review.

Call this after you have written your plan to a markdown file using the Write tool.
The plan will be displayed to the user in a special formatted view.

This tool can be used anytime - it's not restricted to any particular mode.
Use it whenever you want to present a structured plan to the user.

**${exploreName} Mode Workflow:** When you are in ${exploreName} mode and have completed your research/exploration,
use this tool to present your implementation plan. The plan UI includes an "Accept Plan" button
that exits ${exploreName} mode and allows you to begin implementation immediately.

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
// Config Validation Tool
// ============================================================

/**
 * Create a session-scoped config_validate tool.
 * Validates configuration files and returns structured error reports.
 */
export function createConfigValidateTool(sessionId: string, workspaceId: string) {
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
              result = validateSource(workspaceId, args.sourceSlug);
            } else {
              result = validateAllSources(workspaceId);
            }
            break;
          case 'preferences':
            result = validatePreferences();
            break;
          case 'all':
            result = validateAll(workspaceId);
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
 * Test Google API source (Gmail, Calendar, Drive) by validating OAuth token exists and is not expired.
 * Google APIs use OAuth tokens that can be refreshed automatically.
 */
async function testGoogleSource(
  source: FolderSourceConfig,
  workspaceId: string
): Promise<{ success: boolean; status?: number; error?: string; credentialType?: string }> {
  const credManager = getSourceCredentialManager();
  const wsId = basename(workspaceId);

  // Build LoadedSource from config for credential manager
  const loadedSource: LoadedSource = {
    config: source,
    guide: null,
    folderPath: '',
    workspaceId: wsId,
  };

  // Check if we have valid credentials using getToken (handles expiry)
  const token = await credManager.getToken(loadedSource);

  if (token) {
    // Token is valid (not expired)
    return { success: true, credentialType: 'source_oauth' };
  }

  // No valid token - check if we have a refresh token
  const cred = await credManager.load(loadedSource);
  if (cred?.refreshToken) {
    // Try to refresh the token
    const refreshed = await credManager.refresh(loadedSource);
    if (refreshed) {
      return { success: true, credentialType: 'source_oauth' };
    }
  }

  // No valid token and refresh failed or not available
  const serviceName = source.api?.googleService || 'Google';
  return {
    success: false,
    error: `${serviceName} OAuth token missing or expired. Use source_google_oauth_trigger to re-authenticate.`,
    credentialType: 'source_oauth',
  };
}

/**
 * Test an API source by making a simple HEAD/GET request.
 */
async function testApiSource(
  source: FolderSourceConfig,
  workspaceId: string
): Promise<{ success: boolean; status?: number; error?: string; credentialType?: string }> {
  // Google APIs (Gmail, Calendar, Drive) - use Google-specific test
  if (source.provider === 'google') {
    return testGoogleSource(source, workspaceId);
  }

  if (!source.api?.baseUrl) {
    return { success: false, error: 'No API URL configured' };
  }

  const requiresAuth = source.api.authType && source.api.authType !== 'none';

  // Require testEndpoint for authenticated APIs - without it we can't validate credentials
  if (requiresAuth && !source.api.testEndpoint) {
    return {
      success: false,
      error: `Authenticated API sources require a \`testEndpoint\` configuration to validate credentials. Add \`testEndpoint\` to config.json. See \`${DOC_REFS.sources}\` for format.`,
    };
  }

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    let credentialType: string | undefined;
    let credValue: string | undefined;

    // Get credentials if needed
    if (requiresAuth) {
      // Extract workspace ID from root path for credential lookups
      const wsId = basename(workspaceId);

      if (source.api.authType === 'oauth') {
        // Use SourceCredentialManager for OAuth - handles expiry checking and refresh
        const sourceCredManager = getSourceCredentialManager();
        const loadedSource: LoadedSource = {
          config: source,
          guide: null,
          folderPath: '',
          workspaceId: wsId,
        };

        // getToken() returns null if expired
        let token = await sourceCredManager.getToken(loadedSource);

        if (!token) {
          // Try refresh if token is expired/missing
          debug(`[testApiSource] OAuth token expired or missing for ${source.slug}, attempting refresh`);
          token = await sourceCredManager.refresh(loadedSource);
        }

        if (token) {
          credValue = token;
          credentialType = 'source_oauth';
          debug(`[testApiSource] Found valid OAuth token for ${source.slug}`);
        } else {
          debug(`[testApiSource] No valid OAuth token for ${source.slug}`);
        }
      } else {
        // For non-OAuth auth types, use direct credential lookup
        const credentialManager = getCredentialManager();

        let credType: 'source_bearer' | 'source_apikey' | 'source_basic';
        if (source.api.authType === 'bearer') {
          credType = 'source_bearer';
        } else if (source.api.authType === 'basic') {
          credType = 'source_basic';
        } else {
          // 'header', 'query', or other → stored as apikey
          credType = 'source_apikey';
        }

        debug(`[testApiSource] Looking up credentials for source=${source.slug}, authType=${source.api.authType}, credType=${credType}`);
        const cred = await credentialManager.get({ type: credType, workspaceId: wsId, sourceId: source.slug });
        if (cred?.value) {
          credValue = cred.value;
          credentialType = credType;
          debug(`[testApiSource] Found credential for ${source.slug}`);
        } else {
          debug(`[testApiSource] No credential found for ${source.slug}`);
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

    let response: Response;

    // Use testEndpoint if configured (required for authenticated APIs, optional for public)
    if (source.api.testEndpoint) {
      const testUrl = new URL(source.api.testEndpoint.path, source.api.baseUrl).toString();
      const fetchOptions: RequestInit = {
        method: source.api.testEndpoint.method,
        headers,
      };

      // Apply custom test endpoint headers if specified
      if (source.api.testEndpoint.headers) {
        Object.assign(headers, source.api.testEndpoint.headers);
      }

      if (source.api.testEndpoint.method === 'POST' && source.api.testEndpoint.body) {
        headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(source.api.testEndpoint.body);
      }

      debug(`[testApiSource] Testing URL: ${testUrl}, method: ${fetchOptions.method}`);
      response = await fetch(testUrl, fetchOptions);
      debug(`[testApiSource] Response: ${response.status} ${response.statusText}`);
    } else {
      // Fallback for public APIs only (authType: 'none')
      response = await fetch(source.api.baseUrl, { method: 'HEAD', headers });

      // Some APIs don't support HEAD, try GET
      if (response.status === 405) {
        response = await fetch(source.api.baseUrl, { method: 'GET', headers });
      }
    }

    if (response.ok) {
      return {
        success: true,
        status: response.status,
        credentialType,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        status: response.status,
        error: `HTTP ${response.status} - Authentication failed. Check your credentials.`,
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
 * Validates config, downloads icons, and tests connections.
 */
export function createSourceTestTool(sessionId: string, workspaceId: string, activeAgentSlug?: string) {
  return tool(
    'source_test',
    `Validate and test a source configuration.

**This tool performs three checks:**
1. **Schema validation**: Validates config.json against the schema
2. **Icon caching**: Downloads and caches icon if not already local
3. **Connection test**: Tests if the source is reachable

**Supports:**
- **MCP sources**: Validates server URL, authentication, tool availability
- **API sources**: Tests endpoint reachability and authentication
- **Local sources**: Validates path exists

**Usage:**
After creating or editing a source's config.json, run this tool to:
- Catch config errors before they cause issues
- Auto-download icons from service URLs
- Verify the connection works

**Reference:** See \`${DOC_REFS.sources}\` for config format.

**Returns:**
- Validation status with specific errors if invalid
- Icon status (cached, downloaded, or failed)
- Connection status with server info (MCP) or HTTP status (API)`,
    {
      sourceSlug: z.string().describe('The slug of the source to test'),
    },
    async (args) => {
      debug('[source_test] Testing source:', args.sourceSlug);

      try {
        // Load the source config (checks agent folder first if activeAgentSlug set, then workspace)
        const sourceResult = loadSourceConfigWithFallback(workspaceId, args.sourceSlug, activeAgentSlug);
        if (!sourceResult) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found.\n\nCreate the source folder at:\n\`~/.craft-agent/workspaces/{workspace}/sources/${args.sourceSlug}/config.json\`\n\nSee \`${DOC_REFS.sources}\` for config format.`,
            }],
            isError: true,
          };
        }
        const source = sourceResult.config;
        const sourceContext = { isAgentScoped: sourceResult.isAgentScoped, agentSlug: sourceResult.agentSlug };

        const results: string[] = [];
        let hasErrors = false;

        // ============================================================
        // Step 1: Schema Validation
        // ============================================================
        const validationResult = validateSource(workspaceId, args.sourceSlug);
        if (!validationResult.valid) {
          hasErrors = true;
          results.push('**❌ Schema Validation Failed**\n');
          for (const error of validationResult.errors) {
            results.push(`- \`${error.path}\`: ${error.message}`);
            if (error.suggestion) {
              results.push(`  → ${error.suggestion}`);
            }
          }
          results.push('');
          results.push(`See \`${DOC_REFS.sources}\` for config format.`);

          return {
            content: [{
              type: 'text' as const,
              text: results.join('\n'),
            }],
            isError: true,
          };
        }
        results.push('**✓ Schema Valid**');

        // ============================================================
        // Step 2: Icon Handling
        // ============================================================
        const { getSourcePath, getAgentSourcePath } = await import('../sources/storage.ts');
        const sourcePath = sourceContext.isAgentScoped && sourceContext.agentSlug
          ? getAgentSourcePath(workspaceId, sourceContext.agentSlug, args.sourceSlug)
          : getSourcePath(workspaceId, args.sourceSlug);

        // Check if icon needs to be downloaded
        if (source.iconUrl && !source.iconUrl.startsWith('./')) {
          // Remote URL - try to download and cache
          const { cacheIcon } = await import('../utils/logo.ts');
          const cached = await cacheIcon(source.iconUrl, sourcePath);
          if (cached) {
            source.iconSourceUrl = source.iconUrl;
            source.iconUrl = cached;
            saveSourceConfigWithContext(workspaceId, source, sourceContext);
            results.push(`**✓ Icon Downloaded** (${cached})`);
          } else {
            // Download failed - clear invalid URL so we can try auto-fetch
            source.iconUrl = undefined;
            saveSourceConfigWithContext(workspaceId, source, sourceContext);
          }
        }

        // Auto-fetch icon if not set
        if (!source.iconUrl) {
          // No icon - try to auto-fetch from service URL or provider domain
          let serviceUrl = source.type === 'api' ? source.api?.baseUrl :
                          source.type === 'mcp' ? source.mcp?.url : null;

          // For stdio sources (no URL), try provider name as domain
          if (!serviceUrl && source.provider) {
            serviceUrl = `https://${source.provider}.com`;
          }

          if (serviceUrl) {
            const { getHighQualityLogoUrl, cacheIcon } = await import('../utils/logo.ts');
            const logoUrl = await getHighQualityLogoUrl(serviceUrl, source.provider);
            if (logoUrl) {
              const cached = await cacheIcon(logoUrl, sourcePath);
              if (cached) {
                source.iconUrl = cached;
                source.iconSourceUrl = logoUrl;
                saveSourceConfigWithContext(workspaceId, source, sourceContext);
                results.push(`**✓ Icon Auto-fetched** (${cached})`);
              } else {
                results.push('**○ No Icon** (auto-fetch failed)');
              }
            } else {
              results.push('**○ No Icon** (no favicon found)');
            }
          } else {
            results.push('**○ No Icon**');
          }
        } else {
          // iconUrl starts with './' - verify the file actually exists
          const { existsSync } = await import('fs');
          const { join } = await import('path');
          const iconPath = join(sourcePath, source.iconUrl.slice(2)); // Remove './' prefix

          if (existsSync(iconPath)) {
            results.push(`**✓ Icon Cached** (${source.iconUrl})`);
          } else {
            // File missing - try to re-download from original source
            if (source.iconSourceUrl) {
              const { cacheIcon } = await import('../utils/logo.ts');
              const cached = await cacheIcon(source.iconSourceUrl, sourcePath);
              if (cached) {
                source.iconUrl = cached;
                saveSourceConfigWithContext(workspaceId, source, sourceContext);
                results.push(`**✓ Icon Re-downloaded** (${cached})`);
              } else {
                // Clear invalid iconUrl since file doesn't exist
                source.iconUrl = undefined;
                saveSourceConfigWithContext(workspaceId, source, sourceContext);
                results.push('**⚠ Icon Missing** - re-download failed, cleared config');
              }
            } else {
              // No source URL to re-download from
              source.iconUrl = undefined;
              saveSourceConfigWithContext(workspaceId, source, sourceContext);
              results.push('**⚠ Icon Missing** - file not found, cleared config');
            }
          }
        }

        // ============================================================
        // Step 3: Connection Test
        // ============================================================
        results.push('');

        // Handle API sources
        if (source.type === 'api') {
          const result = await testApiSource(source, workspaceId);

          // Update the source's status and timestamp
          source.lastTestedAt = Date.now();
          if (result.success) {
            source.connectionStatus = 'connected';
            source.connectionError = undefined;
          } else {
            source.connectionStatus = 'failed';
            source.connectionError = result.error;
          }
          saveSourceConfigWithContext(workspaceId, source, sourceContext);

          if (result.success) {
            results.push(`**✓ API Connected** (${result.status})`);
            results.push(`  URL: ${source.api?.baseUrl}`);

            if (result.credentialType) {
              results.push(`  Credential: ${result.credentialType}`);
            }

            // Verify the source has valid credentials for session use
            // Note: workspaceId for LoadedSource should be just the ID, not the full path
            const wsId = basename(workspaceId);
            const loadedSource: LoadedSource = {
              config: source,
              guide: null,
              folderPath: sourcePath,
              workspaceId: wsId,
              agentSlug: sourceContext.agentSlug,
            };
            const credManager = getSourceCredentialManager();
            const hasCredentials = await credManager.hasValidCredentials(loadedSource);

            if (!hasCredentials && source.api?.authType !== 'none') {
              results.push('');
              results.push('**⚠ Credentials Missing**');
              results.push(`Auth type: ${source.api?.authType}`);
              results.push('Use `source_credential_prompt` to add credentials.');
            }
          } else {
            hasErrors = true;
            results.push(`**❌ API Connection Failed**`);
            results.push(`  URL: ${source.api?.baseUrl}`);
            results.push(`  Error: ${result.error}`);
          }
        }

        // Handle local sources
        else if (source.type === 'local') {
          const localPath = source.local?.path;
          if (localPath && existsSync(localPath)) {
            source.lastTestedAt = Date.now();
            source.connectionStatus = 'connected';
            source.connectionError = undefined;
            saveSourceConfigWithContext(workspaceId, source, sourceContext);
            results.push(`**✓ Local Path Exists** (${localPath})`);
          } else {
            hasErrors = true;
            source.connectionStatus = 'failed';
            source.connectionError = 'Path not found';
            saveSourceConfigWithContext(workspaceId, source, sourceContext);
            results.push(`**❌ Local Path Not Found** (${localPath || 'not configured'})`);
          }
        }

        // Handle MCP sources
        else if (source.type === 'mcp') {
          // Handle stdio transport (local MCP servers)
          if (source.mcp?.transport === 'stdio') {
            if (!source.mcp.command) {
              hasErrors = true;
              results.push('**❌ No command configured for stdio MCP source**');
            } else {
              // Actually spawn and test the stdio MCP server
              results.push(`Testing stdio server: ${source.mcp.command} ${(source.mcp.args || []).join(' ')}`);
              results.push('');

              const stdioResult = await validateStdioMcpConnection({
                command: source.mcp.command,
                args: source.mcp.args,
                env: source.mcp.env,
                timeout: 30000, // 30 second timeout for spawn + connect
              });

              source.lastTestedAt = Date.now();

              if (stdioResult.success) {
                source.connectionStatus = 'connected';
                source.connectionError = undefined;
                source.isAuthenticated = true; // Stdio sources don't need auth
                saveSourceConfigWithContext(workspaceId, source, sourceContext);

                results.push('**✓ Stdio MCP Server Connected**');
                results.push(`  Command: ${source.mcp.command}`);
                if (source.mcp.args?.length) {
                  results.push(`  Args: ${source.mcp.args.join(' ')}`);
                }
                if (stdioResult.tools && stdioResult.tools.length > 0) {
                  results.push(`  Tools: ${stdioResult.tools.length} available`);
                  // Show first few tool names
                  const toolPreview = stdioResult.tools.slice(0, 5).join(', ');
                  const more = stdioResult.tools.length > 5 ? `, +${stdioResult.tools.length - 5} more` : '';
                  results.push(`  Available: ${toolPreview}${more}`);
                }
              } else {
                hasErrors = true;
                source.connectionStatus = 'failed';
                source.connectionError = stdioResult.error || 'Unknown error';
                saveSourceConfigWithContext(workspaceId, source, sourceContext);

                results.push('**❌ Stdio MCP Server Failed**');
                results.push(`  Command: ${source.mcp.command}`);
                results.push(`  Error: ${stdioResult.error}`);

                // Show schema validation errors if present
                if (stdioResult.errorType === 'invalid-schema' && stdioResult.invalidProperties) {
                  results.push('  Invalid tool properties:');
                  for (const prop of stdioResult.invalidProperties.slice(0, 5)) {
                    results.push(`    - ${prop.toolName}: ${prop.propertyPath}`);
                  }
                  if (stdioResult.invalidProperties.length > 5) {
                    results.push(`    ... and ${stdioResult.invalidProperties.length - 5} more`);
                  }
                }
              }
            }
          }
          // Handle HTTP/SSE transport (remote MCP servers)
          else if (!source.mcp?.url) {
            hasErrors = true;
            results.push('**❌ No MCP URL configured**');
          } else {
            // Get MCP access token if the source is authenticated
            let mcpAccessToken: string | undefined;
            if (source.isAuthenticated && source.mcp.authType !== 'none') {
              const credentialManager = getCredentialManager();
              // Extract workspace ID from root path for credential lookups
              const wsId = basename(workspaceId);
              // Try OAuth first, then bearer
              const oauthCred = await credentialManager.get({
                type: 'source_oauth',
                workspaceId: wsId,
                sourceId: args.sourceSlug,
              });
              if (oauthCred?.value) {
                mcpAccessToken = oauthCred.value;
              } else {
                const bearerCred = await credentialManager.get({
                  type: 'source_bearer',
                  workspaceId: wsId,
                  sourceId: args.sourceSlug,
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
              hasErrors = true;
              results.push('**❌ Cannot Test MCP**: No Claude API key or OAuth token configured.');
            } else {
              // Run the validation
              const mcpResult = await validateMcpConnection({
                mcpUrl: source.mcp.url,
                mcpAccessToken,
                claudeApiKey: claudeApiKey ?? undefined,
                claudeOAuthToken: claudeOAuthToken ?? undefined,
              });

              // Update the source's status and timestamp
              source.lastTestedAt = Date.now();
              if (mcpResult.success) {
                source.connectionStatus = 'connected';
                source.connectionError = undefined;
                saveSourceConfigWithContext(workspaceId, source, sourceContext);

                results.push('**✓ MCP Connected**');
                if (mcpResult.serverInfo) {
                  results.push(`  Server: ${mcpResult.serverInfo.name} v${mcpResult.serverInfo.version}`);
                }
                if (mcpResult.tools && mcpResult.tools.length > 0) {
                  results.push(`  Tools: ${mcpResult.tools.length} available`);
                }

                // Verify credentials
                const loadedSource: LoadedSource = {
                  config: source,
                  guide: null,
                  folderPath: sourcePath,
                  workspaceId,
                  agentSlug: sourceContext.agentSlug,
                };
                const credManager = getSourceCredentialManager();
                const hasCredentials = await credManager.hasValidCredentials(loadedSource);

                if (!hasCredentials && source.mcp?.authType !== 'none') {
                  results.push('');
                  results.push('**⚠ Credentials Missing**');
                  results.push('Use `source_oauth_trigger` to authenticate.');
                }
              } else if (mcpResult.errorType === 'needs-auth') {
                source.connectionStatus = 'needs_auth';
                saveSourceConfigWithContext(workspaceId, source, sourceContext);
                results.push('**⚠ MCP Needs Authentication**');
                results.push('Use `source_oauth_trigger` to authenticate.');
              } else {
                hasErrors = true;
                source.connectionStatus = 'failed';
                source.connectionError = getValidationErrorMessage(mcpResult);
                saveSourceConfigWithContext(workspaceId, source, sourceContext);
                results.push(`**❌ MCP Connection Failed**`);
                results.push(`  Error: ${getValidationErrorMessage(mcpResult)}`);

                if (mcpResult.errorType === 'invalid-schema' && mcpResult.invalidProperties) {
                  results.push('  Invalid tool properties:');
                  for (const prop of mcpResult.invalidProperties.slice(0, 5)) {
                    results.push(`    - ${prop.toolName}: ${prop.propertyPath}`);
                  }
                }
              }
            }
          }
        } else {
          hasErrors = true;
          results.push(`**❌ Unknown source type**: '${source.type}'`);
        }

        // Add summary
        results.push('');
        if (!hasErrors) {
          results.push(`**Source '${source.name}' is ready.**`);
        }

        return {
          content: [{
            type: 'text' as const,
            text: results.join('\n'),
          }],
          isError: hasErrors,
        };
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
 * Create a session-scoped source_oauth_trigger tool.
 * Initiates OAuth authentication for an MCP source.
 */
export function createOAuthTriggerTool(sessionId: string, workspaceId: string, activeAgentSlug?: string) {
  return tool(
    'source_oauth_trigger',
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
      debug('[source_oauth_trigger] Starting OAuth for source:', args.sourceSlug);

      try {
        // Load the source config (checks agent folder first if activeAgentSlug set, then workspace)
        const sourceResult = loadSourceConfigWithFallback(workspaceId, args.sourceSlug, activeAgentSlug);
        if (!sourceResult) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check ~/.craft-agent/workspaces/{workspace}/sources/ for available sources.`,
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
            debug('[source_oauth_trigger] Status:', message);
          },
          onError: (error: string) => {
            debug('[source_oauth_trigger] Error:', error);
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
        // Extract workspace ID from root path for credential storage
        const wsId = basename(workspaceId);
        await credentialManager.set(
          {
            type: 'source_oauth',
            workspaceId: wsId,
            sourceId: args.sourceSlug,
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
        saveSourceConfigWithContext(workspaceId, source, sourceContext);

        // Notify success callback
        callbacks?.onOAuthSuccess?.(args.sourceSlug);

        // Source reload is now handled by ConfigWatcher detecting the config.json change

        return {
          content: [{
            type: 'text' as const,
            text: `**Source '${args.sourceSlug}' authenticated successfully**\n\nOAuth tokens have been stored securely. You can now use source_test to verify it's working.`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[source_oauth_trigger] Error:', error);

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
 * Create a session-scoped source_google_oauth_trigger tool.
 * Initiates Google OAuth authentication for any Google API source (Gmail, Calendar, Drive, etc.).
 */
export function createGoogleOAuthTriggerTool(sessionId: string, workspaceId: string, activeAgentSlug?: string) {
  return tool(
    'source_google_oauth_trigger',
    `Trigger Google OAuth authentication flow for any Google API source.

Opens a browser window for the user to sign in with their Google account and authorize access to the specified Google service.
After successful authentication, the tokens are stored and the source is marked as authenticated.

**Supported services:**
- Gmail: Read, compose, and manage emails
- Calendar: Read and manage calendar events
- Drive: Read and manage Google Drive files

**Prerequisites:**
- The source must have provider 'google'
- Google OAuth must be configured in the build

**Returns:**
- Success message with the authenticated email address
- Error message if OAuth flow fails or is not configured`,
    {
      sourceSlug: z.string().describe('The slug of the Google API source to authenticate'),
    },
    async (args) => {
      try {
        // Load the source config (checks agent folder first if activeAgentSlug set, then workspace)
        const sourceResult = loadSourceConfigWithFallback(workspaceId, args.sourceSlug, activeAgentSlug);
        if (!sourceResult) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check ~/.craft-agent/workspaces/{workspace}/sources/ for available sources.`,
            }],
            isError: true,
          };
        }
        const source = sourceResult.config;
        const sourceContext = { isAgentScoped: sourceResult.isAgentScoped, agentSlug: sourceResult.agentSlug };

        // Verify this is a Google source
        if (source.provider !== 'google') {
          const hint = !source.provider
            ? `Add "provider": "google" to config.json and retry.`
            : `This source has provider '${source.provider}'. Use source_oauth_trigger for MCP sources.`;
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is not configured as a Google API source. ${hint}\n\nCurrent config: ${JSON.stringify(source, null, 2)}`,
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

        // Determine service/scopes from config
        let service: GoogleService | undefined;
        let scopes: string[] | undefined;
        const api = source.api;

        if (api?.googleScopes && api.googleScopes.length > 0) {
          // Custom scopes take precedence
          scopes = api.googleScopes;
        } else if (api?.googleService) {
          // Use predefined service scopes
          service = api.googleService;
        } else {
          // Infer from baseUrl
          service = inferGoogleServiceFromUrl(api?.baseUrl);
          if (!service) {
            return {
              content: [{
                type: 'text' as const,
                text: `Cannot determine Google service for source '${args.sourceSlug}'. Set googleService ('gmail', 'calendar', or 'drive') in api config, or use a recognizable baseUrl like 'https://gmail.googleapis.com'.`,
              }],
              isError: true,
            };
          }
        }

        const serviceName = service || 'Google API';

        // Run the Google OAuth flow
        const options: GoogleOAuthOptions = {
          service,
          scopes,
          appType: 'electron',
        };
        const result: GoogleOAuthResult = await startGoogleOAuth(options);

        if (!result.success) {
          const callbacks = getSessionScopedToolCallbacks(sessionId);
          callbacks?.onOAuthError?.(args.sourceSlug, result.error || 'Unknown error');

          return {
            content: [{
              type: 'text' as const,
              text: `${serviceName} OAuth failed: ${result.error || 'Unknown error'}`,
            }],
            isError: true,
          };
        }

        // Store the tokens
        const credentialManager = getCredentialManager();
        // Extract workspace ID from root path for credential storage
        const wsId = basename(workspaceId);
        await credentialManager.set(
          {
            type: 'source_oauth',
            workspaceId: wsId,
            sourceId: args.sourceSlug,
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
        saveSourceConfigWithContext(workspaceId, source, sourceContext);

        // Notify success callback
        const callbacks = getSessionScopedToolCallbacks(sessionId);
        callbacks?.onOAuthSuccess?.(args.sourceSlug);

        // Source reload is now handled by ConfigWatcher detecting the config.json change

        return {
          content: [{
            type: 'text' as const,
            text: `**${serviceName} source '${args.sourceSlug}' authenticated successfully**\n\nConnected as: ${result.email}\n\nYou can now use the api_${args.sourceSlug} tool to access this Google API.`,
          }],
          isError: false,
        };
      } catch (error) {
        const callbacks = getSessionScopedToolCallbacks(sessionId);
        callbacks?.onOAuthError?.(args.sourceSlug, error instanceof Error ? error.message : 'Unknown error');

        return {
          content: [{
            type: 'text' as const,
            text: `Google OAuth failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * @deprecated Use createGoogleOAuthTriggerTool instead.
 * Kept for backwards compatibility - delegates to createGoogleOAuthTriggerTool.
 */
export function createGmailOAuthTriggerTool(sessionId: string, workspaceId: string, activeAgentSlug?: string) {
  return createGoogleOAuthTriggerTool(sessionId, workspaceId, activeAgentSlug);
}

// ============================================================
// Credential Prompt Tool
// ============================================================

/**
 * Create a session-scoped source_credential_prompt tool.
 * Prompts the user to enter credentials for a source via the secure input UI.
 */
export function createCredentialPromptTool(sessionId: string, workspaceId: string, activeAgentSlug?: string) {
  return tool(
    'source_credential_prompt',
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
source_credential_prompt({
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
      debug('[source_credential_prompt] Prompting for credentials:', args.sourceSlug, args.mode);

      try {
        // Load source to get name and validate (checks agent folder first if activeAgentSlug set, then workspace)
        const sourceResult = loadSourceConfigWithFallback(workspaceId, args.sourceSlug, activeAgentSlug);
        if (!sourceResult) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check ~/.craft-agent/workspaces/{workspace}/sources/ for available sources.`,
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
        // Extract workspace ID from root path for credential storage
        const wsId = basename(workspaceId);

        if (args.mode === 'basic') {
          // Encode basic auth as base64 (username:password)
          const encoded = Buffer.from(`${response.username}:${response.password}`).toString('base64');
          await credManager.set(
            { type: 'source_basic', workspaceId: wsId, sourceId: args.sourceSlug },
            { value: encoded }
          );
        } else if (args.mode === 'bearer') {
          await credManager.set(
            { type: 'source_bearer', workspaceId: wsId, sourceId: args.sourceSlug },
            { value: response.value! }
          );
        } else {
          // header or query - stored as API key
          await credManager.set(
            { type: 'source_apikey', workspaceId: wsId, sourceId: args.sourceSlug },
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
        saveSourceConfigWithContext(workspaceId, source, sourceContext);

        // Source reload is now handled by ConfigWatcher detecting the config.json change

        return {
          content: [{
            type: 'text' as const,
            text: `Credentials saved for '${source.name}'. The source is now authenticated.`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[source_credential_prompt] Error:', error);
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
export function createAgentListTool(sessionId: string, workspaceId: string) {
  return tool(
    'agent_list',
    `List all agents in the workspace.

Returns a list of all agents with their name, slug, enabled status, and source info.
Use this to discover what agents are available before creating new ones.`,
    {},
    async () => {
      debug('[agent_list] Listing agents in workspace:', workspaceId);

      try {
        const { loadWorkspaceAgents } = await import('../agents/folder-storage.ts');
        const agents = loadWorkspaceAgents(workspaceId);

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
          const sourceInfo = a.config.source?.type === 'url'
            ? ` (from URL: ${a.config.source.url})`
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
export function createAgentCreateTool(sessionId: string, workspaceId: string) {
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

        const config = createAgent(workspaceId, {
          name: args.name,
          instructions: args.instructions,
          useSources: args.useSources,
          enabled: args.enabled ?? true,
        });

        // Agent reload is now handled by ConfigWatcher detecting the config.json change

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
export function createAgentDeleteTool(sessionId: string, workspaceId: string) {
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

        if (!agentExists(workspaceId, args.agentSlug)) {
          return {
            content: [{
              type: 'text' as const,
              text: `Agent '${args.agentSlug}' not found.`,
            }],
            isError: true,
          };
        }

        deleteAgent(workspaceId, args.agentSlug);

        // Agent reload is now handled by ConfigWatcher detecting the folder deletion

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
 * @param workspaceId - Workspace slug for source-scoped operations
 * @param activeAgentSlug - Optional active agent slug (sources default to agent scope when set)
 */
export function getSessionScopedTools(sessionId: string, workspaceId: string, activeAgentSlug?: string): ReturnType<typeof createSdkMcpServer> {
  // Include workspaceId and activeAgentSlug in cache key
  // When agent changes, we need fresh tools with the new context
  const cacheKey = `${sessionId}::${workspaceId}::${activeAgentSlug ?? ''}`;
  let cached = sessionScopedToolsCache.get(cacheKey);
  if (!cached) {
    // Create session-scoped tools that capture the sessionId, workspaceId, and activeAgentSlug in their closures
    // Note: Source/agent CRUD is done via standard file editing tools (Read/Write/Edit).
    // See ~/.craft-agent/docs/ for config format documentation.
    cached = createSdkMcpServer({
      name: 'session',
      version: '1.0.0',
      tools: [
        createSubmitPlanTool(sessionId),
        createChangeWorkingDirectoryTool(sessionId),
        // Config validation tool
        createConfigValidateTool(sessionId, workspaceId),
        // Source tools: test + auth only (CRUD via file editing)
        createSourceTestTool(sessionId, workspaceId, activeAgentSlug),
        createOAuthTriggerTool(sessionId, workspaceId, activeAgentSlug),
        createGoogleOAuthTriggerTool(sessionId, workspaceId, activeAgentSlug),
        createCredentialPromptTool(sessionId, workspaceId, activeAgentSlug),
        // Agent tools
        createAgentListTool(sessionId, workspaceId),
        createAgentCreateTool(sessionId, workspaceId),
        createAgentDeleteTool(sessionId, workspaceId),
      ],
    });
    sessionScopedToolsCache.set(cacheKey, cached);
    debug(`[SessionScopedTools] Created tools provider for session ${sessionId} in workspace ${workspaceId}${activeAgentSlug ? ` with agent ${activeAgentSlug}` : ''}`);
  }
  return cached;
}

/**
 * Clean up session-scoped tools when a session is disposed.
 * Removes the cached provider and clears all session state.
 *
 * @param sessionId - Unique session identifier
 * @param workspaceId - Optional workspace slug; if provided, only cleans up that specific workspace's cache
 */
export function cleanupSessionScopedTools(sessionId: string, workspaceId?: string): void {
  if (workspaceId) {
    // Clean up specific workspace cache
    const cacheKey = `${sessionId}::${workspaceId}`;
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
export function getSessionPlansDir(workspaceId: string, sessionId: string): string {
  return getSessionPlansPath(workspaceId, sessionId);
}

/**
 * Check if a file path is within the plans directory
 */
export function isPathInPlansDir(filePath: string, workspaceId: string, sessionId: string): boolean {
  const plansDir = getSessionPlansPath(workspaceId, sessionId);
  // Normalize paths for comparison
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPlansDir = plansDir.replace(/\\/g, '/');
  return normalizedPath.startsWith(normalizedPlansDir);
}
