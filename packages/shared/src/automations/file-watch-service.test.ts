import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileWatchService, globToRegex } from './file-watch-service.ts';
import type { AutomationMatcher } from './types.ts';
import type { FileWatchPayload } from './event-bus.ts';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'craft-fw-'));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('globToRegex', () => {
  test('* matches single-segment names', () => {
    expect(globToRegex('*.md').test('foo.md')).toBe(true);
    expect(globToRegex('*.md').test('a/b.md')).toBe(false);
  });

  test('** matches across path separators', () => {
    expect(globToRegex('**/*.md').test('a/b/c.md')).toBe(true);
    expect(globToRegex('**/*.md').test('top.md')).toBe(true);
  });

  test('? matches single character', () => {
    expect(globToRegex('?.txt').test('a.txt')).toBe(true);
    expect(globToRegex('?.txt').test('ab.txt')).toBe(false);
  });

  test('escapes regex metachars', () => {
    expect(globToRegex('a.b').test('a.b')).toBe(true);
    expect(globToRegex('a.b').test('axb')).toBe(false);
  });

  test('character classes', () => {
    expect(globToRegex('[ab].txt').test('a.txt')).toBe(true);
    expect(globToRegex('[ab].txt').test('c.txt')).toBe(false);
  });
});

describe('FileWatchService', () => {
  test('fires on new file matching glob', async () => {
    const dir = makeTempDir();
    try {
      const events: FileWatchPayload[] = [];
      const svc = new FileWatchService({
        workspaceRootPath: dir,
        workspaceId: 'ws-test',
        onEvent: (p) => { events.push(p); },
      });

      const matcher: AutomationMatcher = {
        id: 'm1',
        watchGlob: '**/*.md',
        watchDebounceMs: 50,
        actions: [{ type: 'prompt', prompt: 'noop' }],
      };
      svc.applyMatchers([matcher]);

      // node:fs.watch needs a moment to register
      await sleep(100);

      writeFileSync(join(dir, 'note.md'), '# hi');

      // Wait past debounce + a generous slack for filesystem propagation
      await sleep(400);

      svc.dispose();

      expect(events.length).toBeGreaterThanOrEqual(1);
      const evt = events[0]!;
      expect(evt.matcherId).toBe('m1');
      expect(evt.relativePath.endsWith('note.md')).toBe(true);
      expect(['add', 'change']).toContain(evt.changeType);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('skips files that do not match glob', async () => {
    const dir = makeTempDir();
    try {
      const events: FileWatchPayload[] = [];
      const svc = new FileWatchService({
        workspaceRootPath: dir,
        workspaceId: 'ws-test',
        onEvent: (p) => { events.push(p); },
      });

      svc.applyMatchers([{
        id: 'm-md',
        watchGlob: '**/*.md',
        watchDebounceMs: 30,
        actions: [{ type: 'prompt', prompt: 'noop' }],
      }]);

      await sleep(100);
      writeFileSync(join(dir, 'data.json'), '{}');
      await sleep(300);
      svc.dispose();

      expect(events.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('debounce coalesces rapid writes to the same file', async () => {
    const dir = makeTempDir();
    try {
      const events: FileWatchPayload[] = [];
      const svc = new FileWatchService({
        workspaceRootPath: dir,
        workspaceId: 'ws-test',
        onEvent: (p) => { events.push(p); },
      });

      svc.applyMatchers([{
        id: 'm-debounce',
        watchGlob: '**/*.txt',
        watchDebounceMs: 200,
        actions: [{ type: 'prompt', prompt: 'noop' }],
      }]);

      await sleep(100);
      // Fire 5 rapid writes — debounce should fold these into one event
      const file = join(dir, 'spam.txt');
      for (let i = 0; i < 5; i++) {
        writeFileSync(file, String(i));
        await sleep(20);
      }

      // Wait past debounce window
      await sleep(400);
      svc.dispose();

      // Allow either 1 (debounced ideally) or 2 (one for create, one for changes)
      // depending on platform fs.watch behavior — but never 5.
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.length).toBeLessThanOrEqual(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('per-matcher routing — only the matching matcher receives the event', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'b'));
    try {
      const events: FileWatchPayload[] = [];
      const svc = new FileWatchService({
        workspaceRootPath: dir,
        workspaceId: 'ws-test',
        onEvent: (p) => { events.push(p); },
      });

      svc.applyMatchers([
        {
          id: 'watch-a',
          watchGlob: 'a/**',
          watchDebounceMs: 30,
          actions: [{ type: 'prompt', prompt: 'noop' }],
        },
        {
          id: 'watch-b',
          watchGlob: 'b/**',
          watchDebounceMs: 30,
          actions: [{ type: 'prompt', prompt: 'noop' }],
        },
      ]);

      await sleep(100);
      writeFileSync(join(dir, 'a', 'thing.txt'), 'x');
      await sleep(250);
      svc.dispose();

      // Only watch-a should fire — watch-b's glob doesn't match a/**
      const ids = new Set(events.map((e) => e.matcherId));
      expect(ids.has('watch-a')).toBe(true);
      expect(ids.has('watch-b')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('respects watchChangeTypes filter', async () => {
    const dir = makeTempDir();
    const file = join(dir, 'x.txt');
    writeFileSync(file, 'initial');
    try {
      const events: FileWatchPayload[] = [];
      const svc = new FileWatchService({
        workspaceRootPath: dir,
        workspaceId: 'ws-test',
        onEvent: (p) => { events.push(p); },
      });

      svc.applyMatchers([{
        id: 'remove-only',
        watchGlob: '**/*.txt',
        watchChangeTypes: ['remove'],
        watchDebounceMs: 30,
        actions: [{ type: 'prompt', prompt: 'noop' }],
      }]);

      await sleep(100);
      // Modify — should NOT fire (filtered out)
      writeFileSync(file, 'updated');
      await sleep(150);
      // Now delete — should fire
      unlinkSync(file);
      await sleep(250);
      svc.dispose();

      // Every event must be 'remove' (the modify event is filtered)
      for (const e of events) {
        expect(e.changeType).toBe('remove');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('dispose closes watchers and stops emitting', async () => {
    const dir = makeTempDir();
    try {
      const events: FileWatchPayload[] = [];
      const svc = new FileWatchService({
        workspaceRootPath: dir,
        workspaceId: 'ws-test',
        onEvent: (p) => { events.push(p); },
      });

      svc.applyMatchers([{
        id: 'm',
        watchGlob: '**/*.txt',
        watchDebounceMs: 30,
        actions: [{ type: 'prompt', prompt: 'noop' }],
      }]);

      await sleep(80);
      svc.dispose();
      // Write AFTER dispose — should not fire any event
      writeFileSync(join(dir, 'late.txt'), 'no');
      await sleep(200);

      expect(events.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
