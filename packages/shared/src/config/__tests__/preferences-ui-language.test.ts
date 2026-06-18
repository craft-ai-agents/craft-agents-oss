/**
 * Tests for the internal `uiLanguage` preference field that backs main-process
 * i18n hydration. See packages/shared/CLAUDE.md → "Cross-process language persistence".
 *
 * `CONFIG_DIR` is captured at module-load from `process.env.CRAFT_CONFIG_DIR`,
 * so each scenario runs in a subprocess with its own tmpdir — the same pattern
 * `storage-startup-migration.test.ts` uses.
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

const PREFS_MODULE = pathToFileURL(join(import.meta.dir, '..', 'preferences.ts')).href;

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runScript(configDir: string, script: string): RunResult {
  const result = Bun.spawnSync([process.execPath, '--eval', script], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function setupDir(): { configDir: string; prefsFile: string } {
  const configDir = mkdtempSync(join(tmpdir(), 'preferences-ui-lang-'));
  return { configDir, prefsFile: join(configDir, 'preferences.json') };
}

function writeRawPrefs(prefsFile: string, contents: Record<string, unknown>) {
  writeFileSync(prefsFile, JSON.stringify(contents, null, 2), 'utf-8');
}

describe('preferences.uiLanguage', () => {
  describe('getPersistedUiLanguage', () => {
    it('returns undefined when the file does not exist', () => {
      const { configDir } = setupDir();
      try {
        const r = runScript(configDir, `
          import { getPersistedUiLanguage } from '${PREFS_MODULE}';
          console.log(JSON.stringify({ value: getPersistedUiLanguage() ?? null }));
        `);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ value: null });
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });

    it('returns undefined when the field is missing', () => {
      const { configDir, prefsFile } = setupDir();
      try {
        writeRawPrefs(prefsFile, { name: 'Alice' });
        const r = runScript(configDir, `
          import { getPersistedUiLanguage } from '${PREFS_MODULE}';
          console.log(JSON.stringify({ value: getPersistedUiLanguage() ?? null }));
        `);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ value: null });
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });

    it('returns the code when valid', () => {
      const { configDir, prefsFile } = setupDir();
      try {
        writeRawPrefs(prefsFile, { uiLanguage: 'es' });
        const r = runScript(configDir, `
          import { getPersistedUiLanguage } from '${PREFS_MODULE}';
          console.log(JSON.stringify({ value: getPersistedUiLanguage() ?? null }));
        `);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ value: 'es' });
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });

    it('returns undefined for unsupported codes (validates against the registry)', () => {
      const { configDir, prefsFile } = setupDir();
      try {
        writeRawPrefs(prefsFile, { uiLanguage: 'xx' });
        const r = runScript(configDir, `
          import { getPersistedUiLanguage } from '${PREFS_MODULE}';
          console.log(JSON.stringify({ value: getPersistedUiLanguage() ?? null }));
        `);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ value: null });
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });
  });

  describe('setPersistedUiLanguage', () => {
    it('writes the value and getter reads it back', () => {
      const { configDir, prefsFile } = setupDir();
      try {
        const r = runScript(configDir, `
          import { setPersistedUiLanguage, getPersistedUiLanguage } from '${PREFS_MODULE}';
          setPersistedUiLanguage('hu');
          console.log(JSON.stringify({ value: getPersistedUiLanguage() ?? null }));
        `);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ value: 'hu' });
        expect(existsSync(prefsFile)).toBe(true);
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });

    it('is idempotent — does not rewrite the file when value is unchanged', () => {
      const { configDir, prefsFile } = setupDir();
      try {
        const r = runScript(configDir, `
          import { setPersistedUiLanguage } from '${PREFS_MODULE}';
          import { statSync } from 'fs';
          setPersistedUiLanguage('hu');
          const first = statSync('${prefsFile}').mtimeMs;
          const start = Date.now();
          while (Date.now() - start < 30) {}
          setPersistedUiLanguage('hu');
          const second = statSync('${prefsFile}').mtimeMs;
          console.log(JSON.stringify({ first, second }));
        `);
        expect(r.exitCode).toBe(0);
        const { first, second } = JSON.parse(r.stdout);
        expect(second).toBe(first);
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });

    it('preserves unrelated fields', () => {
      const { configDir, prefsFile } = setupDir();
      try {
        writeRawPrefs(prefsFile, { name: 'Alice', timezone: 'Europe/Budapest' });
        const r = runScript(configDir, `
          import { setPersistedUiLanguage } from '${PREFS_MODULE}';
          setPersistedUiLanguage('hu');
        `);
        expect(r.exitCode).toBe(0);
        const raw = JSON.parse(readFileSync(prefsFile, 'utf-8'));
        expect(raw.name).toBe('Alice');
        expect(raw.timezone).toBe('Europe/Budapest');
        expect(raw.uiLanguage).toBe('hu');
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });
  });

  describe('legacy `language` field scrubbing', () => {
    it('loadPreferences strips legacy free-text language on read', () => {
      const { configDir, prefsFile } = setupDir();
      try {
        writeRawPrefs(prefsFile, { name: 'Alice', language: 'Hungarian' });
        const r = runScript(configDir, `
          import { loadPreferences } from '${PREFS_MODULE}';
          console.log(JSON.stringify(loadPreferences()));
        `);
        expect(r.exitCode).toBe(0);
        const prefs = JSON.parse(r.stdout);
        expect(prefs).not.toHaveProperty('language');
        expect(prefs.name).toBe('Alice');
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });

    it('the next write drops the legacy language field from disk', () => {
      const { configDir, prefsFile } = setupDir();
      try {
        writeRawPrefs(prefsFile, { name: 'Alice', language: 'Hungarian' });
        const r = runScript(configDir, `
          import { setPersistedUiLanguage } from '${PREFS_MODULE}';
          setPersistedUiLanguage('hu');
        `);
        expect(r.exitCode).toBe(0);
        const raw = JSON.parse(readFileSync(prefsFile, 'utf-8'));
        expect(raw).not.toHaveProperty('language');
        expect(raw.uiLanguage).toBe('hu');
        expect(raw.name).toBe('Alice');
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });
  });
});
