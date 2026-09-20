import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MAX_LOG_ENTRY_CHARS,
  _resetLogStateForTesting,
  _setLogFileForTesting,
  _setLogLimitsForTesting,
  appendLogEntry,
  getLastApiError,
  initLogFile,
  setStoredError,
  toolMetadataStore,
} from '../interceptor-common.ts';

describe('interceptor-common', () => {
  let sessionDirA: string;
  let sessionDirB: string;

  beforeEach(() => {
    sessionDirA = mkdtempSync(join(tmpdir(), 'interceptor-a-'));
    sessionDirB = mkdtempSync(join(tmpdir(), 'interceptor-b-'));
  });

  afterEach(() => {
    toolMetadataStore._clearForTesting();
    _resetLogStateForTesting();
    rmSync(sessionDirA, { recursive: true, force: true });
    rmSync(sessionDirB, { recursive: true, force: true });
  });

  it('keeps API errors session-scoped when session dir is switched', () => {
    toolMetadataStore.setSessionDir(sessionDirA);
    setStoredError({
      status: 401,
      statusText: 'Unauthorized',
      message: 'Session A auth failed',
      timestamp: Date.now(),
    });

    toolMetadataStore.setSessionDir(sessionDirB);
    setStoredError({
      status: 429,
      statusText: 'Too Many Requests',
      message: 'Session B rate limit',
      timestamp: Date.now(),
    });

    toolMetadataStore.setSessionDir(sessionDirA);
    const errA = getLastApiError();
    expect(errA?.status).toBe(401);

    toolMetadataStore.setSessionDir(sessionDirB);
    const errB = getLastApiError();
    expect(errB?.status).toBe(429);
  });

  it('merges new metadata with existing on-disk entries', () => {
    const existing = {
      existingTool: {
        intent: 'Existing',
        displayName: 'Existing Tool',
        timestamp: Date.now() - 1000,
      },
    };

    writeFileSync(join(sessionDirA, 'tool-metadata.json'), JSON.stringify(existing), 'utf-8');
    toolMetadataStore.setSessionDir(sessionDirA);

    toolMetadataStore.set('newTool', {
      intent: 'New intent',
      displayName: 'New Tool',
      timestamp: Date.now(),
    });

    const persisted = JSON.parse(readFileSync(join(sessionDirA, 'tool-metadata.json'), 'utf-8')) as Record<string, unknown>;
    expect(persisted.existingTool).toBeDefined();
    expect(persisted.newTool).toBeDefined();
  });
});

describe('interceptor log bounding', () => {
  let logDir: string;
  let logFile: string;

  beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), 'interceptor-log-'));
    logFile = join(logDir, 'interceptor.log');
    _setLogFileForTesting(logFile);
    // checkIntervalMs/checkChars of 0 make every write consult the real file size,
    // so rotation is exercised without sleeping on the throttle.
    _setLogLimitsForTesting({ checkIntervalMs: 0, checkChars: 0, maxAgeMs: Number.MAX_SAFE_INTEGER });
  });

  afterEach(() => {
    _resetLogStateForTesting();
    rmSync(logDir, { recursive: true, force: true });
  });

  it('rotates when the active file exceeds the size limit', () => {
    _setLogLimitsForTesting({ maxBytes: 2048 });
    // Each entry is ~1 KB, so the loop crosses the 2 KB limit several times.
    const entryChars = 1000;

    for (let i = 0; i < 12; i++) appendLogEntry('x'.repeat(entryChars));

    // Rotation runs before the append that would grow the file, so the active file
    // may overshoot by at most the entry that triggered the check.
    expect(statSync(logFile).size).toBeLessThan(2048 + entryChars + 200);
    expect(statSync(logFile + '.prev').size).toBeGreaterThan(0);
  });

  it('keeps a single rotation slot instead of accumulating files', () => {
    _setLogLimitsForTesting({ maxBytes: 1024 });

    for (let i = 0; i < 40; i++) appendLogEntry('y'.repeat(1000));

    const files = readdirSync(logDir).filter((name) => name.startsWith('interceptor.log'));
    expect(files.sort()).toEqual(['interceptor.log', 'interceptor.log.prev']);
  });

  it('rotates a log that has not been written to within the age limit', () => {
    // -1 so the check is "any existing mtime is stale", independent of clock granularity.
    _setLogLimitsForTesting({ maxBytes: Number.MAX_SAFE_INTEGER, maxAgeMs: -1 });

    appendLogEntry('first');
    appendLogEntry('second');

    expect(readFileSync(logFile + '.prev', 'utf-8')).toContain('first');
    expect(readFileSync(logFile, 'utf-8')).toContain('second');
  });

  it('truncates a single oversized entry', () => {
    appendLogEntry('z'.repeat(MAX_LOG_ENTRY_CHARS + 1000));

    const content = readFileSync(logFile, 'utf-8');
    expect(content).toContain(`[ENTRY TRUNCATED at ${MAX_LOG_ENTRY_CHARS} chars]`);
    // Timestamp and marker only — the entry must not be stored in full.
    expect(content.length).toBeLessThan(MAX_LOG_ENTRY_CHARS + 200);
  });

  it('reclaims an already-oversized log at startup', () => {
    _setLogLimitsForTesting({ maxBytes: 1024 });
    writeFileSync(logFile, 'g'.repeat(65536));

    initLogFile(logFile);

    expect(statSync(logFile).size).toBe(0);
  });

  it('rotates a stale log at startup', () => {
    _setLogLimitsForTesting({ maxBytes: Number.MAX_SAFE_INTEGER, maxAgeMs: -1 });
    writeFileSync(logFile, 'stale\n');

    initLogFile(logFile);

    expect(readFileSync(logFile + '.prev', 'utf-8')).toBe('stale\n');
  });
});
