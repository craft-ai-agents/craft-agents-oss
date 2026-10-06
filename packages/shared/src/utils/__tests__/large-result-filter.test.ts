import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { askLargeResultFilter, handleLargeResponse, setLargeResultFilter, type LargeResultFilter } from '../large-response.ts';

// ~20k tokens of plain text: above the default threshold.
const bigText = 'word '.repeat(80_000);

describe('large result filter', () => {
  let sessionPath: string;
  let summarized = 0;
  const summarize = async () => { summarized++; return 'mocked summary'; };

  beforeEach(() => {
    sessionPath = mkdtempSync(join(tmpdir(), 'large-result-filter-'));
    summarized = 0;
  });

  afterEach(() => {
    setLargeResultFilter(null);
    rmSync(sessionPath, { recursive: true, force: true });
  });

  const intent = 'find the error';
  const run = (withIntent = true) =>
    handleLargeResponse({ text: bigText, sessionPath, context: { toolName: 'search', intent: withIntent ? intent : undefined }, summarize });

  test('summarizes as before without a filter', async () => {
    expect((await run())?.wasSummarized).toBe(true);
    expect(summarized).toBe(1);
  });

  test('gives the agent the kept parts instead of a summary', async () => {
    const seen: Parameters<LargeResultFilter>[0][] = [];
    setLargeResultFilter(async (input) => {
      seen.push(input);
      return { text: 'the relevant part', kept: 2, total: 9 };
    });
    const result = await run();
    expect(summarized).toBe(0);
    expect(result?.wasSummarized).toBe(false);
    expect(seen[0]).toMatchObject({ context: { toolName: 'search', intent: 'find the error' }, budgetChars: 24_000, filePath: result?.filePath });
    expect(seen[0]!.text).toBe(bigText);
    expect(result?.message).toContain('2 of 9 parts kept as relevant to "find the error"');
    expect(result?.message).toContain(`Full data saved to: ${result?.filePath}`);
    expect(result?.message).toContain('the relevant part');
  });

  test('summarizes without an intent, without an answer, or when the filter fails', async () => {
    let asked = 0;
    setLargeResultFilter(async () => { asked++; return null; });
    expect((await run(false))?.wasSummarized).toBe(true);
    expect(asked).toBe(0);
    expect((await run())?.wasSummarized).toBe(true);
    expect(asked).toBe(1);
    setLargeResultFilter(async () => { throw new Error('down'); });
    expect((await run())?.wasSummarized).toBe(true);
    expect(summarized).toBe(3);
  });

  test('answers for another process (the Pi subprocess) with the installed filter', async () => {
    const input = { text: 'abc', context: { toolName: 'bash', intent: 'x' }, budgetChars: 100, filePath: '/f' };
    expect(await askLargeResultFilter(input)).toBeNull();
    setLargeResultFilter(async () => ({ text: 'a', kept: 1, total: 4 }));
    expect(await askLargeResultFilter(input)).toEqual({ text: 'a', kept: 1, total: 4 });
    setLargeResultFilter(async () => { throw new Error('down'); });
    expect(await askLargeResultFilter(input)).toBeNull();
  });
});
