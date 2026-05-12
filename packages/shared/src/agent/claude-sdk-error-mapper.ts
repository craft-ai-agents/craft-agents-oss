import type { SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk';
import type { AgentError } from './errors.ts';
import type { LastApiError } from '../interceptor-common.ts';
import { getProviderMetadata, getProviderDisplayName } from '../config/provider-metadata.ts';

export interface ClaudeSdkApiError {
  errorType: string;
  message: string;
  requestId?: string;
}

export interface ClaudeSdkErrorContext {
  actualError: ClaudeSdkApiError | null;
  capturedApiError: LastApiError | null;
  providerType?: string;
  piAuthProvider?: string;
  /**
   * True when the just-sent user turn included image/PDF attachments. Used to
   * decide whether the generic invalid_request fallback should mention
   * attachments at all — when the user sent a plain-text turn, attachment
   * advice is misleading.
   */
  userTurnHadAttachments?: boolean;
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

// Signals specific to the 1M context beta. When these fire, the user is told
// to disable "Extended Context (1M)" in settings — only correct for users on
// the 1M tier, so the matcher must be precise.
const ONE_M_CONTEXT_HINTS = [
  'context-1m',
  'context_1m',
] as const;

// Phrases that, when paired with the word "tier", confirm the error is about
// 1M context access specifically (vs. tier-gated images, models, audio,
// document support, etc.). The bare word "tier" is far too broad on its own.
const ONE_M_TIER_PHRASES = [
  'context',
  '1m',
  'extended',
  '200k',
  '1000k',
] as const;

// Signals that the request exceeded the model's context window in general,
// not specifically 1M. These map to a "Context Window Exceeded" error with
// /compact + new-session advice — appropriate for any tier.
const CONTEXT_OVERFLOW_HINTS = [
  'context window',
  'context_window',
  'exceeds the context',
  'prompt is too long',
  'prompt exceeds',
  'too many tokens',
  'maximum context',
  'context length',
  'input is too long',
] as const;

// Phrases that indicate the API actually rejected an attachment (vs. a
// generic context/format issue mislabeled as invalid_request). Only when one
// of these fires — or the user-sent turn included an attachment — do we
// surface attachment-specific advice.
const ATTACHMENT_REJECTION_HINTS = [
  'image',
  'attachment',
  'media',
  'unsupported format',
  'could not process',
] as const;

function isOneMContextError(context: ClaudeSdkErrorContext): boolean {
  const haystack = [
    normalize(context.capturedApiError?.message),
    normalize(context.actualError?.message),
  ].join(' ');
  if (includesAny(haystack, ONE_M_CONTEXT_HINTS)) return true;
  // "tier" alone is ambiguous — only counts as 1M when it co-occurs with a
  // context-window-specific phrase. Image/model/audio/feature-tier errors
  // are deliberately excluded.
  if (haystack.includes('tier') && includesAny(haystack, ONE_M_TIER_PHRASES)) {
    return true;
  }
  return false;
}

function isContextOverflowError(context: ClaudeSdkErrorContext): boolean {
  const haystack = [
    normalize(context.capturedApiError?.message),
    normalize(context.actualError?.message),
  ].join(' ');
  return includesAny(haystack, CONTEXT_OVERFLOW_HINTS);
}

function isAttachmentRejection(context: ClaudeSdkErrorContext): boolean {
  const haystack = [
    normalize(context.capturedApiError?.message),
    normalize(context.actualError?.message),
  ].join(' ');
  return includesAny(haystack, ATTACHMENT_REJECTION_HINTS);
}

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
  const providerInfo = getProviderMetadata(
    context.providerType ?? 'anthropic',
    context.piAuthProvider,
  ) ?? undefined;

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
    providerInfo,
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
    providerInfo,
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
        providerInfo,
      };

    case 'billing_error':
      return {
        code: 'billing_error',
        title: 'Billing Error',
        message: 'Your account has a billing issue.',
        details: ['Check your account billing status'],
        actions: [{ key: 's', label: 'Update credentials', action: 'settings' }],
        canRetry: false,
        providerInfo,
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
        providerInfo,
      };

    case 'invalid_request': {
      if (isOneMContextError(context)) {
        return {
          code: 'invalid_request',
          title: '1M Context Not Available',
          message: 'The request exceeded the standard 200K context window, and 1M context is not available on your API tier.',
          details: [
            ...apiDetails,
            'Disable "Extended Context (1M)" in AI Settings → Performance',
            'Or start a new conversation, or run /compact to reduce context',
          ],
          actions: [
            { key: 's', label: 'Settings', action: 'settings' },
            { key: 'c', label: 'Compact', command: '/compact' },
          ],
          // Retrying the same payload won't help — user must change settings
          // or compact history first. Hiding the button is correct UX.
          canRetry: false,
          providerInfo,
        };
      }

      if (isContextOverflowError(context)) {
        return {
          code: 'invalid_request',
          title: 'Context Window Exceeded',
          message: 'The conversation has grown larger than the model can handle.',
          details: [
            ...apiDetails,
            'Run /compact to summarize history and free up context',
            'Or start a new conversation to keep going',
          ],
          actions: [
            { key: 'c', label: 'Compact', command: '/compact' },
          ],
          // Same as 1M case: retrying without changing the payload hits the
          // same wall, so suppress the button.
          canRetry: false,
          providerInfo,
        };
      }

      // Generic fallback. Only surface attachment hints when the API actually
      // mentioned an attachment-shaped problem OR the user-sent turn included
      // attachments. Otherwise the "remove attachments" advice misleads users
      // whose conversation history is poisoned by oversized tool results.
      const showAttachmentHints =
        context.userTurnHadAttachments === true || isAttachmentRejection(context);
      const fallbackHints: string[] = [];
      if (showAttachmentHints) {
        fallbackHints.push('Try removing any attachments and resending');
        fallbackHints.push('Check if images are in a supported format (PNG, JPEG, GIF, WebP)');
      } else {
        fallbackHints.push('If this keeps repeating, the conversation may have grown too large — try /compact or start a new session');
      }
      // When neither error source provided detail, tell the user where to look
      // instead of leaving them with vague advice.
      if (apiDetails.length === 0) {
        fallbackHints.push("No detailed error info available — check the app's main process log for the raw response");
      }

      return {
        code: 'invalid_request',
        title: 'Invalid Request',
        message: 'The API rejected this request.',
        details: [...apiDetails, ...fallbackHints],
        actions: retryAction,
        canRetry: true,
        retryDelayMs: 1000,
        providerInfo,
      };
    }

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
        providerInfo,
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
        providerInfo,
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
        providerInfo,
      };
  }
}
