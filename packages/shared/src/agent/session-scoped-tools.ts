/**
 * Session-Scoped Tools
 *
 * Tools that are scoped to a specific session. Each session gets its own
 * instance of these tools with session-specific callbacks and state.
 *
 * Tools included:
 * - SubmitPlan: Submit a plan file for user review/display
 * - config_validate: Validate configuration files
 * - skill_validate: Validate skill SKILL.md files
 * - source_test: Validate schema, download icons, test connections
 * - source_oauth_trigger: Start OAuth authentication for MCP sources
 * - source_google_oauth_trigger: Start Google OAuth authentication (Gmail, Calendar, Drive)
 * - source_credential_prompt: Prompt user for API credentials
 *
 * Source and Skill CRUD is done via standard file editing tools (Read/Write/Edit).
 * See ~/.craft-agent/docs/ for config format documentation.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { existsSync, readFileSync, statSync } from 'fs';
import { basename, join } from 'path';
import { getSessionPlansPath } from '../sessions/storage.ts';
import { debug } from '../utils/debug.ts';
import { getCredentialManager } from '../credentials/index.ts';
import {
  validateConfig,
  validateSource,
  validateAllSources,
  validateStatuses,
  validatePreferences,
  validateAll,
  validateSkill,
  validateAllSkills,
  validateWorkspacePermissions,
  validateSourcePermissions,
  validateAllPermissions,
  formatValidationResult,
} from '../config/validators.ts';
import { PERMISSION_MODE_CONFIG } from './mode-types.ts';
import {
  validateMcpConnection,
  validateStdioMcpConnection,
  getValidationErrorMessage,
} from '../mcp/validation.ts';
import {
  getAnthropicApiKey,
  getClaudeOAuthToken,
} from '../config/storage.ts';
import {
  loadSourceConfig,
  saveSourceConfig,
  getSourcePath,
} from '../sources/storage.ts';
import type { FolderSourceConfig, LoadedSource } from '../sources/types.ts';
import { getSourceCredentialManager } from '../sources/index.ts';
import { inferGoogleServiceFromUrl, inferSlackServiceFromUrl, inferMicrosoftServiceFromUrl, isApiOAuthProvider, type GoogleService, type SlackService, type MicrosoftService } from '../sources/types.ts';
import { buildAuthorizationHeader } from '../sources/api-tools.ts';
import { DOC_REFS } from '../docs/index.ts';

// ============================================================
// Session-Scoped Tool Callbacks
// ============================================================

/**
 * Credential input modes for different auth types
 */
export type CredentialInputMode = 'bearer' | 'basic' | 'header' | 'query';

/**
 * Auth request types
 */
export type AuthRequestType =
  | 'credential'
  | 'oauth'
  | 'oauth-google'
  | 'oauth-slack'
  | 'oauth-microsoft';

/**
 * Base auth request fields
 */
interface BaseAuthRequest {
  requestId: string;
  sessionId: string;
  sourceSlug: string;
  sourceName: string;
}

/**
 * Credential auth request - prompts for API key, bearer token, etc.
 */
export interface CredentialAuthRequest extends BaseAuthRequest {
  type: 'credential';
  mode: CredentialInputMode;
  labels?: {
    credential?: string;
    username?: string;
    password?: string;
  };
  description?: string;
  hint?: string;
  headerName?: string;
  /** Source URL/domain for password manager credential matching (1Password, etc.) */
  sourceUrl?: string;
}

/**
 * MCP OAuth auth request - standard OAuth 2.0 + PKCE
 */
export interface McpOAuthAuthRequest extends BaseAuthRequest {
  type: 'oauth';
}

/**
 * Google OAuth auth request - Google-specific OAuth
 */
export interface GoogleOAuthAuthRequest extends BaseAuthRequest {
  type: 'oauth-google';
  service?: GoogleService;
}

/**
 * Slack OAuth auth request - Slack-specific OAuth
 */
export interface SlackOAuthAuthRequest extends BaseAuthRequest {
  type: 'oauth-slack';
  service?: SlackService;
}

/**
 * Microsoft OAuth auth request - Microsoft-specific OAuth
 */
export interface MicrosoftOAuthAuthRequest extends BaseAuthRequest {
  type: 'oauth-microsoft';
  service?: MicrosoftService;
}

/**
 * Union of all auth request types
 */
export type AuthRequest =
  | CredentialAuthRequest
  | McpOAuthAuthRequest
  | GoogleOAuthAuthRequest
  | SlackOAuthAuthRequest
  | MicrosoftOAuthAuthRequest;

/**
 * Auth result - sent back to agent after auth completes
 */
export interface AuthResult {
  requestId: string;
  sourceSlug: string;
  success: boolean;
  cancelled?: boolean;
  error?: string;
  // Additional info for successful auth
  email?: string;      // For Google/Microsoft OAuth
  workspace?: string;  // For Slack OAuth
}

/**
 * Callbacks for session-scoped tool operations.
 * These are registered per-session and invoked by tools.
 */
export interface SessionScopedToolCallbacks {
  /** Called when a plan is submitted - triggers plan message display in UI */
  onPlanSubmitted?: (planPath: string) => void;
  /**
   * Called when authentication is requested - triggers auth UI and forceAbort.
   * This follows the SubmitPlan pattern:
   * 1. Tool calls onAuthRequest
   * 2. Session manager creates auth-request message and calls forceAbort
   * 3. User completes auth in UI
   * 4. Auth result is sent as a "faked user message"
   * 5. Agent resumes and processes the result
   */
  onAuthRequest?: (request: AuthRequest) => void;
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

// ============================================================
// Config Validation Tool
// ============================================================

/**
 * Create a session-scoped config_validate tool.
 * Validates configuration files and returns structured error reports.
 */
export function createConfigValidateTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'config_validate',
    `Validate Craft Agent configuration files.

Use this after editing configuration files to check for errors before they take effect.
Returns structured validation results with errors, warnings, and suggestions.

**Targets:**
- \`config\`: Validates ~/.craft-agent/config.json (workspaces, model, settings)
- \`sources\`: Validates all sources in ~/.craft-agent/workspaces/{workspace}/sources/*/config.json
- \`statuses\`: Validates ~/.craft-agent/workspaces/{workspace}/statuses/config.json (workflow states)
- \`preferences\`: Validates ~/.craft-agent/preferences.json (user preferences)
- \`permissions\`: Validates permissions.json files (workspace, source, and app-level default)
- \`all\`: Validates all configuration files

**For specific source validation:** Use target='sources' with sourceSlug parameter.
**For specific source permissions:** Use target='permissions' with sourceSlug parameter.

**Example workflow:**
1. Edit a config file using Write/Edit tools
2. Call config_validate to check for errors
3. If errors found, fix them and re-validate
4. Once valid, changes take effect on next reload`,
    {
      target: z.enum(['config', 'sources', 'statuses', 'preferences', 'permissions', 'all']).describe(
        'Which config file(s) to validate'
      ),
      sourceSlug: z.string().optional().describe(
        'Validate a specific source by slug (used with target "sources" or "permissions")'
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
              result = validateSource(workspaceRootPath, args.sourceSlug);
            } else {
              result = validateAllSources(workspaceRootPath);
            }
            break;
          case 'statuses':
            result = validateStatuses(workspaceRootPath);
            break;
          case 'preferences':
            result = validatePreferences();
            break;
          case 'permissions':
            if (args.sourceSlug) {
              result = validateSourcePermissions(workspaceRootPath, args.sourceSlug);
            } else {
              result = validateAllPermissions(workspaceRootPath);
            }
            break;
          case 'all':
            result = validateAll(workspaceRootPath);
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
// Skill Validation Tool
// ============================================================

/**
 * Create a session-scoped skill_validate tool.
 * Validates skill SKILL.md files and returns structured error reports.
 */
export function createSkillValidateTool(sessionId: string, workspaceRoot: string) {
  return tool(
    'skill_validate',
    `Validate a skill's SKILL.md file.

Checks:
- Slug format (lowercase alphanumeric with hyphens)
- SKILL.md exists and is readable
- YAML frontmatter is valid with required fields (name, description)
- Content is non-empty after frontmatter
- Icon format if present (svg/png/jpg)

**Usage:** Call after creating or editing a skill to verify it's valid.

**Returns:** Validation status with specific errors and warnings.`,
    {
      skillSlug: z.string().describe('The slug of the skill to validate'),
    },
    async (args) => {
      debug('[skill_validate] Validating skill:', args.skillSlug);

      try {
        const result = validateSkill(workspaceRoot, args.skillSlug);
        const formatted = formatValidationResult(result);

        return {
          content: [{
            type: 'text' as const,
            text: formatted,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[skill_validate] Error:', error);
        return {
          content: [{
            type: 'text' as const,
            text: `Error validating skill: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
  workspaceRootPath: string
): Promise<{ success: boolean; status?: number; error?: string; credentialType?: string }> {
  const credManager = getSourceCredentialManager();
  const workspaceId = basename(workspaceRootPath);

  // Build LoadedSource from config for credential manager
  const loadedSource: LoadedSource = {
    config: source,
    guide: null,
    folderPath: '',
    workspaceRootPath,
    workspaceId,
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
  workspaceRootPath: string
): Promise<{ success: boolean; status?: number; error?: string; credentialType?: string }> {
  // Google APIs (Gmail, Calendar, Drive) - use Google-specific test
  if (source.provider === 'google') {
    return testGoogleSource(source, workspaceRootPath);
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
      const workspaceId = basename(workspaceRootPath);
      const sourceCredManager = getSourceCredentialManager();
      const loadedSource: LoadedSource = {
        config: source,
        guide: null,
        folderPath: '',
        workspaceRootPath,
        workspaceId,
      };

      if (isApiOAuthProvider(source.provider)) {
        // Use SourceCredentialManager for OAuth providers - handles expiry checking and refresh
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
        // For non-OAuth auth types, use getApiCredential which handles basic auth JSON parsing
        debug(`[testApiSource] Looking up credentials for source=${source.slug}, authType=${source.api.authType}`);
        const apiCred = await sourceCredManager.getApiCredential(loadedSource);
        if (apiCred) {
          // Determine credential type for reporting
          if (source.api.authType === 'bearer') {
            credentialType = 'source_bearer';
          } else if (source.api.authType === 'basic') {
            credentialType = 'source_basic';
          } else {
            credentialType = 'source_apikey';
          }

          // Apply credential based on authType config
          if (source.api.authType === 'bearer') {
            credValue = typeof apiCred === 'string' ? apiCred : '';
            headers['Authorization'] = buildAuthorizationHeader(source.api.authScheme, credValue);
          } else if (source.api.authType === 'header' && source.api.headerName) {
            credValue = typeof apiCred === 'string' ? apiCred : '';
            headers[source.api.headerName] = credValue;
          } else if (source.api.authType === 'basic') {
            // getApiCredential returns BasicAuthCredential {username, password} for basic auth
            if (typeof apiCred === 'object' && 'username' in apiCred && 'password' in apiCred) {
              const basicAuth = Buffer.from(`${apiCred.username}:${apiCred.password}`).toString('base64');
              headers['Authorization'] = `Basic ${basicAuth}`;
              credValue = '[basic-auth]'; // Don't expose actual credentials in logs
            }
          }
          debug(`[testApiSource] Found credential for ${source.slug}`);
        } else {
          debug(`[testApiSource] No credential found for ${source.slug}`);
        }
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
        error: `HTTP ${response.status} - Authentication failed. Check your credentials. If credentials are correct, use WebSearch to verify the API endpoint URL is current.`,
        credentialType,
      };
    }

    // 404 often indicates wrong endpoint URL - suggest web search for current endpoint
    if (response.status === 404) {
      return {
        success: false,
        status: response.status,
        error: `HTTP 404 - Endpoint not found. The URL may be incorrect or outdated. Use WebSearch to find the current API endpoint.`,
        credentialType,
      };
    }

    return {
      success: false,
      status: response.status,
      error: `HTTP ${response.status}. If unexpected, use WebSearch to verify the API URL is correct.`,
      credentialType
    };
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
export function createSourceTestTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'source_test',
    `Validate and test a source configuration.

**This tool performs four checks:**
1. **Schema validation**: Validates config.json against the schema
2. **Icon caching**: Downloads and caches icon if not already local
3. **Connection test**: Tests if the source is reachable
4. **Completeness check**: Checks for missing description and icon

**Supports:**
- **MCP sources**: Validates server URL, authentication, tool availability
- **API sources**: Tests endpoint reachability and authentication
- **Local sources**: Validates path exists

**Usage:**
After creating or editing a source's config.json, run this tool to:
- Catch config errors before they cause issues
- Auto-download icons from service URLs
- Verify the connection works

**Note:** Returns all errors and warnings at once (doesn't stop on first error).

**Reference:** See \`${DOC_REFS.sources}\` for config format.

**Returns:**
- Validation status with specific errors if invalid
- Icon status (cached, downloaded, or failed)
- Connection status with server info (MCP) or HTTP status (API)
- Completeness suggestions for missing description/icon`,
    {
      sourceSlug: z.string().describe('The slug of the source to test'),
    },
    async (args) => {
      debug('[source_test] Testing source:', args.sourceSlug);

      try {
        // Load the source config
        const source = loadSourceConfig(workspaceRootPath, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found.\n\nCreate the source folder at:\n\`~/.craft-agent/workspaces/{workspace}/sources/${args.sourceSlug}/config.json\`\n\nSee \`${DOC_REFS.sources}\` for config format.`,
            }],
            isError: true,
          };
        }
        
        const results: string[] = [];
        const warnings: string[] = [];
        let hasErrors = false;

        // ============================================================
        // Step 1: Schema Validation
        // ============================================================
        const validationResult = validateSource(workspaceRootPath, args.sourceSlug);
        // Collect schema errors but continue to show all issues at once
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
        } else {
          results.push('**✓ Schema Valid**');
        }

        // ============================================================
        // Step 2: Icon Handling
        // Uses unified icon system: local file > URL (downloaded) > emoji
        // ============================================================
        const { getSourcePath, findSourceIcon, downloadSourceIcon, isIconUrl } = await import('../sources/storage.ts');
        const sourcePath = getSourcePath(workspaceRootPath, args.sourceSlug);

        // Check for local icon file first (auto-discovered)
        const localIcon = findSourceIcon(workspaceRootPath, args.sourceSlug);
        if (localIcon) {
          results.push(`**✓ Icon Found** (${localIcon.split('/').pop()})`);
        } else if (source.icon && isIconUrl(source.icon)) {
          // URL icon - download it
          const iconPath = await downloadSourceIcon(workspaceRootPath, args.sourceSlug, source.icon);
          if (iconPath) {
            results.push(`**✓ Icon Downloaded** (${iconPath.split('/').pop()})`);
          } else {
            results.push('**⚠ Icon Download Failed**');
          }
        } else if (source.icon) {
          // Emoji icon
          results.push(`**✓ Icon** (emoji: ${source.icon})`);
        } else {
          // No icon set - try to auto-fetch from service URL
          const { deriveServiceUrl, getHighQualityLogoUrl } = await import('../utils/logo.ts');
          const { downloadIcon } = await import('../utils/icon.ts');
          const serviceUrl = deriveServiceUrl(source);

          if (serviceUrl) {
            const logoUrl = await getHighQualityLogoUrl(serviceUrl, source.slug)
              || await getHighQualityLogoUrl(serviceUrl, source.provider);
            if (logoUrl) {
              const iconPath = await downloadIcon(sourcePath, logoUrl, `source_test:${source.slug}`);
              if (iconPath) {
                // Store the URL for future reference
                source.icon = logoUrl;
                saveSourceConfig(workspaceRootPath, source);
                results.push(`**✓ Icon Auto-fetched**`);
              } else {
                results.push('**○ No Icon** (auto-fetch failed)');
              }
            } else {
              results.push('**○ No Icon** (no favicon found)');
            }
          } else {
            results.push('**○ No Icon**');
          }
        }

        // ============================================================
        // Step 2b: Completeness Checks (warnings, not errors)
        // These help the agent understand when/how to use this source
        // ============================================================

        // Cast to check for common misnamed fields (description vs tagline)
        // TypeScript types don't prevent extra properties at runtime, so we cast
        // through unknown to access potential untyped fields in the JSON
        const rawConfig = source as unknown as Record<string, unknown>;

        // Check for tagline - the description shown in the UI
        if (!source.tagline) {
          // Check if user mistakenly used 'description' instead of 'tagline'
          if (rawConfig['description'] && typeof rawConfig['description'] === 'string') {
            warnings.push('**⚠ Wrong Field Name: "description" → "tagline"**');
            warnings.push(`  Found: \`"description": "${rawConfig['description']}"\``);
            warnings.push('  The UI displays the \`tagline\` field, not \`description\`.');
            warnings.push('  Rename the field in config.json:');
            warnings.push(`  \`"tagline": "${rawConfig['description']}"\``);
          } else {
            warnings.push('**⚠ Missing Tagline**');
            warnings.push('  Add a \`tagline\` field to describe this source\'s purpose.');
            warnings.push('  This is displayed in the UI and helps Claude understand the source.');
            warnings.push('  Example: \`"tagline": "Issue tracking for the iOS team"\`');
          }
        } else {
          // Tagline exists - report it for visibility
          results.push(`**✓ Tagline** "${source.tagline}"`);
        }

        // Check for icon (supports .svg, .png, .jpg, .jpeg)
        // Only warn if no icon was found/downloaded in the previous step
        if (!localIcon && !source.icon) {
          warnings.push('**⚠ Missing Icon**');
          warnings.push('  No icon file found in source folder (icon.svg, icon.png, icon.jpg).');
          warnings.push('  Options to add an icon:');
          warnings.push('  1. Place an icon file directly in the source folder');
          warnings.push('  2. Add \`"icon": "<url>"\` to config.json (will be auto-downloaded)');
          warnings.push('  3. Add \`"icon": "📋"\` to use an emoji');
          warnings.push('');
          warnings.push('  To find an icon, use WebSearch:');
          warnings.push(`  WebSearch({ query: "${source.provider || source.name} logo svg" })`);
        }

        // Check for guide.md - essential for Claude to understand how to use the source
        const guidePath = join(sourcePath, 'guide.md');
        const hasGuide = existsSync(guidePath);
        if (!hasGuide) {
          warnings.push('**⚠ Missing guide.md**');
          warnings.push('  Create a guide.md file to help Claude use this source effectively.');
          warnings.push('  Include: available endpoints, authentication details, usage examples.');
          warnings.push(`  Path: ${sourcePath}/guide.md`);
        } else {
          const guideStats = statSync(guidePath);
          const guideSizeKB = (guideStats.size / 1024).toFixed(1);
          results.push(`**✓ Guide** (guide.md, ${guideSizeKB} KB)`);
        }

        // ============================================================
        // Step 3: Connection Test
        // ============================================================
        results.push('');

        // Handle API sources
        if (source.type === 'api') {
          const result = await testApiSource(source, workspaceRootPath);

          // Update the source's status and timestamp
          source.lastTestedAt = Date.now();
          if (result.success) {
            source.connectionStatus = 'connected';
            source.connectionError = undefined;
            // Set isAuthenticated for sources that don't require auth
            if (source.api?.authType === 'none') {
              source.isAuthenticated = true;
            }
          } else {
            source.connectionStatus = 'failed';
            source.connectionError = result.error;
          }
          saveSourceConfig(workspaceRootPath, source);

          if (result.success) {
            results.push(`**✓ API Connected** (${result.status})`);
            results.push(`  URL: ${source.api?.baseUrl}`);

            if (result.credentialType) {
              results.push(`  Credential: ${result.credentialType}`);
            }

            // Verify the source has valid credentials for session use
            const workspaceId = basename(workspaceRootPath);
            const loadedSource: LoadedSource = {
              config: source,
              guide: null,
              folderPath: sourcePath,
              workspaceRootPath,
              workspaceId,
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

            // Add domain validation hint for common errors
            if (result.status === 401 || result.status === 403 || result.status === 404) {
              results.push('');
              results.push('💡 **Tip:** API endpoints change frequently. Use `WebSearch` to verify the current URL:');
              results.push(`   WebSearch({ query: "${source.provider || source.name} API endpoint" })`);
            }
          }
        }

        // Handle local sources
        else if (source.type === 'local') {
          const localPath = source.local?.path;
          if (localPath && existsSync(localPath)) {
            source.lastTestedAt = Date.now();
            source.connectionStatus = 'connected';
            source.connectionError = undefined;
            source.isAuthenticated = true; // Local sources don't require auth
            saveSourceConfig(workspaceRootPath, source);
            results.push(`**✓ Local Path Exists** (${localPath})`);
          } else {
            hasErrors = true;
            source.connectionStatus = 'failed';
            source.connectionError = 'Path not found';
            saveSourceConfig(workspaceRootPath, source);
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
                saveSourceConfig(workspaceRootPath, source);

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
                saveSourceConfig(workspaceRootPath, source);

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
              const workspaceId = basename(workspaceRootPath);
              // Try OAuth first, then bearer
              const oauthCred = await credentialManager.get({
                type: 'source_oauth',
                workspaceId,
                sourceId: args.sourceSlug,
              });
              if (oauthCred?.value) {
                mcpAccessToken = oauthCred.value;
              } else {
                const bearerCred = await credentialManager.get({
                  type: 'source_bearer',
                  workspaceId,
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
                // Set isAuthenticated for sources that don't require auth
                if (source.mcp?.authType === 'none') {
                  source.isAuthenticated = true;
                }
                saveSourceConfig(workspaceRootPath, source);

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
                  workspaceRootPath,
                  workspaceId: basename(workspaceRootPath),
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
                source.connectionError = getValidationErrorMessage(mcpResult, { transport: source.mcp?.transport });
                saveSourceConfig(workspaceRootPath, source);
                results.push('**⚠ MCP Needs Authentication**');
                results.push('Use `source_oauth_trigger` to authenticate.');
              } else {
                hasErrors = true;
                source.connectionStatus = 'failed';
                const errorMsg = getValidationErrorMessage(mcpResult, { transport: source.mcp?.transport });
                source.connectionError = errorMsg;
                saveSourceConfig(workspaceRootPath, source);
                results.push(`**❌ MCP Connection Failed**`);
                results.push(`  Error: ${errorMsg}`);

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

        // Add completeness warnings if any
        if (warnings.length > 0) {
          results.push('');
          results.push('---');
          results.push('**Completeness Suggestions:**');
          results.push(...warnings);
        }

        // Add summary
        results.push('');
        if (hasErrors) {
          results.push(`**Source '${source.name}' has issues to fix.**`);
        } else if (warnings.length > 0) {
          results.push(`**Source '${source.name}' is ready** (with suggestions above).`);
        } else {
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
// OAuth Helpers
// ============================================================

/**
 * Verify that a source has a valid token in the credential store.
 * The isAuthenticated flag in config.json can be stale if the token was deleted or expired.
 *
 * @returns true if a valid token exists, false if re-authentication is needed
 */
async function verifySourceHasValidToken(
  workspaceRootPath: string,
  source: FolderSourceConfig,
  sourceSlug: string
): Promise<boolean> {
  if (!source.isAuthenticated) {
    return false;
  }

  const credManager = getSourceCredentialManager();
  const workspaceId = basename(workspaceRootPath);
  const loadedSource: LoadedSource = {
    config: source,
    guide: null,
    folderPath: getSourcePath(workspaceRootPath, sourceSlug),
    workspaceRootPath,
    workspaceId,
  };

  const token = await credManager.getToken(loadedSource);
  return token !== null;
}

// ============================================================
// OAuth Trigger Tool
// ============================================================

/**
 * Create a session-scoped source_oauth_trigger tool.
 * Initiates OAuth authentication for an MCP source.
 *
 * **IMPORTANT:** This tool triggers an auth request that pauses execution.
 * After calling onAuthRequest, the session manager will forceAbort the agent.
 * The OAuth flow runs in the background, and the result comes back as a new message.
 */
export function createOAuthTriggerTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'source_oauth_trigger',
    `Start OAuth authentication for an MCP source.

This tool initiates the OAuth 2.0 + PKCE flow for sources that require authentication.
A browser window will open for the user to complete authentication.

**Prerequisites:**
- Source must exist in the current workspace
- Source must be type 'mcp' with authType 'oauth'
- Source must have a valid MCP URL

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** while OAuth completes
- A browser window will open for user authentication
- Once complete or cancelled, you'll receive a message with the result
- Do NOT include any text or tool calls after this tool - they will not be executed

**Returns:**
- Success message if already authenticated
- Authentication request if OAuth flow is triggered`,
    {
      sourceSlug: z.string().describe('The slug of the source to authenticate'),
    },
    async (args) => {
      debug('[source_oauth_trigger] Starting OAuth for source:', args.sourceSlug);

      try {
        // Load the source config
        const source = loadSourceConfig(workspaceRootPath, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check ~/.craft-agent/workspaces/{workspace}/sources/ for available sources.`,
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

        // Get session callbacks
        const callbacks = getSessionScopedToolCallbacks(sessionId);

        if (!callbacks?.onAuthRequest) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: No auth request handler available. This tool requires a UI to handle OAuth.',
            }],
            isError: true,
          };
        }

        // Build auth request
        const authRequest: McpOAuthAuthRequest = {
          type: 'oauth',
          requestId: crypto.randomUUID(),
          sessionId,
          sourceSlug: args.sourceSlug,
          sourceName: source.name,
        };

        // Trigger auth request - this will cause the session manager to forceAbort
        // The session manager will then run the OAuth flow
        callbacks.onAuthRequest(authRequest);

        // Return immediately - execution will be paused by forceAbort
        return {
          content: [{
            type: 'text' as const,
            text: `OAuth authentication requested for '${source.name}'. Opening browser for authentication.`,
          }],
          isError: false,
        };
      } catch (error) {
        debug('[source_oauth_trigger] Error:', error);

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
 *
 * **IMPORTANT:** This tool triggers an auth request that pauses execution.
 * After calling onAuthRequest, the session manager will forceAbort the agent.
 * The OAuth flow runs in the background, and the result comes back as a new message.
 */
export function createGoogleOAuthTriggerTool(sessionId: string, workspaceRootPath: string) {
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

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** while OAuth completes
- A browser window will open for Google sign-in
- Once complete or cancelled, you'll receive a message with the result
- Do NOT include any text or tool calls after this tool - they will not be executed

**Returns:**
- Success message if already authenticated
- Authentication request if OAuth flow is triggered`,
    {
      sourceSlug: z.string().describe('The slug of the Google API source to authenticate'),
    },
    async (args) => {
      try {
        // Load the source config
        const source = loadSourceConfig(workspaceRootPath, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check ~/.craft-agent/workspaces/{workspace}/sources/ for available sources.`,
            }],
            isError: true,
          };
        }

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

        // Check if source has valid credentials (not just isAuthenticated flag)
        const hasValidToken = await verifySourceHasValidToken(workspaceRootPath, source, args.sourceSlug);
        if (hasValidToken) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is already authenticated.`,
            }],
            isError: false,
          };
        }
        if (source.isAuthenticated) {
          debug(`[source_google_oauth_trigger] Source '${args.sourceSlug}' marked as authenticated but no valid token found, triggering re-auth`);
        }

        // Determine service from config for new pattern
        let service: GoogleService | undefined;
        const api = source.api;

        if (api?.googleService) {
          service = api.googleService;
        } else {
          service = inferGoogleServiceFromUrl(api?.baseUrl);
        }

        // Get session callbacks
        const callbacks = getSessionScopedToolCallbacks(sessionId);

        if (!callbacks?.onAuthRequest) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: No auth request handler available. This tool requires a UI to handle OAuth.',
            }],
            isError: true,
          };
        }

        // Build auth request
        const authRequest: GoogleOAuthAuthRequest = {
          type: 'oauth-google',
          requestId: crypto.randomUUID(),
          sessionId,
          sourceSlug: args.sourceSlug,
          sourceName: source.name,
          service,
        };

        // Trigger auth request - this will cause the session manager to forceAbort
        // The session manager will then run the OAuth flow
        callbacks.onAuthRequest(authRequest);

        // Return immediately - execution will be paused by forceAbort
        return {
          content: [{
            type: 'text' as const,
            text: `Google OAuth requested for '${source.name}'. Opening browser for authentication.`,
          }],
          isError: false,
        };
      } catch (error) {
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
 * Create a session-scoped source_slack_oauth_trigger tool.
 * Handles OAuth authentication for Slack API sources.
 *
 * **IMPORTANT:** This tool triggers an auth request that pauses execution.
 * After calling onAuthRequest, the session manager will forceAbort the agent.
 * The OAuth flow runs in the background, and the result comes back as a new message.
 */
export function createSlackOAuthTriggerTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'source_slack_oauth_trigger',
    `Trigger Slack OAuth authentication flow for a Slack API source.

Opens a browser window for the user to sign in with their Slack account and authorize access to the specified Slack workspace.
After successful authentication, the tokens are stored and the source is marked as authenticated.

**Supported services:**
- messaging: Send messages, post in channels
- channels: Read and manage channels
- users: Read user profiles
- files: Upload and manage files
- full: Full workspace access (messaging, channels, users, files, reactions)

**Prerequisites:**
- The source must have type 'api' and provider 'slack'
- Slack OAuth must be configured in the build

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** while OAuth completes
- A browser window will open for Slack sign-in
- Once complete or cancelled, you'll receive a message with the result
- Do NOT include any text or tool calls after this tool - they will not be executed

**Returns:**
- Success message if already authenticated
- Authentication request if OAuth flow is triggered`,
    {
      sourceSlug: z.string().describe('The slug of the Slack API source to authenticate'),
    },
    async (args) => {
      try {
        // Load the source config
        const source = loadSourceConfig(workspaceRootPath, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check ~/.craft-agent/workspaces/{workspace}/sources/ for available sources.`,
            }],
            isError: true,
          };
        }

        // Verify this is a Slack source
        if (source.provider !== 'slack') {
          const hint = !source.provider
            ? `Add "provider": "slack" to config.json and retry.`
            : `This source has provider '${source.provider}'. Use source_oauth_trigger for MCP sources or source_google_oauth_trigger for Google sources.`;
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is not configured as a Slack API source. ${hint}\n\nCurrent config: ${JSON.stringify(source, null, 2)}`,
            }],
            isError: true,
          };
        }

        // Verify source type is 'api', not 'mcp' - OAuth only works with API sources
        if (source.type !== 'api') {
          let hint = '';
          if (source.type === 'mcp') {
            hint = `For Slack integration, use the native Slack API approach (type: "api", provider: "slack") instead of an MCP server. This enables proper OAuth authentication via source_slack_oauth_trigger.`;
          }
          return {
            content: [{
              type: 'text' as const,
              text: `source_slack_oauth_trigger only works with API sources (type: "api"), not ${source.type} sources. ${hint}`,
            }],
            isError: true,
          };
        }

        // Check if source has valid credentials (not just isAuthenticated flag)
        const hasValidToken = await verifySourceHasValidToken(workspaceRootPath, source, args.sourceSlug);
        if (hasValidToken) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is already authenticated.`,
            }],
            isError: false,
          };
        }
        if (source.isAuthenticated) {
          debug(`[source_slack_oauth_trigger] Source '${args.sourceSlug}' marked as authenticated but no valid token found, triggering re-auth`);
        }

        // Determine service from config for new pattern
        let service: SlackService | undefined;
        const api = source.api;

        if (api?.slackService) {
          service = api.slackService;
        } else {
          service = inferSlackServiceFromUrl(api?.baseUrl) || 'full';
        }

        // Get session callbacks
        const callbacks = getSessionScopedToolCallbacks(sessionId);

        if (!callbacks?.onAuthRequest) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: No auth request handler available. This tool requires a UI to handle OAuth.',
            }],
            isError: true,
          };
        }

        // Build auth request
        const authRequest: SlackOAuthAuthRequest = {
          type: 'oauth-slack',
          requestId: crypto.randomUUID(),
          sessionId,
          sourceSlug: args.sourceSlug,
          sourceName: source.name,
          service,
        };

        // Trigger auth request - this will cause the session manager to forceAbort
        // The session manager will then run the OAuth flow
        callbacks.onAuthRequest(authRequest);

        // Return immediately - execution will be paused by forceAbort
        return {
          content: [{
            type: 'text' as const,
            text: `Slack OAuth requested for '${source.name}'. Opening browser for authentication.`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Slack OAuth failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create a session-scoped source_microsoft_oauth_trigger tool.
 * Handles OAuth authentication for Microsoft API sources (Outlook, OneDrive, Calendar, Teams, SharePoint).
 *
 * **IMPORTANT:** This tool triggers an auth request that pauses execution.
 * After calling onAuthRequest, the session manager will forceAbort the agent.
 * The OAuth flow runs in the background, and the result comes back as a new message.
 */
export function createMicrosoftOAuthTriggerTool(sessionId: string, workspaceRootPath: string) {
  return tool(
    'source_microsoft_oauth_trigger',
    `Trigger Microsoft OAuth authentication flow for a Microsoft API source.

Opens a browser window for the user to sign in with their Microsoft account and authorize access to the specified Microsoft service.
After successful authentication, the tokens are stored and the source is marked as authenticated.

**Supported services:**
- outlook: Read, compose, and manage emails
- calendar: Read and manage calendar events
- onedrive: Read and manage OneDrive files
- teams: Read and send Teams messages
- sharepoint: Read and manage SharePoint sites

**Prerequisites:**
- The source must have provider 'microsoft'
- Microsoft OAuth must be configured in the build

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** while OAuth completes
- A browser window will open for Microsoft sign-in
- Once complete or cancelled, you'll receive a message with the result
- Do NOT include any text or tool calls after this tool - they will not be executed

**Returns:**
- Success message if already authenticated
- Authentication request if OAuth flow is triggered`,
    {
      sourceSlug: z.string().describe('The slug of the Microsoft API source to authenticate'),
    },
    async (args) => {
      try {
        // Load the source config
        const source = loadSourceConfig(workspaceRootPath, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check ~/.craft-agent/workspaces/{workspace}/sources/ for available sources.`,
            }],
            isError: true,
          };
        }

        // Verify this is a Microsoft source
        if (source.provider !== 'microsoft') {
          const hint = !source.provider
            ? `Add "provider": "microsoft" to config.json and retry.`
            : `This source has provider '${source.provider}'. Use source_oauth_trigger for MCP sources, source_google_oauth_trigger for Google sources, or source_slack_oauth_trigger for Slack sources.`;
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is not configured as a Microsoft API source. ${hint}\n\nCurrent config: ${JSON.stringify(source, null, 2)}`,
            }],
            isError: true,
          };
        }

        // Check if source has valid credentials (not just isAuthenticated flag)
        const hasValidToken = await verifySourceHasValidToken(workspaceRootPath, source, args.sourceSlug);
        if (hasValidToken) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' is already authenticated.`,
            }],
            isError: false,
          };
        }
        if (source.isAuthenticated) {
          debug(`[source_microsoft_oauth_trigger] Source '${args.sourceSlug}' marked as authenticated but no valid token found, triggering re-auth`);
        }

        // Determine service from config for new pattern
        let service: MicrosoftService | undefined;
        const api = source.api;

        if (api?.microsoftService) {
          service = api.microsoftService;
        } else {
          service = inferMicrosoftServiceFromUrl(api?.baseUrl);
        }

        // Get session callbacks
        const callbacks = getSessionScopedToolCallbacks(sessionId);

        if (!callbacks?.onAuthRequest) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: No auth request handler available. This tool requires a UI to handle OAuth.',
            }],
            isError: true,
          };
        }

        // Build auth request
        const authRequest: MicrosoftOAuthAuthRequest = {
          type: 'oauth-microsoft',
          requestId: crypto.randomUUID(),
          sessionId,
          sourceSlug: args.sourceSlug,
          sourceName: source.name,
          service,
        };

        // Trigger auth request - this will cause the session manager to forceAbort
        // The session manager will then run the OAuth flow
        callbacks.onAuthRequest(authRequest);

        // Return immediately - execution will be paused by forceAbort
        return {
          content: [{
            type: 'text' as const,
            text: `Microsoft OAuth requested for '${source.name}'. Opening browser for authentication.`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Microsoft OAuth failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
 * Create a session-scoped source_credential_prompt tool.
 * Prompts the user to enter credentials for a source via the secure input UI.
 *
 * **IMPORTANT:** This tool triggers an auth request that pauses execution.
 * After calling onAuthRequest, the session manager will forceAbort the agent.
 * The user completes auth in the UI, and the result comes back as a new message.
 */
export function createCredentialPromptTool(sessionId: string, workspaceRootPath: string) {
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

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** to show the credential input UI
- Once the user completes or cancels, you'll receive a message with the result
- Do NOT include any text or tool calls after this tool - they will not be executed

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
      debug('[source_credential_prompt] Requesting credentials:', args.sourceSlug, args.mode);

      try {
        // Load source to get name and validate
        const source = loadSourceConfig(workspaceRootPath, args.sourceSlug);
        if (!source) {
          return {
            content: [{
              type: 'text' as const,
              text: `Source '${args.sourceSlug}' not found. Check ~/.craft-agent/workspaces/{workspace}/sources/ for available sources.`,
            }],
            isError: true,
          };
        }

        // Get callbacks
        const callbacks = getSessionScopedToolCallbacks(sessionId);

        if (!callbacks?.onAuthRequest) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: No credential input handler available. This tool requires a UI to prompt for credentials.',
            }],
            isError: true,
          };
        }

        // Build auth request
        const authRequest: CredentialAuthRequest = {
          type: 'credential',
          requestId: crypto.randomUUID(),
          sessionId,
          sourceSlug: args.sourceSlug,
          sourceName: source.name,
          mode: args.mode,
          labels: args.labels,
          description: args.description,
          hint: args.hint,
          headerName: source.api?.headerName,
          // Pass source URL so password managers (1Password) can match stored credentials by domain
          sourceUrl: source.api?.baseUrl || source.mcp?.url,
        };

        // Trigger auth request - this will cause the session manager to forceAbort
        callbacks.onAuthRequest(authRequest);

        // Return immediately - execution will be paused by forceAbort
        return {
          content: [{
            type: 'text' as const,
            text: `Authentication requested for '${source.name}'. Waiting for user input.`,
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
 * @param workspaceRootPath - Absolute path to workspace folder (e.g., ~/.craft-agent/workspaces/xxx)
 */
export function getSessionScopedTools(sessionId: string, workspaceRootPath: string): ReturnType<typeof createSdkMcpServer> {
  const cacheKey = `${sessionId}::${workspaceRootPath}`;
  let cached = sessionScopedToolsCache.get(cacheKey);
  if (!cached) {
    // Create session-scoped tools that capture the sessionId and workspaceRootPath in their closures
    // Note: Source CRUD is done via standard file editing tools (Read/Write/Edit).
    // See ~/.craft-agent/docs/ for config format documentation.
    cached = createSdkMcpServer({
      name: 'session',
      version: '1.0.0',
      tools: [
        createSubmitPlanTool(sessionId),
        // Config validation tool
        createConfigValidateTool(sessionId, workspaceRootPath),
        // Skill validation tool
        createSkillValidateTool(sessionId, workspaceRootPath),
        // Source tools: test + auth only (CRUD via file editing)
        createSourceTestTool(sessionId, workspaceRootPath),
        createOAuthTriggerTool(sessionId, workspaceRootPath),
        createGoogleOAuthTriggerTool(sessionId, workspaceRootPath),
        createSlackOAuthTriggerTool(sessionId, workspaceRootPath),
        createMicrosoftOAuthTriggerTool(sessionId, workspaceRootPath),
        createCredentialPromptTool(sessionId, workspaceRootPath),
      ],
    });
    sessionScopedToolsCache.set(cacheKey, cached);
    debug(`[SessionScopedTools] Created tools provider for session ${sessionId} in workspace ${workspaceRootPath}`);
  }
  return cached;
}

/**
 * Clean up session-scoped tools when a session is disposed.
 * Removes the cached provider and clears all session state.
 *
 * @param sessionId - Unique session identifier
 * @param workspaceRootPath - Optional workspace root path; if provided, only cleans up that specific workspace's cache
 */
export function cleanupSessionScopedTools(sessionId: string, workspaceRootPath?: string): void {
  if (workspaceRootPath) {
    // Clean up specific workspace cache
    const cacheKey = `${sessionId}::${workspaceRootPath}`;
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
export function getSessionPlansDir(workspaceRootPath: string, sessionId: string): string {
  return getSessionPlansPath(workspaceRootPath, sessionId);
}

/**
 * Check if a file path is within the plans directory
 */
export function isPathInPlansDir(filePath: string, workspaceRootPath: string, sessionId: string): boolean {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  // Normalize paths for comparison
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPlansDir = plansDir.replace(/\\/g, '/');
  return normalizedPath.startsWith(normalizedPlansDir);
}
