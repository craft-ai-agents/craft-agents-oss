/**
 * Integration test for the main-process i18n bootstrap.
 *
 * Validates the persistent language resolution contract:
 * - `getPersistedUiLanguage()` resolves stored preferences to a supported code.
 * - Calling `i18n.changeLanguage(persisted)` after `setupI18n()` makes
 *   `i18n.resolvedLanguage` match that resolved value.
 *
 * Together these mean: missing, invalid, and valid `uiLanguage` values all
 * produce a supported language for title generation across restarts.
 *
 * `CONFIG_DIR` is captured at module-load, so each scenario runs in a
 * subprocess with `CRAFT_CONFIG_DIR` set in its env (same pattern as
 * `packages/shared/src/config/__tests__/storage-startup-migration.test.ts`).
 */
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

function runScript(configDir: string, script: string): RunResult {
  const result = Bun.spawnSync([process.execPath, '--eval', script], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe('main-process i18n bootstrap', () => {
  it('hydrates main i18n from a persisted uiLanguage', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'i18n-bootstrap-'))
    try {
      const r = runScript(
        configDir,
        `
          import { setupI18n, i18n } from '@craft-agent/shared/i18n';
          import { setPersistedUiLanguage, getPersistedUiLanguage } from '@craft-agent/shared/config';
          setupI18n();
          setPersistedUiLanguage('ru');
          const persisted = getPersistedUiLanguage();
          await i18n.changeLanguage(persisted);
          console.log(JSON.stringify({ persisted, resolved: i18n.resolvedLanguage }));
        `,
      )
      expect(r.exitCode).toBe(0)
      expect(JSON.parse(r.stdout)).toEqual({ persisted: 'ru', resolved: 'ru' })
      expect(existsSync(join(configDir, 'preferences.json'))).toBe(true)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  }, 15_000)

  it('resolves Russian when no language is persisted', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'i18n-bootstrap-'))
    try {
      const r = runScript(
        configDir,
        `
          import { setupI18n, i18n } from '@craft-agent/shared/i18n';
          import { getPersistedUiLanguage } from '@craft-agent/shared/config';
          setupI18n();
          const persisted = getPersistedUiLanguage();
          console.log(JSON.stringify({ persisted: getPersistedUiLanguage(), resolved: i18n.resolvedLanguage }));
        `,
      )
      expect(r.exitCode).toBe(0)
      const { persisted, resolved } = JSON.parse(r.stdout)
      expect(persisted).toBe('ru')
      expect(resolved).toBe('ru')
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  }, 15_000)

  it('resolves Russian for invalid persisted codes', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'i18n-bootstrap-'))
    try {
      writeFileSync(
        join(configDir, 'preferences.json'),
        JSON.stringify({ uiLanguage: 'xx' }),
        'utf-8',
      )
      const r = runScript(
        configDir,
        `
          import { getPersistedUiLanguage } from '@craft-agent/shared/config';
          console.log(JSON.stringify({ value: getPersistedUiLanguage() }));
        `,
      )
      expect(r.exitCode).toBe(0)
      expect(JSON.parse(r.stdout)).toEqual({ value: 'ru' })
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  }, 15_000)
})
