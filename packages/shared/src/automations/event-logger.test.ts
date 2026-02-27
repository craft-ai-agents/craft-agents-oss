import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AutomationEventLogger } from './event-logger.ts';

describe('AutomationEventLogger', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'event-logger-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('migrates legacy events.jsonl into .craft-agent', async () => {
    writeFileSync(join(tempDir, 'events.jsonl'), '{"event":"legacy"}\n');

    const logger = new AutomationEventLogger(tempDir);
    const migratedPath = logger.getLogPath();

    expect(existsSync(migratedPath)).toBe(true);
    expect(readFileSync(migratedPath, 'utf-8')).toBe('{"event":"legacy"}\n');

    await logger.dispose();
  });

  it('does not overwrite existing .craft-agent/events.jsonl during migration', async () => {
    mkdirSync(join(tempDir, '.craft-agent'), { recursive: true });
    writeFileSync(join(tempDir, '.craft-agent/events.jsonl'), '{"event":"new"}\n');
    writeFileSync(join(tempDir, 'events.jsonl'), '{"event":"legacy"}\n');

    const logger = new AutomationEventLogger(tempDir);
    const migratedPath = logger.getLogPath();

    expect(readFileSync(migratedPath, 'utf-8')).toBe('{"event":"new"}\n');

    await logger.dispose();
  });
});
