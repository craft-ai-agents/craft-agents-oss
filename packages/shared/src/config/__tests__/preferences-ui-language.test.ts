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
    it('returns the Russian default when the file does not exist', () => {
      const { configDir } = setupDir();
      try {
        const r = runScript(configDir, `
          import { getPersistedUiLanguage } from '${PREFS_MODULE}';
          console.log(JSON.stringify({ value: getPersistedUiLanguage() ?? null }));
        `);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ value: 'ru' });
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });

    it('returns the Russian default when the field is missing', () => {
      const { configDir, prefsFile } = setupDir();
      try {
        writeRawPrefs(prefsFile, { name: 'Alice' });
        const r = runScript(configDir, `
          import { getPersistedUiLanguage } from '${PREFS_MODULE}';
          console.log(JSON.stringify({ value: getPersistedUiLanguage() ?? null }));
        `);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ value: 'ru' });
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

    it('maps unsupported persisted codes to the Russian default', () => {
      const { configDir, prefsFile } = setupDir();
      try {
        writeRawPrefs(prefsFile, { uiLanguage: 'xx' });
        const r = runScript(configDir, `
          import { getPersistedUiLanguage } from '${PREFS_MODULE}';
          console.log(JSON.stringify({ value: getPersistedUiLanguage() }));
        `);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ value: 'ru' });
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
          setPersistedUiLanguage('ko');
          console.log(JSON.stringify({ value: getPersistedUiLanguage() ?? null }));
        `);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ value: 'ko' });
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
          setPersistedUiLanguage('ko');
          const first = statSync('${prefsFile}').mtimeMs;
          const start = Date.now();
          while (Date.now() - start < 30) {}
          setPersistedUiLanguage('ko');
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
          setPersistedUiLanguage('ko');
        `);
        expect(r.exitCode).toBe(0);
        const raw = JSON.parse(readFileSync(prefsFile, 'utf-8'));
        expect(raw.name).toBe('Alice');
        expect(raw.timezone).toBe('Europe/Budapest');
        expect(raw.uiLanguage).toBe('ko');
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });
  });

  describe('resolveTitleLanguageName', () => {
    it('returns the Russian default when no UI language is persisted', () => {
      const { configDir } = setupDir();
      try {
        const r = runScript(configDir, `
          import { resolveTitleLanguageName } from '${PREFS_MODULE}';
          console.log(JSON.stringify({ value: resolveTitleLanguageName() ?? null }));
        `);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ value: 'Русский' });
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });

    it('maps a persisted code to its native language name', () => {
      const { configDir, prefsFile } = setupDir();
      try {
        writeRawPrefs(prefsFile, { uiLanguage: 'es' });
        const r = runScript(configDir, `
          import { resolveTitleLanguageName } from '${PREFS_MODULE}';
          console.log(JSON.stringify({ value: resolveTitleLanguageName() ?? null }));
        `);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ value: 'Español' });
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });

    it('resolves the Chinese native name (the #885 motivating case)', () => {
      const { configDir, prefsFile } = setupDir();
      try {
        writeRawPrefs(prefsFile, { uiLanguage: 'zh-Hans' });
        const r = runScript(configDir, `
          import { resolveTitleLanguageName } from '${PREFS_MODULE}';
          console.log(JSON.stringify({ value: resolveTitleLanguageName() ?? null }));
        `);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ value: '简体中文' });
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });

    it('honors an explicit English UI language (returns "English", not auto-detect)', () => {
      const { configDir, prefsFile } = setupDir();
      try {
        writeRawPrefs(prefsFile, { uiLanguage: 'en' });
        const r = runScript(configDir, `
          import { resolveTitleLanguageName } from '${PREFS_MODULE}';
          console.log(JSON.stringify({ value: resolveTitleLanguageName() ?? null }));
        `);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ value: 'English' });
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });

    it('maps a removed persisted code to the Russian language name', () => {
      const { configDir, prefsFile } = setupDir();
      try {
        writeRawPrefs(prefsFile, { uiLanguage: 'hu' });
        const r = runScript(configDir, `
          import { resolveTitleLanguageName } from '${PREFS_MODULE}';
          console.log(JSON.stringify({ value: resolveTitleLanguageName() ?? null }));
        `);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ value: 'Русский' });
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
          setPersistedUiLanguage('ko');
        `);
        expect(r.exitCode).toBe(0);
        const raw = JSON.parse(readFileSync(prefsFile, 'utf-8'));
        expect(raw).not.toHaveProperty('language');
        expect(raw.uiLanguage).toBe('ko');
        expect(raw.name).toBe('Alice');
      } finally {
        rmSync(configDir, { recursive: true, force: true });
      }
    });
  });
});
