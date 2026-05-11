import { describe, test, expect } from 'bun:test';
import { extractLabelId, toggleLabelInList } from '../values.ts';

describe('extractLabelId', () => {
  test('returns the entry verbatim for boolean labels', () => {
    expect(extractLabelId('bug')).toBe('bug');
  });

  test('strips the value portion from valued entries', () => {
    expect(extractLabelId('priority::3')).toBe('priority');
    expect(extractLabelId('due::2026-01-30')).toBe('due');
    // Values containing :: are preserved on the right side; only the first split matters.
    expect(extractLabelId('url::https://a::b')).toBe('url');
  });
});

describe('toggleLabelInList', () => {
  test('appends a label that is not present', () => {
    expect(toggleLabelInList(['bug'], 'urgent')).toEqual(['bug', 'urgent']);
  });

  test('removes a label that is present', () => {
    expect(toggleLabelInList(['bug', 'urgent'], 'bug')).toEqual(['urgent']);
  });

  test('removes all entries matching the base id (handles valued labels)', () => {
    // Toggling "priority" removes "priority::3" too — same logical label.
    expect(toggleLabelInList(['priority::3', 'bug'], 'priority')).toEqual(['bug']);
  });

  test('returns a new array (does not mutate input)', () => {
    const start = ['bug'];
    const after = toggleLabelInList(start, 'bug');
    expect(after).toEqual([]);
    expect(after).not.toBe(start);
    expect(start).toEqual(['bug']);
  });

  test('feeding the result back in compounds correctly under multi-toggle', () => {
    // The race that motivated the optimistic-state hook: rapid taps must
    // not lose updates. Each call is fed the previous result, simulating
    // the optimistic-state setter chaining through React's queue.
    const afterA = toggleLabelInList([], 'A');
    expect(afterA).toEqual(['A']);
    const afterAB = toggleLabelInList(afterA, 'B');
    expect(afterAB).toEqual(['A', 'B']);
    const afterB = toggleLabelInList(afterAB, 'A');
    expect(afterB).toEqual(['B']);
    const afterEmpty = toggleLabelInList(afterB, 'B');
    expect(afterEmpty).toEqual([]);
  });
});
