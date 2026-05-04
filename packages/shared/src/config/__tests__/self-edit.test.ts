import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSelfEditTarget, validateSelfEditRepo } from '../self-edit.ts';

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), 'runneros-self-edit-'));
}

function writeValidRepo(root: string): void {
  mkdirSync(join(root, '.git'));
  writeFileSync(
    join(root, '.git', 'config'),
    '[remote "origin"]\n\turl = https://github.com/findmikeymike/RunnerOS.git\n',
    'utf-8',
  );
  mkdirSync(join(root, 'apps', 'electron'), { recursive: true });
  mkdirSync(join(root, 'packages', 'shared'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'runneros',
      scripts: {
        'electron:dev': 'bun run electron:dev',
        'typecheck:all': 'bun run typecheck:all',
      },
    }),
    'utf-8',
  );
  writeFileSync(
    join(root, 'apps', 'electron', 'package.json'),
    JSON.stringify({ name: '@craft-agent/electron' }),
    'utf-8',
  );
  writeFileSync(
    join(root, 'packages', 'shared', 'package.json'),
    JSON.stringify({ name: '@craft-agent/shared' }),
    'utf-8',
  );
}

describe('resolveSelfEditTarget', () => {
  test('defaults to disabled when no target exists', () => {
    expect(resolveSelfEditTarget(null, null)).toEqual({
      enabled: false,
      source: 'none',
      repoPath: undefined,
      devCommand: undefined,
      typecheckCommand: undefined,
      lintCommand: undefined,
      testCommand: undefined,
    });
  });

  test('workspace self-edit config overrides global config', () => {
    const resolved = resolveSelfEditTarget(
      { developer: { selfEdit: { enabled: true, repoPath: '/global', testCommand: 'bun test' } } },
      { developer: { selfEdit: { enabled: false, repoPath: '/workspace' } } },
    );

    expect(resolved.enabled).toBe(false);
    expect(resolved.source).toBe('workspace');
    expect(resolved.repoPath).toBe('/workspace');
    expect(resolved.testCommand).toBe('bun test');
  });
});

describe('validateSelfEditRepo', () => {
  test('rejects missing repo path', () => {
    const result = validateSelfEditRepo(undefined);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Self-edit repo path is not configured.');
  });

  test('rejects directories that do not look like RunnerOS', () => {
    const root = tmpRepo();
    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'not-runneros' }), 'utf-8');

      const result = validateSelfEditRepo(root);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing .git directory at repo root.');
      expect(result.errors).toContain('Missing apps/electron; this does not look like RunnerOS.');
      expect(result.errors).toContain('Missing packages/shared; this does not look like RunnerOS.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('accepts a RunnerOS-shaped repo', () => {
    const root = tmpRepo();
    try {
      writeValidRepo(root);

      const result = validateSelfEditRepo(root);

      expect(result.valid).toBe(true);
      expect(result.packageName).toBe('runneros');
      expect(result.errors).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects a generic monorepo with the same folder shape', () => {
    const root = tmpRepo();
    try {
      writeValidRepo(root);
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'generic-electron-monorepo',
          scripts: {
            'electron:dev': 'bun run electron:dev',
            'typecheck:all': 'bun run typecheck:all',
          },
        }),
        'utf-8',
      );

      const result = validateSelfEditRepo(root);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unexpected root package name; this does not look like RunnerOS.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
