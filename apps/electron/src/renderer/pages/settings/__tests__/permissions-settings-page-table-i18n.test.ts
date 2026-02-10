import { describe, expect, it } from 'bun:test'

describe('permissions settings table labels', () => {
  it('uses localized write-path comment/pattern labels', () => {
    const table = {
      allowedWritePath: '允许写入路径',
      writeToPattern: '写入：{{pattern}}',
    }

    const stringPath = '/tmp'
    const objectPath = '/workspace/src'

    const stringComment = table.allowedWritePath
    const stringPattern = table.writeToPattern.replace('{{pattern}}', stringPath)

    const objectComment = table.allowedWritePath
    const objectPattern = table.writeToPattern.replace('{{pattern}}', objectPath)

    expect(stringComment).toBe('允许写入路径')
    expect(stringPattern).toBe('写入：/tmp')
    expect(objectComment).toBe('允许写入路径')
    expect(objectPattern).toBe('写入：/workspace/src')
  })
})
