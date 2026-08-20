import { describe, expect, test } from 'bun:test';
import { hashMindMapSource, normalizeMindMapPart } from '../hash.ts';

describe('hashMindMapSource', () => {
  test('same inputs produce same hash', () => {
    const a = hashMindMapSource(['root', 'child-a', 'child-b']);
    const b = hashMindMapSource(['root', 'child-a', 'child-b']);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('matches SHA-256 for a known payload', () => {
    expect(hashMindMapSource(['abc'])).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('matches SHA-256 across UTF-8 and multiple blocks', () => {
    expect(hashMindMapSource(['a'.repeat(100)])).toBe(
      '2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e',
    );
    expect(hashMindMapSource(['π🙂'])).toBe(
      '4f775c9ffa6d6d36f1e9099830376f1f22b7ade9afa0f312801ff0b876948bad',
    );
  });

  test('order of parts affects hash', () => {
    const a = hashMindMapSource(['a', 'b']);
    const b = hashMindMapSource(['b', 'a']);
    expect(a).not.toBe(b);
  });

  test('label change affects hash', () => {
    const a = hashMindMapSource(['node:1:Hello']);
    const b = hashMindMapSource(['node:1:Hello!']);
    expect(a).not.toBe(b);
  });

  test('normalizes CRLF to LF before hashing', () => {
    const a = hashMindMapSource(['line1\r\nline2']);
    const b = hashMindMapSource(['line1\nline2']);
    expect(a).toBe(b);
  });

  test('empty parts stay unambiguous via NUL join', () => {
    const a = hashMindMapSource(['a', '', 'b']);
    const b = hashMindMapSource(['a', 'b']);
    expect(a).not.toBe(b);
  });
});

describe('normalizeMindMapPart', () => {
  test('converts bare CR and CRLF to LF', () => {
    expect(normalizeMindMapPart('a\r\nb\rc')).toBe('a\nb\nc');
  });
});
