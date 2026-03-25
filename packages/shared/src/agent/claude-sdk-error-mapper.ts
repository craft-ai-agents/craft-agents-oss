import type { SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk';
import type { AgentError } from './errors.ts';
import type { LastApiError } from '../interceptor-common.ts';

export interface ClaudeSdkApiError {
  errorType: string;
  message: string;
  requestId?: string;
}

export interface ClaudeSdkErrorContext {
  actualError: ClaudeSdkApiError | null;
  capturedApiError: LastApiError | null;
}

type FailureKind = 'provider' | 'network' | 'unknown';

const PROVIDER_HINTS = [
  'internal server error',
  'overloaded',
  'service unavailable',
  'bad gateway',
  'gateway timeout',
  'api_error',
  'overloaded_error',
  'upstream',
] as const;

const NETWORK_HINTS = [
  'fetch failed',
  'network',
  'econnrefused',
  'enotfound',
  'timed out',
  'timeout',
  'dns',
  'connection reset',
  'connection refused',
] as const;

function normalize(value?: string | null): string {
  return value?.toLowerCase() ?? '';
}

function includesAny(text: string, hints: readonly string[]): boolean {
  return hints.some((hint) => text.includes(hint));
}

function formatStatus(error: LastApiError): string {
  return error.statusText?.trim()
    ? `${error.status} ${error.statusText}`
    : String(error.status);
}

function buildApiDetails(context: ClaudeSdkErrorContext): string[] {
  const details: string[] = [];

  const add = (value?: string) => {
    if (!value) return;
    if (!details.includes(value)) details.push(value);
  };

  if (context.capturedApiError) {
    add(`Status: ${formatStatus(context.capturedApiError)}`);
    if (context.capturedApiError.message && context.capturedApiError.message !== context.capturedApiError.statusText) {
      add(`API message: ${context.capturedApiError.message}`);
    }
  }

  if (context.actualError?.message) {
    add(`Error: ${context.actualError.message}`);
  }

  if (context.actualError?.errorType) {
    add(`Type: ${context.actualError.errorType}`);
  }

  if (context.actualError?.requestId) {
    add(`Request ID: ${context.actualError.requestId}`);
  }

  return details;
}

function classifyFailure(errorCode: SDKAssistantMessageError, context: ClaudeSdkErrorContext): FailureKind {
  const status = context.capturedApiError?.status;
  const actualType = normalize(context.actualError?.errorType);
  const actualMessage = normalize(context.actualError?.message);
  const capturedMessage = normalize(context.capturedApiError?.message);

  const hasProviderStatus = typeof status === 'number' && (status >= 500 || status === 529);
  const hasProviderType =
    actualType.includes('api_error') ||
    actualType.includes('overloaded') ||
    actualType.includes('server_error');
  const hasProviderText =
    includesAny(actualMessage, PROVIDER_HINTS) ||
    includesAny(capturedMessage, PROVIDER_HINTS);
  const hasNetworkText =
    includesAny(actualMessage, NETWORK_HINTS) ||
    includesAny(capturedMessage, NETWORK_HINTS);

  // SDK explicit server_error should be treated as provider-side unless we have strong
  // evidence of local network failure and no provider-side signal.
  if (errorCode === 'server_error') {
    if (hasNetworkText && !hasProviderStatus && !hasProviderType && !hasProviderText) {
      return 'network';
    }
    return 'provider';
  }

  if (hasProviderStatus || hasProviderType || hasProviderText) {
    return 'provider';
  }

  if (hasNetworkText) {
    return 'network';
  }

  return 'unknown';
}

export function mapClaudeSdkAssistantError(
  errorCode: SDKAssistantMessageError,
  context: ClaudeSdkErrorContext,
): AgentError {
  const apiDetails = buildApiDetails(context);
  const failureKind = classifyFailure(errorCode, context);

  const retryAction = [{ key: 'r', label: 'Retry', action: 'retry' as const }];

  const providerError: AgentError = {
    code: 'provider_error',
    title: 'AI Provider Issue',
    message: 'The AI provider may be experiencing temporary issues. Please retry in a moment.',
    details: [
      ...apiDetails,
      'Your credentials and local setup may still be correct.',
    ],
    actions: retryAction,
    canRetry: true,
    retryDelayMs: 5000,
  };

  const networkError: AgentError = {
    code: 'network_error',
    title: 'Connection Error',
    message: 'Unable to connect to the API server. Check your internet connection.',
    details: [
      ...apiDetails,
      'Verify your network connection is active',
      'Firewall or VPN may be blocking the connection',
    ],
    actions: retryAction,
    canRetry: true,
    retryDelayMs: 2000,
  };

  switch (errorCode) {
    case 'authentication_failed':
      return {
        code: 'invalid_api_key',
        title: 'Authentication Failed',
        message: 'Unable to authenticate. Your API key may be invalid or expired.',
        details: ['Check your API key in settings', 'Ensure your API key has not been revoked'],
        actions: [
          { key: 's', label: 'Settings', action: 'settings' },
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 1000,
      };

    case 'billing_error':
      return {
        code: 'billing_error',
        title: 'Billing Error',
        message: 'Your account has a billing issue.',
        details: ['Check your account billing status'],
        actions: [{ key: 's', label: 'Update credentials', action: 'settings' }],
        canRetry: false,
      };

    case 'rate_limit':
      return {
        code: 'rate_limited',
        title: 'Rate Limit Exceeded',
        message: 'Too many requests. Please wait a moment before trying again.',
        details: ['Rate limits reset after a short period', 'Consider upgrading your plan for higher limits'],
        actions: retryAction,
        canRetry: true,
        retryDelayMs: 5000,
      };

    case 'invalid_request':
      return {
        code: 'invalid_request',
        title: 'Invalid Request',
        message: 'The API rejected this request.',
        details: [
          ...apiDetails,
          'Try removing any attachments and resending',
          'Check if images are in a supported format (PNG, JPEG, GIF, WebP)',
        ],
        actions: retryAction,
        canRetry: true,
        retryDelayMs: 1000,
      };

    case 'server_error':
      return failureKind === 'network' ? networkError : providerError;

    case 'max_output_tokens':
      return {
        code: 'invalid_request',
        title: 'Output Too Large',
        message: 'The response exceeded the maximum output token limit.',
        details: ['Try breaking the task into smaller parts', 'Reduce the scope of the request'],
        actions: retryAction,
        canRetry: true,
        retryDelayMs: 1000,
      };

    case 'unknown': {
      if (failureKind === 'provider') {
        return providerError;
      }

      if (failureKind === 'network') {
        return networkError;
      }

      return {
        code: 'unknown_error',
        title: 'Unknown Error',
        message: 'An unexpected error occurred.',
        details: [
          ...apiDetails,
          'This may be a temporary issue',
          'Check your network connection',
        ],
        actions: retryAction,
        canRetry: true,
        retryDelayMs: 2000,
      };
    }

    default:
      return {
        code: 'unknown_error',
        title: 'Unknown Error',
        message: 'An unexpected error occurred.',
        details: [
          ...apiDetails,
          'This may be a temporary issue',
          'Check your network connection',
        ],
        actions: retryAction,
        canRetry: true,
        retryDelayMs: 2000,
      };
  }
}
