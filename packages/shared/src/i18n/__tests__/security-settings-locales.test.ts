import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const localesDirectory = join(import.meta.dir, '..', 'locales')
const localeFiles = readdirSync(localesDirectory).filter((file) => file.endsWith('.json')).sort()
const sources = [
  readFileSync(join(import.meta.dir, '../../../../../apps/electron/src/renderer/pages/settings/SecuritySettingsPage.tsx'), 'utf8'),
  readFileSync(join(import.meta.dir, '../../../../../apps/electron/src/renderer/pages/settings/security/SecuritySnake.tsx'), 'utf8'),
].join('\n')
const sourceKeys = [...sources.matchAll(/t\('([^']+)'/g)]
  .map((match) => match[1]!)
  .filter((key) => key.startsWith('security.'))
const dynamicKeys = [
  ...['critical', 'warn', 'info', 'pass', 'unavailable'].map((severity) => `security.snake.status.${severity}`),
  ...['complete', 'partial', 'none'].map((coverage) => `security.snake.coverage.${coverage}`),
  ...['checked', 'failed', 'not-provisioned', 'unavailable'].map((coverage) => `security.coverage.${coverage}`),
  ...['left', 'right', 'center', 'unknown'].map((direction) => `security.snake.direction.${direction}`),
  ...['ingress', 'sessions', 'tools', 'secrets', 'network', 'extensions', 'isolation'].map((domain) => `security.snake.domain.${domain}`),
  ...['unavailable', 'installing', 'provisioned', 'starting', 'running', 'stopped', 'degraded', 'failed', 'unsupported'].map((state) => `security.runtime.state.${state}`),
]
const registryKeys = ['settings.security.description', 'settings.security.title']
const nativeHostControlConfirmationKeys = [
  'security.confirm.copySetupCredential.detail',
  'security.confirm.copySetupCredential.message',
  'security.confirm.copySetupCredential.title',
  'security.confirm.openControlUi.detail',
  'security.confirm.openControlUi.message',
  'security.confirm.openControlUi.title',
]

describe('security settings locale keys', () => {
  it('keeps one sorted, complete security key set in every current locale', () => {
    const localeEntries = localeFiles.map((file) => {
      const translations = JSON.parse(readFileSync(join(localesDirectory, file), 'utf8')) as Record<string, string>
      return {
        file,
        keys: Object.keys(translations).filter((key) => key.startsWith('security.')),
        translations,
      }
    })
    const russian = localeEntries.find((entry) => entry.file === 'ru.json')

    expect(localeFiles).toHaveLength(8)
    expect(russian).toBeDefined()
    expect(russian!.keys).toEqual([...russian!.keys].sort())

    for (const { file, keys, translations } of localeEntries) {
      expect(keys, file).toEqual(russian!.keys)
      expect(keys).toEqual([...keys].sort())
      expect(Object.keys(translations), file).toEqual([...Object.keys(translations)].sort())
      for (const key of keys) {
        expect(translations[key], `${file}:${key}`).toBeTruthy()
        expect(translations[key], `${file}:${key}`).not.toBe(key)
      }
      expect(translations['settings.security.title'], `${file}:settings.security.title`).toBeTruthy()
      expect(translations['settings.security.description'], `${file}:settings.security.description`).toBeTruthy()
    }

    for (const key of [...sourceKeys, ...dynamicKeys, ...registryKeys, ...nativeHostControlConfirmationKeys]) {
      expect(
        key.startsWith('security.') ? russian!.keys : Object.keys(russian!.translations),
      ).toContain(key)
    }
  })

  it('keeps the canonical Russian title and description user-facing', () => {
    const russian = JSON.parse(readFileSync(join(localesDirectory, 'ru.json'), 'utf8')) as Record<string, string>

    expect(russian['settings.security.title']).toBe('Безопасность')
    expect(russian['settings.security.description']).toBe('Срез рисков, прав и изоляции Craft и OpenClaw')
  })
})
