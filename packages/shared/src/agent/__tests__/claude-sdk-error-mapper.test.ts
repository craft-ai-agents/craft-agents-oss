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
});
