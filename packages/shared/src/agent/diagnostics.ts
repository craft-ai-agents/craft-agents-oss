/**
 * Error diagnostics - runs quick checks to identify the specific cause
 * of a generic "process exited" error from the SDK.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getAiCreditsBalance } from '../auth/balance.ts';
import { isWorkspaceTokenExpiredAsync, loadStoredConfig, getAnthropicApiKey, getClaudeOAuthToken, type AuthType } from '../config/storage.ts';
import { getCredentialManager } from '../credentials/index.ts';

export type DiagnosticCode =
  | 'credits_exhausted'
  | 'token_expired'
  | 'invalid_credentials'
  | 'mcp_unreachable'
  | 'service_unavailable'
  | 'unknown_error';

export interface DiagnosticResult {
  code: DiagnosticCode;
  title: string;
  message: string;
  /** Diagnostic check results for debugging (e.g., "✓ Credits: 150") */
  details: string[];
}

interface DiagnosticConfig {
  authType?: AuthType;
  workspaceId?: string;
  mcpUrl?: string;
  rawError: string;
}

interface CheckResult {
  ok: boolean;
  detail: string;
  failCode?: DiagnosticCode;
  failTitle?: string;
  failMessage?: string;
}

/** Run a check with a timeout, returns default result if times out */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, defaultValue: T): Promise<T> {
  const timeoutPromise = new Promise<T>((resolve) => setTimeout(() => resolve(defaultValue), timeoutMs));
  return Promise.race([promise, timeoutPromise]);
}

/** Check Craft credits balance */
async function checkCredits(): Promise<CheckResult> {
  try {
    const result = await getAiCreditsBalance();
    if (result === null) {
      return { ok: true, detail: '✓ Credits: Unable to check (no team)' };
    }
    if (result.credits <= 0) {
      return {
        ok: false,
        detail: `✗ Credits: ${result.credits} (exhausted)`,
        failCode: 'credits_exhausted',
        failTitle: 'Craft Credits Exhausted',
        failMessage: 'Your Craft AI credits have run out. Add more credits or switch to an API key.',
      };
    }
    return { ok: true, detail: `✓ Credits: ${result.credits}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: true, detail: `✓ Credits: Check failed (${msg})` }; // Treat failure as "not the problem"
  }
}

/** Check workspace token expiry */
async function checkWorkspaceToken(workspaceId: string): Promise<CheckResult> {
  try {
    const isExpired = await isWorkspaceTokenExpiredAsync(workspaceId);
    if (isExpired) {
      return {
        ok: false,
        detail: '✗ Workspace token: Expired',
        failCode: 'token_expired',
        failTitle: 'Workspace Session Expired',
        failMessage: 'Your workspace authentication has expired. Please re-authenticate the workspace.',
      };
    }
    return { ok: true, detail: '✓ Workspace token: Valid' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: true, detail: `✓ Workspace token: Check failed (${msg})` };
  }
}

/**
 * Validate an API key by making a test request to Anthropic.
 * Uses models.list() which is lightweight and doesn't incur AI costs.
 */
async function validateApiKeyWithAnthropic(apiKey: string): Promise<CheckResult> {
  try {
    const client = new Anthropic({ apiKey });
    const result = await client.models.list();
    const modelCount = result.data?.length ?? 0;
    return {
      ok: true,
      detail: `✓ API key: Valid (${modelCount} models available)`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    // 401 = Invalid key
    if (msg.includes('401') || msg.includes('invalid') || msg.includes('Unauthorized') || msg.includes('authentication')) {
      return {
        ok: false,
        detail: '✗ API key: Invalid or expired',
        failCode: 'invalid_credentials',
        failTitle: 'Invalid API Key',
        failMessage: 'Your Anthropic API key is invalid or has expired. Please update it in settings.',
      };
    }

    // 403 = Key valid but no permission
    if (msg.includes('403') || msg.includes('permission') || msg.includes('Forbidden')) {
      return {
        ok: false,
        detail: '✗ API key: Insufficient permissions',
        failCode: 'invalid_credentials',
        failTitle: 'API Key Permission Error',
        failMessage: 'Your API key does not have permission to access the API. Check your Anthropic dashboard.',
      };
    }

    // Network/other errors - don't fail on these, just note them
    return {
      ok: true,
      detail: `✓ API key: Validation skipped (${msg.slice(0, 50)})`,
    };
  }
}

/** Check API key presence and validity */
async function checkApiKey(): Promise<CheckResult> {
  try {
    const apiKey = await getAnthropicApiKey();
    if (!apiKey) {
      return {
        ok: false,
        detail: '✗ API key: Not found',
        failCode: 'invalid_credentials',
        failTitle: 'API Key Missing',
        failMessage: 'Your Anthropic API key is missing. Please add it in settings.',
      };
    }

    // Actually validate the key works
    return await validateApiKeyWithAnthropic(apiKey);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: true, detail: `✓ API key: Check failed (${msg})` };
  }
}

/** Check OAuth token presence */
async function checkOAuthToken(): Promise<CheckResult> {
  try {
    const token = await getClaudeOAuthToken();
    if (!token) {
      return {
        ok: false,
        detail: '✗ OAuth token: Not found',
        failCode: 'invalid_credentials',
        failTitle: 'OAuth Token Missing',
        failMessage: 'Your Claude Max OAuth token is missing. Please re-authenticate.',
      };
    }
    return { ok: true, detail: '✓ OAuth token: Present' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: true, detail: `✓ OAuth token: Check failed (${msg})` };
  }
}

/** Check MCP server connectivity with a quick HEAD request */
async function checkMcpConnectivity(mcpUrl: string): Promise<CheckResult> {
  try {
    // Parse the URL to get just the base server
    const url = new URL(mcpUrl);
    const baseUrl = `${url.protocol}//${url.host}`;

    // Quick HEAD request with short timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(baseUrl, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Any response (even 4xx) means the server is reachable
      return { ok: true, detail: `✓ MCP server: Reachable (${response.status})` };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return {
          ok: false,
          detail: '✗ MCP server: Timeout',
          failCode: 'mcp_unreachable',
          failTitle: 'MCP Server Unreachable',
          failMessage: 'Cannot connect to the Craft MCP server (timeout). Check your network connection.',
        };
      }
      const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      // Check for common network errors
      if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('fetch failed')) {
        return {
          ok: false,
          detail: `✗ MCP server: Unreachable (${msg})`,
          failCode: 'mcp_unreachable',
          failTitle: 'MCP Server Unreachable',
          failMessage: 'Cannot connect to the Craft MCP server. Check your network connection.',
        };
      }
      return { ok: true, detail: `✓ MCP server: Unknown (${msg})` };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: true, detail: `✓ MCP server: Check failed (${msg})` };
  }
}

/** Check if Craft token is present (for craft_credits auth) */
async function checkCraftToken(): Promise<CheckResult> {
  try {
    const manager = getCredentialManager();
    const token = await manager.getCraftOAuth();
    if (!token) {
      return {
        ok: false,
        detail: '✗ Craft token: Not found',
        failCode: 'invalid_credentials',
        failTitle: 'Craft Authentication Missing',
        failMessage: 'Your Craft authentication is missing. Please log in again.',
      };
    }
    return { ok: true, detail: '✓ Craft token: Present' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: true, detail: `✓ Craft token: Check failed (${msg})` };
  }
}

/**
 * Validate the Craft AI gateway by making a test request.
 * The gateway uses the Anthropic API format but authenticates via Craft token.
 */
async function validateCraftGateway(): Promise<CheckResult> {
  try {
    const manager = getCredentialManager();
    const token = await manager.getCraftOAuth();
    if (!token) {
      // Already handled by checkCraftToken, skip validation
      return { ok: true, detail: '✓ Craft gateway: Skipped (no token)' };
    }

    // Test the gateway by making a models.list() request through it
    const client = new Anthropic({
      apiKey: 'craft-credits-placeholder', // Required by SDK but ignored by gateway
      baseURL: 'https://gateway.craft.do/v1',
      defaultHeaders: {
        'X-Craft-Token': token, // token is already the access token string
      },
    });

    const result = await client.models.list();
    const modelCount = result.data?.length ?? 0;
    return {
      ok: true,
      detail: `✓ Craft gateway: Valid (${modelCount} models)`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    // 401/403 = Authentication failed
    if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized') || msg.includes('Forbidden')) {
      return {
        ok: false,
        detail: '✗ Craft gateway: Authentication failed',
        failCode: 'invalid_credentials',
        failTitle: 'Craft Authentication Failed',
        failMessage: 'Your Craft session may have expired. Please log in again.',
      };
    }

    // Network error or gateway down - don't fail, just note it
    return {
      ok: true,
      detail: `✓ Craft gateway: Skipped (${msg.slice(0, 50)})`,
    };
  }
}

/**
 * Run error diagnostics to identify the specific cause of a failure.
 * All checks run in parallel with timeouts (3s for API validation, 2s for others).
 */
export async function runErrorDiagnostics(config: DiagnosticConfig): Promise<DiagnosticResult> {
  const { authType, workspaceId, mcpUrl, rawError } = config;
  const details: string[] = [];
  const defaultResult: CheckResult = { ok: true, detail: '? Check: Timeout' };

  // Build list of checks to run based on config
  const checks: Promise<CheckResult>[] = [];

  // 1. Credits and gateway validation (only for craft_credits)
  if (authType === 'craft_credits') {
    checks.push(withTimeout(checkCredits(), 2000, defaultResult));
    checks.push(withTimeout(checkCraftToken(), 2000, defaultResult));
    checks.push(withTimeout(validateCraftGateway(), 3000, defaultResult)); // 3s for API call
  }

  // 2. API key check with validation (only for api_key auth)
  if (authType === 'api_key') {
    checks.push(withTimeout(checkApiKey(), 3000, defaultResult)); // 3s for API call
  }

  // 3. OAuth token check (only for oauth_token auth)
  if (authType === 'oauth_token') {
    checks.push(withTimeout(checkOAuthToken(), 2000, defaultResult));
  }

  // 4. Workspace token check (if workspace is configured with OAuth)
  if (workspaceId) {
    const storedConfig = loadStoredConfig();
    const workspace = storedConfig?.workspaces.find(w => w.id === workspaceId);
    const mcpAuthType = workspace?.mcpAuthType ?? 'workspace_oauth';

    if (mcpAuthType === 'workspace_oauth') {
      checks.push(withTimeout(checkWorkspaceToken(workspaceId), 2000, defaultResult));
    }
  }

  // 5. MCP connectivity check (if URL provided)
  if (mcpUrl) {
    checks.push(withTimeout(checkMcpConnectivity(mcpUrl), 3000, defaultResult));
  }

  // Run all checks in parallel
  const results = await Promise.all(checks);

  // Collect details and find first failure
  let firstFailure: CheckResult | null = null;
  for (const result of results) {
    details.push(result.detail);
    if (!result.ok && !firstFailure) {
      firstFailure = result;
    }
  }

  // Add raw error to details
  details.push(`Raw error: ${rawError.slice(0, 200)}${rawError.length > 200 ? '...' : ''}`);

  // Return specific issue if found
  if (firstFailure && firstFailure.failCode && firstFailure.failTitle && firstFailure.failMessage) {
    return {
      code: firstFailure.failCode,
      title: firstFailure.failTitle,
      message: firstFailure.failMessage,
      details,
    };
  }

  // All checks passed but still failed - likely Anthropic service issue
  return {
    code: 'service_unavailable',
    title: 'Service Unavailable',
    message: 'The AI service is experiencing issues. All credentials appear valid. Try again in a moment.',
    details,
  };
}
