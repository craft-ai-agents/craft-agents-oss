import { describe, expect, it } from 'bun:test'
import { buildLocaleCandidatePaths } from '../i18n-resource-paths'

describe('main i18n resource path candidates', () => {
  it('builds stable dev path order with monorepo-first lookup', () => {
    const paths = buildLocaleCandidatePaths({
      isPackaged: false,
      cwd: '/repo',
      appPath: '/repo/apps/electron',
      resourcesPath: '/repo/apps/electron/resources',
      locale: 'zh-CN',
      namespace: 'menu',
    })

    expect(paths[0]).toBe('/repo/packages/shared/locales/zh-CN/menu.json')
    expect(paths).toContain('/repo/apps/electron/packages/shared/locales/zh-CN/menu.json')
    expect(paths).toContain('/repo/apps/electron/resources/locales/zh-CN/menu.json')
  })

  it('prioritizes packaged resources path while keeping app fallback', () => {
    const paths = buildLocaleCandidatePaths({
      isPackaged: true,
      cwd: '/ignored',
      appPath: '/Applications/Craft Agents.app/Contents/Resources/app',
      resourcesPath: '/Applications/Craft Agents.app/Contents/Resources',
      locale: 'en',
      namespace: 'dialogs',
    })

    expect(paths[0]).toBe('/Applications/Craft Agents.app/Contents/Resources/locales/en/dialogs.json')
    expect(paths).toContain('/Applications/Craft Agents.app/Contents/Resources/app/packages/shared/locales/en/dialogs.json')
    expect(new Set(paths).size).toBe(paths.length)
  })
})
