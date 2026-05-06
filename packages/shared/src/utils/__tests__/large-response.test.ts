/**
 * Tests for large-response.ts.
 *
 * Covers:
 * - tokenLimitFor: model-aware per-result summarization threshold
 * - guardLargeResult: end-to-end with and without contextWindow
 * - handleLargeResponse: same threshold semantics through the lower-level entry
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  TOKEN_LIMIT,
  tokenLimitFor,
  guardLargeResult,
  handleLargeResponse,
  estimateTokens,
} from '../large-response.ts';

// ============================================================
// tokenLimitFor — pure function, threshold scaling
// ============================================================

describe('tokenLimitFor', () => {
  test('falls back to default when contextWindow is undefined', () => {
    expect(tokenLimitFor(undefined)).toBe(TOKEN_LIMIT);
    expect(tokenLimitFor(undefined)).toBe(15_000);
  });

  test('falls back to default for zero / negative contextWindow', () => {
    expect(tokenLimitFor(0)).toBe(TOKEN_LIMIT);
    expect(tokenLimitFor(-1)).toBe(TOKEN_LIMIT);
  });

  test('caps at the existing default for large-window models', () => {
    expect(tokenLimitFor(200_000)).toBe(TOKEN_LIMIT);
    expect(tokenLimitFor(1_000_000)).toBe(TOKEN_LIMIT);
  });

  test('scales linearly in the middle range', () => {
    expect(tokenLimitFor(64_000)).toBe(6_400);
    expect(tokenLimitFor(128_000)).toBe(12_800);
    expect(tokenLimitFor(100_000)).toBe(10_000);
  });

  test('floors at 2_000 for small-window models', () => {
    // 8_000 * 0.10 = 800 → floor to 2_000
    expect(tokenLimitFor(8_000)).toBe(2_000);
    expect(tokenLimitFor(16_000)).toBe(2_000);
  });

  test('floor boundary: contextWindow * 0.10 == floor', () => {
    // 20_000 * 0.10 = 2_000 → exact floor
    expect(tokenLimitFor(20_000)).toBe(2_000);
  });
});

// ============================================================
// guardLargeResult — integration with model-aware threshold
// ============================================================

describe('guardLargeResult contextWindow handling', () => {
  let sessionPath: string;
  // 8_000-token text (32_000 chars at ~4 chars/token).
  const eightKTokenText = 'a'.repeat(32_000);
  // Trivial deterministic summarizer so tests don't reach an LLM.
  const fakeSummarize = async (_prompt: string) => 'mocked summary';

  beforeEach(() => {
    sessionPath = mkdtempSync(join(tmpdir(), 'large-response-'));
  });

  afterEach(() => {
    rmSync(sessionPath, { recursive: true, force: true });
  });

  test('triggers summarization on a 64k-window model (8k > 6.4k)', async () => {
    expect(estimateTokens(eightKTokenText)).toBe(8_000);
    const result = await guardLargeResult(eightKTokenText, {
      sessionPath,
      toolName: 'test_tool',
      summarize: fakeSummarize,
      contextWindow: 64_000,
    });
    expect(result).not.toBeNull();
    expect(result).toContain('mocked summary');
    // File written to long_responses/.
    expect(existsSync(join(sessionPath, 'long_responses'))).toBe(true);
  });

  test('passes through a 200k-window model (8k < 15k)', async () => {
    const result = await guardLargeResult(eightKTokenText, {
      sessionPath,
      toolName: 'test_tool',
      summarize: fakeSummarize,
      contextWindow: 200_000,
    });
    expect(result).toBeNull();
  });

  test('preserves existing behavior when contextWindow is undefined', async () => {
    // No contextWindow → fixed 15k threshold → 8k passes through.
    const result = await guardLargeResult(eightKTokenText, {
      sessionPath,
      toolName: 'test_tool',
      summarize: fakeSummarize,
    });
    expect(result).toBeNull();
  });

  test('floor still triggers on tiny-window models', async () => {
    // 16k window → 2k threshold → 8k triggers.
    const result = await guardLargeResult(eightKTokenText, {
      sessionPath,
      toolName: 'test_tool',
      summarize: fakeSummarize,
      contextWindow: 16_000,
    });
    expect(result).not.toBeNull();
    expect(result).toContain('mocked summary');
  });
});

// ============================================================
// handleLargeResponse — same threshold semantics, lower-level entry
// ============================================================

describe('handleLargeResponse contextWindow handling', () => {
  let sessionPath: string;
  const eightKTokenText = 'a'.repeat(32_000);
  const fakeSummarize = async (_prompt: string) => 'mocked summary';

  beforeEach(() => {
    sessionPath = mkdtempSync(join(tmpdir(), 'handle-large-response-'));
  });

  afterEach(() => {
    rmSync(sessionPath, { recursive: true, force: true });
  });

  test('returns null below the model-aware threshold (200k window)', async () => {
    const result = await handleLargeResponse({
      text: eightKTokenText,
      sessionPath,
      context: { toolName: 'test_tool' },
      summarize: fakeSummarize,
      contextWindow: 200_000,
    });
    expect(result).toBeNull();
  });

  test('returns a summarized result above the threshold (64k window)', async () => {
    const result = await handleLargeResponse({
      text: eightKTokenText,
      sessionPath,
      context: { toolName: 'test_tool' },
      summarize: fakeSummarize,
      contextWindow: 64_000,
    });
    expect(result).not.toBeNull();
    expect(result?.wasSummarized).toBe(true);
    expect(result?.message).toContain('mocked summary');
    expect(existsSync(result!.filePath)).toBe(true);
    const written = readFileSync(result!.filePath, 'utf-8');
    expect(written).toBe(eightKTokenText);
  });

  test('contextWindow undefined matches pre-change behavior at 8k input', async () => {
    // 8k < TOKEN_LIMIT (15k) → null, identical to pre-change behavior.
    const result = await handleLargeResponse({
      text: eightKTokenText,
      sessionPath,
      context: { toolName: 'test_tool' },
      summarize: fakeSummarize,
    });
    expect(result).toBeNull();
  });
});
