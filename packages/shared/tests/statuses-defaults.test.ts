import { describe, it, expect } from 'bun:test'
import { getDefaultStatusConfig } from '../src/statuses/storage'

describe('getDefaultStatusConfig', () => {
  it('returns localized Chinese labels when language is zh-CN', () => {
    const config = getDefaultStatusConfig('zh-CN')
    const labels = config.statuses.map(status => status.label)

    expect(labels).toEqual([
      '待办队列',
      '待处理',
      '需要复核',
      '已完成',
      '已取消',
    ])
  })
})
