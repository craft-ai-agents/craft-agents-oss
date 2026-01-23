/**
 * Typed errors for better error handling and user-friendly messages.
 *
 * These error types map HTTP status codes and error patterns to
 * actionable error information that can be displayed to users.
 */

export type ErrorCode =
  | 'invalid_api_key'
  | 'invalid_credentials'    // Generic credential issue (from diagnostics)
  | 'expired_oauth_token'
  | 'token_expired'          // Workspace token expired (from diagnostics)
  | 'rate_limited'
  | 'service_error'
  | 'service_unavailable'    // Service unavailable (from diagnostics)
  | 'network_error'
  | 'mcp_auth_required'
  | 'mcp_unreachable'        // MCP server unreachable (from diagnostics)
  | 'billing_error'          // HTTP 402 Payment Required
  | 'model_no_tool_support'  // Model doesn't support tool/function calling
  | 'invalid_model'          // Model ID not found
  | 'data_policy_error'      // OpenRouter data policy restriction
  | 'unknown_error';

export interface RecoveryAction {
  /** Keyboard shortcut (single letter) */
  key: string;
  /** Description of the action */
  label: string;
  /** Slash command to execute (e.g., '/settings') */
  command?: string;
  /** Custom action type for special handling */
  action?: 'retry' | 'settings' | 'reauth';
}

export interface AgentError {
  /** Error code for programmatic handling */
  code: ErrorCode;
  /** User-friendly title */
  title: string;
  /** Detailed message explaining what went wrong */
  message: string;
  /** Suggested recovery actions */
  actions: RecoveryAction[];
  /** Whether auto-retry is possible */
  canRetry: boolean;
  /** Retry delay in ms (if canRetry is true) */
  retryDelayMs?: number;
  /** Original error message for debugging */
  originalError?: string;
  /** Diagnostic check results for debugging */
  details?: string[];
}

/**
 * Error definitions with user-friendly messages and recovery actions
 */
const ERROR_DEFINITIONS: Record<ErrorCode, Omit<AgentError, 'code' | 'originalError' | 'details'>> = {
  invalid_api_key: {
    title: 'Invalid API Key',
    message: 'Your Anthropic API key was rejected. It may be invalid or expired.',
    actions: [
      { key: 's', label: 'Update API key', command: '/settings', action: 'settings' },
    ],
    canRetry: false,
  },
  invalid_credentials: {
    title: 'Invalid Credentials',
    message: 'Your API key or OAuth token is missing or invalid.',
    actions: [
      { key: 's', label: 'Update credentials', command: '/settings', action: 'settings' },
    ],
    canRetry: false,
  },
  expired_oauth_token: {
    title: 'Session Expired',
    message: 'Your Claude Max session has expired.',
    actions: [
      { key: 'r', label: 'Re-authenticate', action: 'reauth' },
      { key: 's', label: 'Switch API setup', command: '/settings', action: 'settings' },
    ],
    canRetry: false,
  },
  token_expired: {
    title: 'Workspace Session Expired',
    message: 'Your workspace authentication has expired. Please re-authenticate the workspace.',
    actions: [
      { key: 'w', label: 'Open workspace menu', command: '/workspace' },
    ],
    canRetry: false,
  },
  rate_limited: {
    title: 'Rate Limited',
    message: 'Too many requests. Please wait a moment.',
    actions: [
      { key: 'r', label: 'Retry', action: 'retry' },
    ],
    canRetry: true,
    retryDelayMs: 5000,
  },
  service_error: {
    title: 'Service Error',
    message: 'The AI service is temporarily unavailable.',
    actions: [
      { key: 'r', label: 'Retry', action: 'retry' },
    ],
    canRetry: true,
    retryDelayMs: 2000,
  },
  service_unavailable: {
    title: 'Service Unavailable',
    message: 'The AI service is experiencing issues. All credentials appear valid. Try again in a moment.',
    actions: [
      { key: 'r', label: 'Retry', action: 'retry' },
    ],
    canRetry: true,
    retryDelayMs: 2000,
  },
  network_error: {
    title: 'Connection Error',
    message: 'Could not connect to the server. Check your internet connection.',
    actions: [
      { key: 'r', label: 'Retry', action: 'retry' },
    ],
    canRetry: true,
    retryDelayMs: 1000,
  },
  mcp_auth_required: {
    title: 'Workspace Authentication Required',
    message: 'Your workspace connection needs to be re-authenticated.',
    actions: [
      { key: 'w', label: 'Open workspace menu', command: '/workspace' },
    ],
    canRetry: false,
  },
  mcp_unreachable: {
    title: 'MCP Server Unreachable',
    message: 'Cannot connect to the Craft MCP server. Check your network connection.',
    actions: [
      { key: 'r', label: 'Retry', action: 'retry' },
    ],
    canRetry: true,
    retryDelayMs: 2000,
  },
  billing_error: {
    title: 'Payment Required',
    message: 'Your account has a billing issue. Check your Anthropic account status.',
    actions: [
      { key: 's', label: 'Update credentials', command: '/settings', action: 'settings' },
    ],
    canRetry: false,
  },
  model_no_tool_support: {
    title: 'Model Does Not Support Tools',
    message: 'The selected model does not support tool/function calling, which is required for Craft Agent. Please choose a model with tool support (e.g., Claude, GPT-4, Gemini).',
    actions: [
      { key: 's', label: 'Change model', command: '/settings', action: 'settings' },
    ],
    canRetry: false,
  },
  invalid_model: {
    title: 'Invalid Model',
    message: 'The selected model was not found. Please check your model configuration in settings.',
    actions: [
      { key: 's', label: 'Change model', command: '/settings', action: 'settings' },
    ],
    canRetry: false,
  },
  data_policy_error: {
    title: 'Data Policy Restriction',
    message: 'OpenRouter blocked this request due to your data policy settings. Configure your privacy settings at openrouter.ai/settings/privacy to allow this model.',
    actions: [
      { key: 's', label: 'Open Settings', command: '/settings', action: 'settings' },
    ],
    canRetry: false,
  },
  unknown_error: {
    title: 'Error',
    message: 'An unexpected error occurred.',
    actions: [
      { key: 'r', label: 'Retry', action: 'retry' },
    ],
    canRetry: true,
  },
};

/**
 * Extract all error messages from an error object, including nested causes.
 */
function extractErrorMessages(error: unknown): string {
  const messages: string[] = [];

  if (error instanceof Error) {
    messages.push(error.message);

    // Check for nested cause (ES2022 Error.cause)
    if ('cause' in error && error.cause) {
      messages.push(extractErrorMessages(error.cause));
    }

    // Check for stdout/stderr (common in subprocess errors)
    const anyError = error as unknown as Record<string, unknown>;
    if (typeof anyError.stdout === 'string') messages.push(anyError.stdout);
    if (typeof anyError.stderr === 'string') messages.push(anyError.stderr);
    if (typeof anyError.output === 'string') messages.push(anyError.output);
  } else {
    messages.push(String(error));
  }

  return messages.join(' ');
}

/**
 * Parse an error and return a typed AgentError with user-friendly info
 */
export function parseError(error: unknown): AgentError {
  // Extract all error messages including nested causes and subprocess output
  const fullErrorText = extractErrorMessages(error);
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = fullErrorText.toLowerCase();

  // Detect error type from message/status
  let code: ErrorCode = 'unknown_error';

  // Check for OpenRouter data policy errors first (these contain "no endpoints" which could confuse other checks)
  if (lowerMessage.includes('data policy') || lowerMessage.includes('privacy')) {
    code = 'data_policy_error';
  // Check for model-specific errors (OpenRouter, etc.)
  // Tool support errors must be checked BEFORE model errors since tool errors often contain "model"
  } else if (
    lowerMessage.includes('no endpoints found that support tool use') ||
    lowerMessage.includes('does not support tool') ||
    lowerMessage.includes('tool_use is not supported') ||
    lowerMessage.includes('function calling not available') ||
    lowerMessage.includes('tools are not supported') ||
    lowerMessage.includes('doesn\'t support tool') ||
    lowerMessage.includes('tool use is not supported') ||
    (lowerMessage.includes('invalid_request_error') && lowerMessage.includes('tool')) ||
    // Generic pattern: "tool" + "not" + "support" anywhere in message
    (lowerMessage.includes('tool') && lowerMessage.includes('not') && lowerMessage.includes('support'))
  ) {
    code = 'model_no_tool_support';
  } else if (lowerMessage.includes('is not a valid model') || lowerMessage.includes('model not found') || lowerMessage.includes('invalid model')) {
    code = 'invalid_model';
  // Check for specific HTTP status codes or patterns
  } else if (lowerMessage.includes('402') || lowerMessage.includes('payment required')) {
    code = 'billing_error';
  } else if (lowerMessage.includes('401') || lowerMessage.includes('unauthorized') || lowerMessage.includes('invalid api key') || lowerMessage.includes('invalid x-api-key') || lowerMessage.includes('authentication failed')) {
    // Distinguish between API key and OAuth errors
    if (lowerMessage.includes('oauth') || lowerMessage.includes('token') || lowerMessage.includes('session')) {
      code = 'expired_oauth_token';
    } else {
      code = 'invalid_api_key';
    }
  } else if (lowerMessage.includes('429') || lowerMessage.includes('rate limit') || lowerMessage.includes('too many requests')) {
    code = 'rate_limited';
  } else if (lowerMessage.includes('500') || lowerMessage.includes('502') || lowerMessage.includes('503') || lowerMessage.includes('504') || lowerMessage.includes('internal server error') || lowerMessage.includes('service unavailable')) {
    code = 'service_error';
  } else if (lowerMessage.includes('network') || lowerMessage.includes('econnrefused') || lowerMessage.includes('enotfound') || lowerMessage.includes('fetch failed') || lowerMessage.includes('connection')) {
    code = 'network_error';
  } else if (lowerMessage.includes('mcp') && (lowerMessage.includes('auth') || lowerMessage.includes('401'))) {
    code = 'mcp_auth_required';
  } else if (lowerMessage.includes('exited with code') || lowerMessage.includes('process exited')) {
    // SDK subprocess crashed - likely auth/setup issue
    // Check if the error contains more specific info
    if (lowerMessage.includes('api') || lowerMessage.includes('key') || lowerMessage.includes('credential')) {
      code = 'invalid_api_key';
    } else {
      code = 'service_error';
    }
  }

  const definition = ERROR_DEFINITIONS[code];

  // For model_no_tool_support errors, try to extract the model name for a more helpful message
  if (code === 'model_no_tool_support') {
    // Try to extract model name from various error message formats
    // Common patterns: "model: xxx", "model 'xxx'", "model \"xxx\"", "model xxx does not"
    const modelMatch = fullErrorText.match(/model[:\s]+["']?([a-zA-Z0-9\-_/:.]+)["']?/i) ||
                       fullErrorText.match(/["']([a-zA-Z0-9\-_/:.]+)["']\s+does not support/i);
    if (modelMatch?.[1]) {
      return {
        code,
        ...definition,
        message: `Model "${modelMatch[1]}" does not support tool/function calling, which is required for Craft Agent. Please choose a different model with tool support in Settings.`,
        originalError: errorMessage,
      };
    }
  }

  return {
    code,
    ...definition,
    originalError: errorMessage,
  };
}

/**
 * Check if an error is a billing/auth error that blocks usage
 */
export function isBillingError(error: AgentError): boolean {
  return error.code === 'billing_error' || error.code === 'invalid_api_key' || error.code === 'expired_oauth_token';
}

/**
 * Check if an error can be automatically retried
 */
export function canAutoRetry(error: AgentError): boolean {
  return error.canRetry && error.retryDelayMs !== undefined;
}

/**
 * Parse SDK error text and return a typed AgentError if detected.
 *
 * The SDK emits errors in two distinctive formats:
 * 1. "Error title · Action hint" - using middle dot (·, U+00B7) separator
 *    e.g., "Invalid API key · Fix external API key"
 * 2. "API Error: {status} {json}" - raw API error dump
 *    e.g., "API Error: 402 {"error":{"code":402,"message":"Payment required"}}"
 *
 * Returns null if text is not an SDK error.
 */
export function parseSDKErrorText(text: string): AgentError | null {
  const trimmed = text.trim();
  const isSingleLine = !trimmed.includes('\n');
  const isShortMessage = trimmed.length < 200;

  // Format 1: Raw API error (e.g., "API Error: 402 {...}")
  // Extract status code and use it to determine error type
  if (trimmed.startsWith('API Error:') && isSingleLine) {
    const statusMatch = trimmed.match(/API Error:\s*(\d{3})/);
    if (statusMatch) {
      const statusCode = parseInt(statusMatch[1]!, 10);
      // Create error message with status code for parseError to detect
      return parseError(new Error(`${statusCode} ${trimmed}`));
    }
    // Fallback: just use the raw message
    return parseError(new Error(trimmed));
  }

  // Format 2: Middle dot separator (e.g., "Invalid API key · Fix external API key")
  if (trimmed.includes(' · ') && isShortMessage && isSingleLine) {
    // The text before · is the error title, use it for parsing
    return parseError(new Error(trimmed));
  }

  return null;
}

/**
 * Quick check if text looks like an SDK error (for filtering).
 */
export function isSDKErrorText(text: string): boolean {
  return parseSDKErrorText(text) !== null;
}
