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

    it('matches on context_window hint even without context-1m phrase', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        actualError: {
          errorType: 'invalid_request_error',
          message: 'prompt exceeds the context window for this model',
        },
      });

      expect(error.title).toBe('1M Context Not Available');
    });

    it('matches on tier hint', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', {
        ...baseContext,
        capturedApiError: {
          status: 400,
          statusText: 'Bad Request',
          message: 'Your tier does not have access to this feature',
          timestamp: Date.now(),
        },
      });

      expect(error.title).toBe('1M Context Not Available');
    });

    it('falls back to generic invalid_request when no 1M hints present', () => {
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

    it('falls back to generic invalid_request when no captured/actual error info exists', () => {
      const error = mapClaudeSdkAssistantError('invalid_request', baseContext);

      expect(error.title).toBe('Invalid Request');
    });
  });
});
