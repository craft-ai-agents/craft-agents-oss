/**
 * URL log redaction: query VALUES are a credential channel (query-auth
 * sources put the API key there), so redactUrlForLog must never let one
 * through — while keeping enough shape (origin, path, param names) for the
 * log line to stay useful.
 */

import { describe, test, expect } from 'bun:test';
import { REDACTED_VALUE, redactSensitiveValues, redactUrlForLog } from '../redaction.ts';

describe('redactSensitiveValues cycle handling', () => {
  test('a diamond (same object under two keys, no cycle) is preserved in BOTH branches', () => {
    const shared = { total: 42, nested: { label: 'x' } };
    const out = redactSensitiveValues({ a: shared, b: shared, list: [shared] });
    expect(out.a).toEqual(shared);
    expect(out.b).toEqual(shared); // was '[Circular]' with visited-set semantics
    expect(out.list[0]).toEqual(shared);
  });

  test('a genuine cycle still collapses to [Circular]', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    const out = redactSensitiveValues(node) as Record<string, unknown>;
    expect(out.name).toBe('root');
    expect(out.self).toBe('[Circular]');
  });

  test('sensitive keys and the depth cap are unchanged', () => {
    const out = redactSensitiveValues({ apiKey: 'sk-live', safe: 1 });
    expect(out.apiKey).toBe(REDACTED_VALUE);
    expect(out.safe).toBe(1);

    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 12; i++) deep = { child: deep };
    expect(JSON.stringify(redactSensitiveValues(deep))).toContain('[MaxDepth]');
  });
});

describe('redactUrlForLog', () => {
  test('replaces every query value, keeps origin + path + param names', () => {
    const out = redactUrlForLog('https://api.example.com/v2/search?api_key=sk-live-9f8e7d&q=budapest');
    expect(out).toBe(`https://api.example.com/v2/search?api_key=${REDACTED_VALUE}&q=${REDACTED_VALUE}`);
    expect(out).not.toContain('sk-live-9f8e7d');
    expect(out).not.toContain('budapest');
  });

  test('dedupes repeated parameter names', () => {
    const out = redactUrlForLog('https://api.example.com/x?tag=a&tag=b&tag=c');
    expect(out).toBe(`https://api.example.com/x?tag=${REDACTED_VALUE}`);
  });

  test('no query → plain origin + path (no trailing "?")', () => {
    expect(redactUrlForLog('https://api.example.com/v1/ping')).toBe('https://api.example.com/v1/ping');
  });

  test('drops userinfo and fragment', () => {
    const out = redactUrlForLog('https://user:hunter2@api.example.com/path#access_token=abc');
    expect(out).toBe('https://api.example.com/path');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('access_token');
  });

  test('unparseable input yields a fixed placeholder, never the raw string', () => {
    expect(redactUrlForLog('not a url ?api_key=leaky')).toBe('[unparseable-url]');
    expect(redactUrlForLog('')).toBe('[unparseable-url]');
  });
});
