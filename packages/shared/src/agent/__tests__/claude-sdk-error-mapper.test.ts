import { describe, expect, it } from 'bun:test';
import { mapClaudeSdkAssistantError } from '../claude-sdk-error-mapper.ts';

const baseContext = {
  actualError: null,
  capturedApiError: null,
} as const;

describe('mapClaudeSdkAssistantError', () => {
  it('maps server_error to provider_error', () => {
    const error = mapClaudeSdkAssistantError('server_error', baseContext);

    expect(error.code).toBe('provider_error');
    expect(error.message.toLowerCase()).toContain('provider');
  });

  it('maps unknown + captured 500 to provider_error', () => {
    const error = mapClaudeSdkAssistantError('unknown', {
      ...baseContext,
      capturedApiError: {
        status: 500,
        statusText: 'Internal Server Error',
        message: 'Internal server error',
        timestamp: Date.now(),
      },
    });

    expect(error.code).toBe('provider_error');
    expect(error.details?.some((detail) => detail.includes('Status: 500 Internal Server Error'))).toBe(true);
  });

  it('maps unknown + captured 529 overloaded to provider_error', () => {
    const error = mapClaudeSdkAssistantError('unknown', {
      ...baseContext,
      capturedApiError: {
        status: 529,
        statusText: '',
        message: 'Overloaded',
        timestamp: Date.now(),
      },
    });

    expect(error.code).toBe('provider_error');
    expect(error.details?.some((detail) => detail.includes('Status: 529'))).toBe(true);
  });

  it('keeps unknown network failures as network_error', () => {
    const error = mapClaudeSdkAssistantError('unknown', {
      ...baseContext,
      actualError: {
        errorType: 'error',
        message: 'fetch failed: ECONNREFUSED',
      },
    });

    expect(error.code).toBe('network_error');
    expect(error.message.toLowerCase()).toContain('internet connection');
  });

  describe('invalid_request — 1M context specialization', () => {
    it('maps invalid_request with context-1m hint to 1M-context-specific error', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        capturedApiError: {
          status: 400,
          statusText: 'Bad Request',
          message: 'The beta header context-1m-2025-08-07 is not available on your tier',
          timestamp: Date.now(),
        },
      });

      expect(error.code).toBe('invalid_request');
      expect(error.title).toBe('1M Context Not Available');
      expect(error.message).toContain('200K');
      expect(error.details?.some(d => d.includes('Extended Context (1M)'))).toBe(true);
      expect(error.actions?.some(a => a.action === 'settings')).toBe(true);
    });

    it('routes generic context_window phrasing to Context Window Exceeded (not 1M)', () => {
      // Generic context-overflow without tier/1M-specific hints. The user
      // shouldn't be told to disable 1M when they may not have it enabled.
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        actualError: {
          errorType: 'invalid_request_error',
          message: 'prompt exceeds the context window for this model',
        },
      });

      expect(error.title).toBe('Context Window Exceeded');
      expect(error.details?.some(d => /compact|new session/i.test(d))).toBe(true);
    });

    it('Context Window Exceeded suppresses Retry and offers /compact', () => {
      // Retrying the same payload hits the same wall. The action should be
      // /compact, not Retry — and canRetry must be false so the UI hides
      // the retry button entirely.
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        actualError: {
          errorType: 'invalid_request_error',
          message: 'prompt is too long',
        },
      });

      expect(error.title).toBe('Context Window Exceeded');
      expect(error.canRetry).toBe(false);
      expect(error.actions?.some(a => a.action === 'retry')).toBe(false);
      expect(error.actions?.some(a => a.command === '/compact')).toBe(true);
    });

    it('1M Context Not Available offers Settings + Compact, no Retry', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        capturedApiError: {
          status: 400,
          statusText: 'Bad Request',
          message: 'context-1m beta requires a higher tier',
          timestamp: Date.now(),
        },
      });

      expect(error.title).toBe('1M Context Not Available');
      expect(error.canRetry).toBe(false);
      expect(error.actions?.some(a => a.action === 'retry')).toBe(false);
      expect(error.actions?.some(a => a.action === 'settings')).toBe(true);
      expect(error.actions?.some(a => a.command === '/compact')).toBe(true);
    });

    it('matches on tier hint when paired with a context phrase', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        capturedApiError: {
          status: 400,
          statusText: 'Bad Request',
          message: 'Your tier does not have access to 1M context',
          timestamp: Date.now(),
        },
      });

      expect(error.title).toBe('1M Context Not Available');
    });

    it('matches on tier + extended phrase', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        capturedApiError: {
          status: 400,
          statusText: 'Bad Request',
          message: 'Extended context is not available on your tier',
          timestamp: Date.now(),
        },
      });

      expect(error.title).toBe('1M Context Not Available');
    });

    it('does NOT route bare "tier does not have access to this feature" to 1M', () => {
      // Reviewer-flagged regression: bare "tier" used to fire 1M routing,
      // misleading users whose tier blocks something unrelated (audio,
      // documents, beta tools, etc.).
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        capturedApiError: {
          status: 400,
          statusText: 'Bad Request',
          message: 'Your tier does not have access to this feature',
          timestamp: Date.now(),
        },
      });

      expect(error.title).not.toBe('1M Context Not Available');
      expect(error.title).toBe('Invalid Request');
    });

    it('does NOT route "tier does not have access to this model" to 1M', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        capturedApiError: {
          status: 400,
          statusText: 'Bad Request',
          message: 'Your tier does not have access to this model',
          timestamp: Date.now(),
        },
      });

      expect(error.title).not.toBe('1M Context Not Available');
    });

    it('does NOT route "image input is not available on your tier" to 1M', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        capturedApiError: {
          status: 400,
          statusText: 'Bad Request',
          message: 'Image input is not available on your tier',
          timestamp: Date.now(),
        },
      });

      expect(error.title).not.toBe('1M Context Not Available');
      // "image" appears in the error → attachment-rejection path fires,
      // which is the correct disambiguation here.
      expect(error.title).toBe('Invalid Request');
      expect(error.details?.some(d => d.toLowerCase().includes('attachments'))).toBe(true);
    });

    it('does NOT route "this feature requires a higher tier" to 1M', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        capturedApiError: {
          status: 400,
          statusText: 'Bad Request',
          message: 'This feature requires a higher tier',
          timestamp: Date.now(),
        },
      });

      expect(error.title).not.toBe('1M Context Not Available');
    });

    it('routes "prompt is too long" to Context Window Exceeded', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        actualError: {
          errorType: 'invalid_request_error',
          message: 'prompt is too long: 250000 tokens > 200000 maximum',
        },
      });

      expect(error.title).toBe('Context Window Exceeded');
    });

    it('shows attachment hints when API explicitly mentions image format', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        capturedApiError: {
          status: 400,
          statusText: 'Bad Request',
          message: 'image format not supported',
          timestamp: Date.now(),
        },
      });

      expect(error.code).toBe('invalid_request');
      expect(error.title).toBe('Invalid Request');
      expect(error.details?.some(d => d.toLowerCase().includes('attachments'))).toBe(true);
    });

    it('shows attachment hints when the user-sent turn had attachments', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        userTurnHadAttachments: true,
      });

      expect(error.title).toBe('Invalid Request');
      expect(error.details?.some(d => d.toLowerCase().includes('attachments'))).toBe(true);
    });

    it('does NOT show attachment hints for plain-text turns with no attachment signal', () => {
      // This is the poisoned-session case: history grew too large, but the
      // current turn had no attachments and the API gave no detail. Showing
      // "remove attachments" advice misleads the user.
      const error = mapClaudeSdkAssistantError('invalid_request', baseContext);

      expect(error.title).toBe('Invalid Request');
      expect(error.details?.some(d => d.toLowerCase().includes('attachments'))).toBe(false);
      expect(error.details?.some(d => /compact|new session/i.test(d))).toBe(true);
    });

    it('appends a diagnostic pointer when no error detail is available', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', baseContext);

      expect(error.details?.some(d => /main process log/i.test(d))).toBe(true);
    });

    it('falls back to generic invalid_request when no captured/actual error info exists', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', baseContext);

      expect(error.title).toBe('Invalid Request');
    });
  });
});
