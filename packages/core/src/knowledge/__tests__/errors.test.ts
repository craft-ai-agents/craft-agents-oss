import { describe, expect, test } from 'bun:test';

import { KnowledgeError, type KnowledgeErrorCode } from '../errors.ts';
import { validateKnowledgeRef, type KnowledgeRef } from '../refs.ts';

describe('KnowledgeError', () => {
  test('carries code, message, details and a stable name', () => {
    const error = new KnowledgeError('NOT_FOUND', 'node missing', { id: 'n-1' });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(KnowledgeError);
    expect(error.name).toBe('KnowledgeError');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('node missing');
    expect(error.details).toEqual({ id: 'n-1' });
  });

  test('details are optional', () => {
    expect(new KnowledgeError('PROVIDER_ERROR', 'boom').details).toBeUndefined();
  });

  test('every KnowledgeErrorCode is constructible (P1 read-only set, mutations excluded)', () => {
    const codes: KnowledgeErrorCode[] = [
      'CONNECTION_UNAVAILABLE',
      'UNSUPPORTED_OPERATION',
      'NOT_FOUND',
      'HASH_CONFLICT',
      'INVALID_REF',
      'CAPABILITY_DISABLED',
      'PROVIDER_ERROR',
    ];
    expect(codes).toHaveLength(7);
    for (const code of codes) {
      expect(new KnowledgeError(code, 'x').code).toBe(code);
    }
  });
});

describe('validateKnowledgeRef', () => {
  const invalidShapes: Array<[string, unknown]> = [
    ['null', null],
    ['non-object', 'siyuan/block/b1'],
    ['empty object', {}],
    ['wrong scheme', { scheme: 'craft', kind: 'session', id: 's1' }],
    ['unknown kind', { scheme: 'siyuan', kind: 'flow', id: 'f1' }],
    ['empty id', { scheme: 'siyuan', kind: 'block', id: '' }],
    ['non-string id', { scheme: 'siyuan', kind: 'block', id: 7 }],
    ['bad provider segment', { scheme: 'siyuan', kind: 'block', id: 'b1', provider: 'UPPER_CASE' }],
    ['non-string connectionId', { scheme: 'siyuan', kind: 'block', id: 'b1', connectionId: 42 }],
  ];

  for (const [label, input] of invalidShapes) {
    test(`throws a typed INVALID_REF for ${label}`, () => {
      let caught: unknown;
      try {
        validateKnowledgeRef(input);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(KnowledgeError);
      expect((caught as KnowledgeError).code).toBe('INVALID_REF');
    });
  }

  test('accepts canonical refs and returns them unchanged', () => {
    const minimal: KnowledgeRef = { scheme: 'siyuan', kind: 'block', id: 'b1' };
    const full: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'd1', provider: 'memory', connectionId: 'c1' };
    expect(validateKnowledgeRef(minimal)).toBe(minimal);
    expect(validateKnowledgeRef(full)).toBe(full);
  });
});
