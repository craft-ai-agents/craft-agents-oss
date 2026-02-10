import { describe, expect, it } from 'bun:test'
import { getPermissionsTableColumnTitles, getLabelsTableColumnTitles } from '../table-column-labels'

describe('table header i18n wiring', () => {
  it('uses localized permission table headers', () => {
    const headers = getPermissionsTableColumnTitles({
      access: '访问',
      type: '类型',
      pattern: '模式',
      comment: '备注',
    })

    expect(headers.access).toBe('访问')
    expect(headers.type).toBe('类型')
    expect(headers.pattern).toBe('模式')
    expect(headers.comment).toBe('备注')
  })

  it('uses localized labels table headers', () => {
    const headers = getLabelsTableColumnTitles({
      color: '颜色',
      name: '名称',
      type: '类型',
    })

    expect(headers.color).toBe('颜色')
    expect(headers.name).toBe('名称')
    expect(headers.type).toBe('类型')
  })
})
