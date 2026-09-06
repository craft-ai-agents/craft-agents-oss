/**
 * Tests for the shared secret-redaction utilities (used by both Sentry
 * beforeSend hooks and the Pages action audit log).
 */

import { describe, it, expect } from 'bun:test';
import {
  isSensitiveKeyName,
  redactSensitiveHeaders,
  redactSensitiveHeadersInPlace,
  redactSensitiveKeysInPlace,
  redactSensitiveValues,
  REDACTED_VALUE,
} from './redaction.ts';

describe('utils/redaction', () => {
  it('matches key names broadly (historical beforeSend semantics)', () => {
    expect(isSensitiveKeyName('apiToken')).toBe(true);
    expect(isSensitiveKeyName('SECRET_VALUE')).toBe(true);
    expect(isSensitiveKeyName('Authorization')).toBe(true);
    expect(isSensitiveKeyName('password')).toBe(true);
    expect(isSensitiveKeyName('x-api-key')).toBe(true);
    expect(isSensitiveKeyName('cookie')).toBe(true);
    expect(isSensitiveKeyName('page')).toBe(false);
    expect(isSensitiveKeyName('total')).toBe(false);
  });

  it('redacts sensitive headers case-insensitively, preserving casing', () => {
    const redacted = redactSensitiveHeaders({
      Authorization: 'Bearer sk-123',
      'X-API-Key': 'abc',
      'Content-Type': 'application/json',
    });
    expect(redacted).toEqual({
      Authorization: REDACTED_VALUE,
      'X-API-Key': REDACTED_VALUE,
      'Content-Type': 'application/json',
    });
  });

  it('mutates headers/data records in place (Sentry hook shape)', () => {
    const headers: Record<string, unknown> = { authorization: 'Bearer x', accept: 'json' };
    redactSensitiveHeadersInPlace(headers);
    expect(headers).toEqual({ authorization: REDACTED_VALUE, accept: 'json' });

    const data: Record<string, unknown> = { refreshToken: 'r', count: 3 };
    redactSensitiveKeysInPlace(data);
    expect(data).toEqual({ refreshToken: REDACTED_VALUE, count: 3 });
  });

  it('deep-redacts nested values without mutating the input', () => {
    const input = {
      query: { page: 1 },
      auth: { nested: 'whole subtree goes' },
      list: [{ apiKey: 'k', keep: 'me' }],
    };
    const result = redactSensitiveValues(input);

    expect(result.auth).toBe(REDACTED_VALUE as never);
    expect(result.list[0]).toEqual({ apiKey: REDACTED_VALUE, keep: 'me' } as never);
    expect(result.query.page).toBe(1);
    // Input untouched
    expect(input.list[0]!.apiKey).toBe('k');
    expect(input.auth.nested).toBe('whole subtree goes');
  });

  it('handles cycles and depth caps without throwing', () => {
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic.self = cyclic;
    const result = redactSensitiveValues(cyclic) as Record<string, unknown>;
    expect(result.name).toBe('x');
    expect(result.self).toBe('[Circular]');

    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 20; i++) deep = { child: deep };
    expect(() => redactSensitiveValues(deep)).not.toThrow();
  });
});
