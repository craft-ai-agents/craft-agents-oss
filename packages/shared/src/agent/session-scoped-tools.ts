/**
 * Session-Scoped Tools
 *
 * Tools that are scoped to a specific session. Each session gets its own
 * instance of these tools with session-specific callbacks and state.
 *
 * This file is a thin adapter that wraps the shared handlers from
 * @craft-agent/session-tools-core for use with the Claude SDK.
 *
 * Tools included:
 * - SubmitPlan: Submit a plan file for user review/display
 * - config_validate: Validate configuration files
 * - skill_validate: Validate skill SKILL.md files
 * - mermaid_validate: Validate Mermaid diagram syntax
 * - source_test: Validate schema, download icons, test connections
 * - source_oauth_trigger: Start OAuth authentication for MCP sources
 * - source_google_oauth_trigger: Start Google OAuth authentication
 * - source_slack_oauth_trigger: Start Slack OAuth authentication
 * - source_microsoft_oauth_trigger: Start Microsoft OAuth authentication
 * - source_credential_prompt: Prompt user for API credentials
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { getSessionPlansPath } from '../sessions/storage.ts';
import { debug } from '../utils/debug.ts';
import { DOC_REFS } from '../docs/index.ts';
import { createClaudeContext } from './claude-context.ts';
import { basename } from 'node:path';

// Import handlers from session-tools-core
import {
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
  // Types
  type ToolResult,
  type AuthRequest,
} from '@craft-agent/session-tools-core';

// Re-export types for backward compatibility
export type {
  CredentialInputMode,
  AuthRequestType,
  AuthRequest,
  AuthResult,
  CredentialAuthRequest,
  McpOAuthAuthRequest,
  GoogleOAuthAuthRequest,
  SlackOAuthAuthRequest,
  MicrosoftOAuthAuthRequest,
  GoogleService,
  SlackService,
  MicrosoftService,
} from '@craft-agent/session-tools-core';

// ============================================================
// Session-Scoped Tool Callbacks
// ============================================================

/**
 * Callbacks that can be registered per-session
 */
export interface SessionScopedToolCallbacks {
  /**
   * Called when a plan is submitted via SubmitPlan tool.
   * Receives the path to the plan markdown file.
   */
  onPlanSubmitted?: (planPath: string) => void;

  /**
   * Called when authentication is requested via OAuth/credential tools.
   * The auth UI should be shown and execution paused.
   */
  onAuthRequest?: (request: AuthRequest) => void;
}

// Registry of callbacks keyed by sessionId
const sessionScopedToolCallbackRegistry = new Map<string, SessionScopedToolCallbacks>();

/**
 * Register callbacks for a specific session
 */
export function registerSessionScopedToolCallbacks(
  sessionId: string,
  callbacks: SessionScopedToolCallbacks
): void {
  sessionScopedToolCallbackRegistry.set(sessionId, callbacks);
  debug('session-scoped-tools', `Registered callbacks for session ${sessionId}`);
}

/**
 * Unregister callbacks for a session
 */
export function unregisterSessionScopedToolCallbacks(sessionId: string): void {
  sessionScopedToolCallbackRegistry.delete(sessionId);
  debug('session-scoped-tools', `Unregistered callbacks for session ${sessionId}`);
}

/**
 * Get callbacks for a session
 */
function getSessionScopedToolCallbacks(sessionId: string): SessionScopedToolCallbacks | undefined {
  return sessionScopedToolCallbackRegistry.get(sessionId);
}

// ============================================================
// Plan State Management
// ============================================================

// Map of sessionId -> last submitted plan path (for retrieval after submission)
const sessionPlanFilePaths = new Map<string, string>();

/**
 * Get the last submitted plan file path for a session
 */
export function getLastPlanFilePath(sessionId: string): string | null {
  return sessionPlanFilePaths.get(sessionId) ?? null;
}

/**
 * Set the last submitted plan file path for a session
 */
function setLastPlanFilePath(sessionId: string, path: string): void {
  sessionPlanFilePaths.set(sessionId, path);
}

/**
 * Clear plan file state for a session
 */
export function clearPlanFileState(sessionId: string): void {
  sessionPlanFilePaths.delete(sessionId);
}

// ============================================================
// Plan Path Helpers
// ============================================================

/**
 * Get the plans directory for a session
 */
export function getSessionPlansDir(workspacePath: string, sessionId: string): string {
  return getSessionPlansPath(workspacePath, sessionId);
}

/**
 * Check if a path is within a session's plans directory
 */
export function isPathInPlansDir(path: string, workspacePath: string, sessionId: string): boolean {
  const plansDir = getSessionPlansDir(workspacePath, sessionId);
  return path.startsWith(plansDir);
}

// ============================================================
// Tool Result Converter
// ============================================================

/**
 * Convert shared ToolResult to SDK format
 */
function convertResult(result: ToolResult): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return {
    content: result.content.map(c => ({ type: 'text' as const, text: c.text })),
    ...(result.isError ? { isError: true } : {}),
  };
}

// ============================================================
// Cache for Session-Scoped Tools
// ============================================================

// Cache tools by session to avoid recreating them
const sessionScopedToolsCache = new Map<string, ReturnType<typeof createSdkMcpServer>>();

/**
 * Clean up cached tools for a session
 */
export function cleanupSessionScopedTools(sessionId: string): void {
  sessionScopedToolsCache.delete(sessionId);
}

// ============================================================
// Tool Schemas
// ============================================================

const submitPlanSchema = {
  planPath: z.string().describe('Absolute path to the plan markdown file you wrote'),
};

const configValidateSchema = {
  target: z.enum(['config', 'sources', 'statuses', 'preferences', 'permissions', 'tool-icons', 'all'])
    .describe('Which config file(s) to validate'),
  sourceSlug: z.string().optional().describe('Validate a specific source by slug'),
};

const skillValidateSchema = {
  skillSlug: z.string().describe('The slug of the skill to validate'),
};

const mermaidValidateSchema = {
  code: z.string().describe('The mermaid diagram code to validate'),
  render: z.boolean().optional().describe('Also attempt to render (catches layout errors)'),
};

const sourceTestSchema = {
  sourceSlug: z.string().describe('The slug of the source to test'),
};

const sourceOAuthTriggerSchema = {
  sourceSlug: z.string().describe('The slug of the source to authenticate'),
};

const credentialPromptSchema = {
  sourceSlug: z.string().describe('The slug of the source to authenticate'),
  mode: z.enum(['bearer', 'basic', 'header', 'query', 'multi-header']).describe('Type of credential input'),
  labels: z.object({
    credential: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
  }).optional().describe('Custom field labels'),
  description: z.string().optional().describe('Description shown to user'),
  hint: z.string().optional().describe('Hint about where to find credentials'),
  headerNames: z.array(z.string()).optional().describe('Header names for multi-header auth (e.g., ["DD-API-KEY", "DD-APPLICATION-KEY"])'),
  passwordRequired: z.boolean().optional().describe('For basic auth: whether password is required'),
};

// ============================================================
// Tool Descriptions
// ============================================================

const TOOL_DESCRIPTIONS = {
  SubmitPlan: `Submit a plan for user review.

Call this after you have written your plan to a markdown file using the Write tool.
The plan will be displayed to the user in a special formatted view.

**IMPORTANT:** After calling this tool:
- Execution will be **automatically paused** to present the plan to the user
- No further tool calls or text output will be processed after this tool returns
- The conversation will resume when the user responds (accept, modify, or reject the plan)
- Do NOT include any text or tool calls after SubmitPlan - they will not be executed`,

  config_validate: `Validate Craft Agent configuration files.

Use this after editing configuration files to check for errors before they take effect.
Returns structured validation results with errors, warnings, and suggestions.

**Targets:**
- \`config\`: Validates ~/.craft-agent/config.json (workspaces, model, settings)
- \`sources\`: Validates all sources in ~/.craft-agent/workspaces/{workspace}/sources/*/config.json
- \`statuses\`: Validates ~/.craft-agent/workspaces/{workspace}/statuses/config.json
- \`preferences\`: Validates ~/.craft-agent/preferences.json
- \`permissions\`: Validates permissions.json files
- \`tool-icons\`: Validates ~/.craft-agent/tool-icons/tool-icons.json
- \`all\`: Validates all configuration files

**Reference:** ${DOC_REFS.sources}`,

  skill_validate: `Validate a skill's SKILL.md file.

Checks:
- Slug format (lowercase alphanumeric with hyphens)
- SKILL.md exists and is readable
- YAML frontmatter is valid with required fields (name, description)
- Content is non-empty after frontmatter
- Icon format if present (svg/png/jpg)

**Reference:** ${DOC_REFS.skills}`,

  mermaid_validate: `Validate Mermaid diagram syntax before outputting.

Use this when:
- Creating complex diagrams with many nodes/relationships
- Unsure about syntax for a specific diagram type
- Debugging a diagram that failed to render

Returns validation result with specific error messages if invalid.

**Reference:** ${DOC_REFS.mermaid}`,

  source_test: `Validate and test a source configuration.

**This tool performs:**
1. **Schema validation**: Validates config.json structure
2. **Icon handling**: Checks/downloads icon if configured
3. **Completeness check**: Warns about missing guide.md/icon/tagline
4. **Connection test**: Tests if the source is reachable
5. **Auth status**: Checks if source is authenticated

**Reference:** ${DOC_REFS.sources}`,

  source_oauth_trigger: `Start OAuth authentication for an MCP source.

This tool initiates the OAuth 2.0 + PKCE flow for sources that require authentication.

**Prerequisites:**
- Source must exist in the current workspace
- Source must be type 'mcp' with authType 'oauth'
- Source must have a valid MCP URL

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,

  source_google_oauth_trigger: `Trigger Google OAuth authentication for a Google API source.

Opens a browser window for the user to sign in with their Google account.

**Supported services:** Gmail, Calendar, Drive

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,

  source_slack_oauth_trigger: `Trigger Slack OAuth authentication for a Slack API source.

Opens a browser window for the user to sign in with their Slack account.

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,

  source_microsoft_oauth_trigger: `Trigger Microsoft OAuth authentication for a Microsoft API source.

Opens a browser window for the user to sign in with their Microsoft account.

**Supported services:** Outlook, Calendar, OneDrive, Teams, SharePoint

**IMPORTANT:** After calling this tool, execution will be paused while OAuth completes.`,

  source_credential_prompt: `Prompt the user to enter credentials for a source.

Use this when a source requires authentication that isn't OAuth.
The user will see a secure input UI with appropriate fields based on the auth mode.

**Auth Modes:**
- \`bearer\`: Single token field (Bearer Token, API Key)
- \`basic\`: Username and Password fields
- \`header\`: API Key with custom header name shown
- \`query\`: API Key for query parameter auth

**IMPORTANT:** After calling this tool, execution will be paused for user input.`,
};

// ============================================================
// Main Factory Function
// ============================================================

/**
 * Get or create session-scoped tools for a session.
 * Returns an MCP server with all session-scoped tools registered.
 */
export function getSessionScopedTools(
  sessionId: string,
  workspaceRootPath: string,
  workspaceId?: string
): ReturnType<typeof createSdkMcpServer> {
  const cacheKey = `${sessionId}::${workspaceRootPath}`;

  // Return cached if available
  let cached = sessionScopedToolsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Create Claude context with full capabilities
  const ctx = createClaudeContext({
    sessionId,
    workspacePath: workspaceRootPath,
    workspaceId: workspaceId || basename(workspaceRootPath) || '',
    onPlanSubmitted: (planPath: string) => {
      setLastPlanFilePath(sessionId, planPath);
      const callbacks = getSessionScopedToolCallbacks(sessionId);
      callbacks?.onPlanSubmitted?.(planPath);
    },
    onAuthRequest: (request: unknown) => {
      const callbacks = getSessionScopedToolCallbacks(sessionId);
      callbacks?.onAuthRequest?.(request as AuthRequest);
    },
  });

  // Create tools using shared handlers
  const tools = [
    // SubmitPlan
    tool('SubmitPlan', TOOL_DESCRIPTIONS.SubmitPlan, submitPlanSchema, async (args) => {
      const result = await handleSubmitPlan(ctx, args);
      return convertResult(result);
    }),

    // config_validate
    tool('config_validate', TOOL_DESCRIPTIONS.config_validate, configValidateSchema, async (args) => {
      const result = await handleConfigValidate(ctx, args as { target: 'config' | 'sources' | 'statuses' | 'preferences' | 'permissions' | 'tool-icons' | 'all'; sourceSlug?: string });
      return convertResult(result);
    }),

    // skill_validate
    tool('skill_validate', TOOL_DESCRIPTIONS.skill_validate, skillValidateSchema, async (args) => {
      const result = await handleSkillValidate(ctx, args);
      return convertResult(result);
    }),

    // mermaid_validate
    tool('mermaid_validate', TOOL_DESCRIPTIONS.mermaid_validate, mermaidValidateSchema, async (args) => {
      const result = await handleMermaidValidate(ctx, args);
      return convertResult(result);
    }),

    // source_test
    tool('source_test', TOOL_DESCRIPTIONS.source_test, sourceTestSchema, async (args) => {
      const result = await handleSourceTest(ctx, args);
      return convertResult(result);
    }),

    // source_oauth_trigger
    tool('source_oauth_trigger', TOOL_DESCRIPTIONS.source_oauth_trigger, sourceOAuthTriggerSchema, async (args) => {
      const result = await handleSourceOAuthTrigger(ctx, args);
      return convertResult(result);
    }),

    // source_google_oauth_trigger
    tool('source_google_oauth_trigger', TOOL_DESCRIPTIONS.source_google_oauth_trigger, sourceOAuthTriggerSchema, async (args) => {
      const result = await handleGoogleOAuthTrigger(ctx, args);
      return convertResult(result);
    }),

    // source_slack_oauth_trigger
    tool('source_slack_oauth_trigger', TOOL_DESCRIPTIONS.source_slack_oauth_trigger, sourceOAuthTriggerSchema, async (args) => {
      const result = await handleSlackOAuthTrigger(ctx, args);
      return convertResult(result);
    }),

    // source_microsoft_oauth_trigger
    tool('source_microsoft_oauth_trigger', TOOL_DESCRIPTIONS.source_microsoft_oauth_trigger, sourceOAuthTriggerSchema, async (args) => {
      const result = await handleMicrosoftOAuthTrigger(ctx, args);
      return convertResult(result);
    }),

    // source_credential_prompt
    tool('source_credential_prompt', TOOL_DESCRIPTIONS.source_credential_prompt, credentialPromptSchema, async (args) => {
      const result = await handleCredentialPrompt(ctx, args as {
        sourceSlug: string;
        mode: 'bearer' | 'basic' | 'header' | 'query';
        labels?: { credential?: string; username?: string; password?: string };
        description?: string;
        hint?: string;
        passwordRequired?: boolean;
      });
      return convertResult(result);
    }),

  ];

  // Create MCP server
  cached = createSdkMcpServer({
    name: 'session',
    version: '1.0.0',
    tools,
  });

  sessionScopedToolsCache.set(cacheKey, cached);
  return cached;
}
