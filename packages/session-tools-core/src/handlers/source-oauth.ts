/**
 * Source OAuth Handlers
 *
 * Handlers for triggering OAuth authentication flows.
 * Supports MCP OAuth, Google, Slack, and Microsoft OAuth.
 */

import type { SessionToolContext } from '../context.ts';
import type {
  ToolResult,
  SourceConfig,
  McpOAuthAuthRequest,
  GoogleOAuthAuthRequest,
  SlackOAuthAuthRequest,
  MicrosoftOAuthAuthRequest,
  GoogleService,
  SlackService,
  MicrosoftService,
} from '../types.ts';
import { MICROSOFT_SERVICES } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';
import { generateRequestId } from '../source-helpers.ts';
import { basename } from 'node:path';

/** How a Microsoft source chooses its scopes (MICROSOFT_SCOPES_RULE in @craft-agent/shared). */
const MICROSOFT_SCOPES_RULE = `Set microsoftService (${new Intl.ListFormat('en', { type: 'disjunction' })
  .format(MICROSOFT_SERVICES.map(service => `'${service}'`))}) or microsoftScopes in api config.`;

function isMicrosoftService(value: string | undefined): value is MicrosoftService {
  return value !== undefined && (MICROSOFT_SERVICES as readonly string[]).includes(value);
}

/** The LoadedSource shape the credential manager needs for a source config. */
function toLoadedSource(ctx: SessionToolContext, config: SourceConfig) {
  return {
    config,
    guide: null,
    folderPath: '',
    workspaceRootPath: ctx.workspacePath,
    workspaceId: basename(ctx.workspacePath) || '',
  };
}

/**
 * For an authenticated source, report a usable token without asking the user to sign in:
 * the stored token if it is still valid, else a refreshed one. Returns null when only a
 * new sign-in will do.
 */
async function reuseOrRefreshToken(ctx: SessionToolContext, config: SourceConfig): Promise<ToolResult | null> {
  if (!config.isAuthenticated || !ctx.credentialManager) return null;
  const loadedSource = toLoadedSource(ctx, config);
  if (await ctx.credentialManager.getToken(loadedSource)) {
    return successResponse(`Source '${config.slug}' is already authenticated.`);
  }
  if (await ctx.credentialManager.refresh(loadedSource)) {
    return successResponse(refreshedMessage(config.slug));
  }
  return null;
}

function refreshedMessage(sourceSlug: string): string {
  return `Token for source '${sourceSlug}' has been refreshed successfully. The source is ready — proceed with using its tools directly.`;
}

// ============================================================
// MCP OAuth Trigger
// ============================================================

export interface SourceOAuthTriggerArgs {
  sourceSlug: string;
}

/**
 * Handle the source_oauth_trigger tool call.
 * Triggers OAuth 2.0 + PKCE flow for MCP sources.
 */
export async function handleSourceOAuthTrigger(
  ctx: SessionToolContext,
  args: SourceOAuthTriggerArgs
): Promise<ToolResult> {
  const { sourceSlug } = args;

  // Load source config
  const source = ctx.loadSourceConfig(sourceSlug);
  if (!source) {
    return errorResponse(`Source '${sourceSlug}' not found.`);
  }

  // Validate source uses OAuth — supports MCP OAuth and generic API OAuth (with or without oauth config block)
  const isMcpOAuth = source.type === 'mcp' && source.mcp?.authType === 'oauth';
  const isApiOAuth = source.type === 'api' && source.api?.authType === 'oauth';

  if (!isMcpOAuth && !isApiOAuth) {
    return errorResponse(
      `Source '${sourceSlug}' is not configured for OAuth authentication.`
    );
  }

  // Try silent refresh only if source is already authenticated.
  // If connectionStatus is 'needs_auth' or isAuthenticated is false,
  // skip refresh and go straight to browser authorization flow.
  if (source.isAuthenticated && ctx.credentialManager) {
    const refreshedToken = await ctx.credentialManager.refresh(toLoadedSource(ctx, source));
    if (refreshedToken) {
      return successResponse(refreshedMessage(sourceSlug));
    }
  }

  // Build auth request
  const authRequest: McpOAuthAuthRequest = {
    type: 'oauth',
    requestId: generateRequestId('oauth'),
    sessionId: ctx.sessionId,
    sourceSlug,
    sourceName: source.name,
  };

  // Trigger auth request (will cause forceAbort)
  ctx.callbacks.onAuthRequest(authRequest);

  return successResponse(
    `OAuth authentication requested for '${source.name}'. Opening browser for authentication.`
  );
}

// ============================================================
// Google OAuth Trigger
// ============================================================

export interface GoogleOAuthTriggerArgs {
  sourceSlug: string;
}

/**
 * Handle the source_google_oauth_trigger tool call.
 * Triggers Google OAuth for Gmail, Calendar, Drive, etc.
 */
export async function handleGoogleOAuthTrigger(
  ctx: SessionToolContext,
  args: GoogleOAuthTriggerArgs
): Promise<ToolResult> {
  const { sourceSlug } = args;

  // Load source config
  const source = ctx.loadSourceConfig(sourceSlug);
  if (!source) {
    return errorResponse(`Source '${sourceSlug}' not found.`);
  }

  // Verify this is a Google source
  if (source.provider !== 'google') {
    const hint = !source.provider
      ? `Add "provider": "google" to config.json and retry.`
      : `This source has provider '${source.provider}'. Use source_oauth_trigger for MCP sources.`;
    return errorResponse(
      `Source '${sourceSlug}' is not configured as a Google API source. ${hint}`
    );
  }

  // Check if Google OAuth is configured (if method available)
  if (ctx.isGoogleOAuthConfigured) {
    const api = source.api;
    if (!ctx.isGoogleOAuthConfigured(api?.googleOAuthClientId, api?.googleOAuthClientSecret)) {
      return errorResponse(
        `Google OAuth credentials not configured for source '${sourceSlug}'.

To authenticate with Google services, you need to provide your own OAuth credentials.

**Option 1: Add credentials to source config**
Edit the source's config.json and add:
\`\`\`json
{
  "api": {
    "googleOAuthClientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "googleOAuthClientSecret": "YOUR_CLIENT_SECRET"
  }
}
\`\`\`

**Option 2: Set environment variables**
\`\`\`bash
export GOOGLE_OAUTH_CLIENT_ID="YOUR_CLIENT_ID.apps.googleusercontent.com"
export GOOGLE_OAUTH_CLIENT_SECRET="YOUR_CLIENT_SECRET"
\`\`\``
      );
    }
  }

  // A valid or refreshable token needs no sign-in card
  const ready = await reuseOrRefreshToken(ctx, source);
  if (ready) return ready;

  // Determine service from config
  let service: GoogleService | undefined;
  if (source.api?.googleService) {
    service = source.api.googleService;
  } else if (ctx.inferGoogleService) {
    service = ctx.inferGoogleService(source.api?.baseUrl);
  }

  // Build auth request
  const authRequest: GoogleOAuthAuthRequest = {
    type: 'oauth-google',
    requestId: generateRequestId('google-oauth'),
    sessionId: ctx.sessionId,
    sourceSlug,
    sourceName: source.name,
    service,
  };

  // Trigger auth request
  ctx.callbacks.onAuthRequest(authRequest);

  return successResponse(
    `Google OAuth requested for '${source.name}'. Opening browser for authentication.`
  );
}

// ============================================================
// Slack OAuth Trigger
// ============================================================

export interface SlackOAuthTriggerArgs {
  sourceSlug: string;
}

/**
 * Handle the source_slack_oauth_trigger tool call.
 * Triggers Slack OAuth for workspace access.
 */
export async function handleSlackOAuthTrigger(
  ctx: SessionToolContext,
  args: SlackOAuthTriggerArgs
): Promise<ToolResult> {
  const { sourceSlug } = args;

  // Load source config
  const source = ctx.loadSourceConfig(sourceSlug);
  if (!source) {
    return errorResponse(`Source '${sourceSlug}' not found.`);
  }

  // Verify this is a Slack source
  if (source.provider !== 'slack') {
    const hint = !source.provider
      ? `Add "provider": "slack" to config.json and retry.`
      : `This source has provider '${source.provider}'.`;
    return errorResponse(
      `Source '${sourceSlug}' is not configured as a Slack API source. ${hint}`
    );
  }

  // Slack OAuth only works with API sources, not MCP
  if (source.type !== 'api') {
    let hint = '';
    if (source.type === 'mcp') {
      hint = `For Slack integration, use the native Slack API approach (type: "api", provider: "slack") instead of an MCP server. This enables proper OAuth authentication via source_slack_oauth_trigger.`;
    }
    return errorResponse(
      `source_slack_oauth_trigger only works with API sources (type: "api"), not ${source.type} sources. ${hint}`
    );
  }

  // A valid or refreshable token needs no sign-in card
  const ready = await reuseOrRefreshToken(ctx, source);
  if (ready) return ready;

  // Determine service from config
  let service: SlackService | undefined;
  if (source.api?.slackService) {
    service = source.api.slackService;
  } else if (ctx.inferSlackService) {
    service = ctx.inferSlackService(source.api?.baseUrl) || 'full';
  } else {
    service = 'full';
  }

  // Build auth request
  const authRequest: SlackOAuthAuthRequest = {
    type: 'oauth-slack',
    requestId: generateRequestId('slack-oauth'),
    sessionId: ctx.sessionId,
    sourceSlug,
    sourceName: source.name,
    service,
  };

  // Trigger auth request
  ctx.callbacks.onAuthRequest(authRequest);

  return successResponse(
    `Slack OAuth requested for '${source.name}'. Opening browser for authentication.`
  );
}

// ============================================================
// Microsoft OAuth Trigger
// ============================================================

export interface MicrosoftOAuthTriggerArgs {
  sourceSlug: string;
}

/**
 * Handle the source_microsoft_oauth_trigger tool call.
 * Triggers Microsoft OAuth for Outlook, OneDrive, Teams, etc.
 */
export async function handleMicrosoftOAuthTrigger(
  ctx: SessionToolContext,
  args: MicrosoftOAuthTriggerArgs
): Promise<ToolResult> {
  const { sourceSlug } = args;

  // Load source config
  const source = ctx.loadSourceConfig(sourceSlug);
  if (!source) {
    return errorResponse(`Source '${sourceSlug}' not found.`);
  }

  // Verify this is a Microsoft source
  if (source.provider !== 'microsoft') {
    const hint = !source.provider
      ? `Add "provider": "microsoft" to config.json and retry.`
      : `This source has provider '${source.provider}'.`;
    return errorResponse(
      `Source '${sourceSlug}' is not configured as a Microsoft API source. ${hint}`
    );
  }

  // Without the built-in app (builds without MICROSOFT_OAUTH_CLIENT_ID), the source needs its own
  if (ctx.isMicrosoftOAuthConfigured && !ctx.isMicrosoftOAuthConfigured(source.api?.microsoftOAuthClientId)) {
    return errorResponse(
      `Microsoft OAuth is not configured for source '${sourceSlug}': this build has no built-in Microsoft app.

Register your own app in the Microsoft Entra admin center (App registrations → New registration):
- Platform "Mobile and desktop applications" with the redirect URIs https://thecraftagents.com/auth/callback and http://localhost/callback
- No client secret

Then add its IDs to the source's config.json:
\`\`\`json
{
  "api": {
    "microsoftOAuthClientId": "YOUR_APPLICATION_CLIENT_ID",
    "microsoftTenantId": "YOUR_TENANT_ID"
  }
}
\`\`\`
\`microsoftTenantId\` is needed only when the app accepts accounts of a single organization; without it the sign-in uses "common".`
    );
  }

  // A valid or refreshable token needs no sign-in card
  const ready = await reuseOrRefreshToken(ctx, source);
  if (ready) return ready;

  // What the sign-in asks for (credential manager prepareOAuth): the source's microsoftScopes,
  // else the scopes of its service, explicit or inferred from the base URL. config.json is not
  // validated on load, so a service that doesn't exist (e.g. 'calendar') is refused here, where
  // the agent can still fix the config, rather than when the sign-in starts.
  const hasScopes = Boolean(source.api?.microsoftScopes?.length);
  const service: string | undefined = source.api?.microsoftService || ctx.inferMicrosoftService?.(source.api?.baseUrl);
  if (!hasScopes && !service) {
    return errorResponse(`Cannot determine Microsoft service for source '${sourceSlug}'. ${MICROSOFT_SCOPES_RULE}`);
  }
  if (!hasScopes && !isMicrosoftService(service)) {
    return errorResponse(`Unknown microsoftService '${service}' for source '${sourceSlug}'. ${MICROSOFT_SCOPES_RULE}`);
  }

  // Build auth request
  const authRequest: MicrosoftOAuthAuthRequest = {
    type: 'oauth-microsoft',
    requestId: generateRequestId('microsoft-oauth'),
    sessionId: ctx.sessionId,
    sourceSlug,
    sourceName: source.name,
    service: isMicrosoftService(service) ? service : undefined,
  };

  // Trigger auth request
  ctx.callbacks.onAuthRequest(authRequest);

  return successResponse(
    `Microsoft OAuth requested for '${source.name}'. Opening browser for authentication.`
  );
}
