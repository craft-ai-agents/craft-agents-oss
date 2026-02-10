import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

describe('default permissions seeding path resolution', () => {
  it('seeds from resources/permissions fallback when shared assets path is absent', async () => {
    const testRoot = join(process.cwd(), '.tmp-test-perm-seed-path-resolution')
    const configDir = join(testRoot, 'config')
    const appPermDir = join(configDir, 'permissions')
    const seededPath = join(appPermDir, 'default.json')

    rmSync(testRoot, { recursive: true, force: true })
    mkdirSync(testRoot, { recursive: true })
    mkdirSync(configDir, { recursive: true })

    process.env.CRAFT_CONFIG_DIR = configDir

    const zhTemplatePath = join(process.cwd(), 'apps/electron/resources/permissions/default.zh-CN.json')
    const originalZhTemplate = readFileSync(zhTemplatePath, 'utf-8')

    // Force a unique marker so we can confirm fallback template was used.
    const marker = `中文模板标记-${Date.now()}`
    writeFileSync(zhTemplatePath, originalZhTemplate.replace('默认权限', marker), 'utf-8')

    try {
      const {
        ensureDefaultPermissions,
        __resetPermissionsInitializationForTests,
      } = await import('../src/agent/permissions-config')

      __resetPermissionsInitializationForTests()
      ensureDefaultPermissions('zh-CN')

      expect(existsSync(seededPath)).toBe(true)
      const seededContent = readFileSync(seededPath, 'utf-8')
      expect(seededContent.includes(marker)).toBe(true)
    } finally {
      // Restore template and clean up
      writeFileSync(zhTemplatePath, originalZhTemplate, 'utf-8')
      rmSync(testRoot, { recursive: true, force: true })
    }
  })
})
