import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

describe('permissions default templates', () => {
  it('includes zh-CN default permissions template', () => {
    const zhTemplatePath = join(process.cwd(), 'apps/electron/resources/permissions/default.zh-CN.json')
    expect(existsSync(zhTemplatePath)).toBe(true)

    const content = readFileSync(zhTemplatePath, 'utf-8')
    expect(content.includes('默认权限')).toBe(true)
    expect(content.includes('列出目录内容')).toBe(true)
    expect(content.includes('跨 MCP 数据源搜索')).toBe(true)
  })
})
