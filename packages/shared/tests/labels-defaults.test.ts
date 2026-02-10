import { describe, it, expect } from 'bun:test'
import { getDefaultLabelConfig } from '../src/labels/storage'

describe('getDefaultLabelConfig', () => {
  it('returns localized Chinese label names when language is zh-CN', () => {
    const config = getDefaultLabelConfig('zh-CN')
    const rootNames = config.labels.map(label => label.name)

    expect(rootNames).toEqual([
      '开发',
      '内容',
      '优先级',
      '项目',
    ])
  })
})
