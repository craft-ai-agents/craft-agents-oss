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
  estimateTokensDensityAware,
} from '../large-response.ts';

describe('tokenLimitFor', () => {
  test('falls back to default without a context window', () => {
    expect(tokenLimitFor(undefined)).toBe(TOKEN_LIMIT);
    expect(tokenLimitFor(0)).toBe(TOKEN_LIMIT);
  });

  test('scales to model context with floor and cap', () => {
    expect(tokenLimitFor(64_000)).toBe(6_400);
    expect(tokenLimitFor(100_000)).toBe(10_000);
    expect(tokenLimitFor(200_000)).toBe(TOKEN_LIMIT);
    expect(tokenLimitFor(16_000)).toBe(2_000);
  });
});

describe('large response context window handling', () => {
  let sessionPath: string;
  const eightKTokenText = ('lorem ipsum dolor sit amet ').repeat(1185).slice(0, 32_000);
  const fakeSummarize = async () => 'mocked summary';

  beforeEach(() => {
    sessionPath = mkdtempSync(join(tmpdir(), 'large-response-'));
  });

  afterEach(() => {
    rmSync(sessionPath, { recursive: true, force: true });
  });

  test('guardLargeResult spills earlier on a 64k-window model', async () => {
    expect(estimateTokens(eightKTokenText)).toBeGreaterThanOrEqual(7_999);

    const result = await guardLargeResult(eightKTokenText, {
      sessionPath,
      toolName: 'test_tool',
      summarize: fakeSummarize,
      contextWindow: 64_000,
    });

    expect(result).not.toBeNull();
    expect(result).toContain('mocked summary');
    expect(existsSync(join(sessionPath, 'long_responses'))).toBe(true);
  });

  test('guardLargeResult preserves default behavior when context window is unknown', async () => {
    const result = await guardLargeResult(eightKTokenText, {
      sessionPath,
      toolName: 'test_tool',
      summarize: fakeSummarize,
    });

    expect(result).toBeNull();
  });

  test('handleLargeResponse uses the same model-aware threshold', async () => {
    const result = await handleLargeResponse({
      text: eightKTokenText,
      sessionPath,
      context: { toolName: 'test_tool' },
      summarize: fakeSummarize,
      contextWindow: 64_000,
    });

    expect(result).not.toBeNull();
    expect(result?.wasSummarized).toBe(true);
    expect(existsSync(result!.filePath)).toBe(true);
    expect(readFileSync(result!.filePath, 'utf-8')).toBe(eightKTokenText);
  });
});

describe('estimateTokensDensityAware', () => {
  test('matches normal estimate for prose', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(800);
    expect(estimateTokensDensityAware(text)).toBe(estimateTokens(text));
  });

  test('escalates MIME-wrapped base64', () => {
    const text = Array.from({ length: 600 }, () => 'A'.repeat(76)).join('\r\n');

    expect(text.length).toBeGreaterThan(45_000);
    expect(estimateTokens(text)).toBeLessThan(12_000);
    expect(estimateTokensDensityAware(text)).toBeGreaterThanOrEqual(12_000);
  });

  test('spills 56KB base64-heavy tool result on a 200k-window model', async () => {
    const sessionPath = mkdtempSync(join(tmpdir(), 'large-response-base64-'));
    try {
      const headers =
        'From: sender@example.com\r\n' +
        'To: recipient@example.com\r\n' +
        'Subject: regression fixture\r\n' +
        'MIME-Version: 1.0\r\n' +
        'Content-Type: multipart/mixed; boundary="bdry"\r\n' +
        '\r\n--bdry\r\nContent-Type: application/pdf\r\n' +
        'Content-Transfer-Encoding: base64\r\n\r\n';
      const body = Array.from({ length: 700 }, () => 'A'.repeat(76)).join('\r\n');
      const text = `${headers}${body}\r\n--bdry--\r\n`;

      const result = await guardLargeResult(text, {
        sessionPath,
        toolName: 'Read',
        summarize: async () => 'mocked summary',
        contextWindow: 200_000,
      });

      expect(result).not.toBeNull();
    } finally {
      rmSync(sessionPath, { recursive: true, force: true });
    }
  });
});
