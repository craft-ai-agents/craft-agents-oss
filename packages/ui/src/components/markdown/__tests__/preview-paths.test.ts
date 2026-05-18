import { describe, expect, it } from 'bun:test'
import { resolveSessionPreviewPath } from '../preview-paths'

const SESSION = 'C:/Users/test/.craft-agent/workspaces/ws/sessions/260501-test'

describe('resolveSessionPreviewPath', () => {
  it('leaves absolute Windows paths unchanged', () => {
    expect(resolveSessionPreviewPath('C:/Users/test/image.png', SESSION)).toBe('C:/Users/test/image.png')
    expect(resolveSessionPreviewPath('C:\\Users\\test\\image.png', SESSION)).toBe('C:\\Users\\test\\image.png')
  })

  it('leaves absolute POSIX paths unchanged', () => {
    expect(resolveSessionPreviewPath('/Users/test/image.png', SESSION)).toBe('/Users/test/image.png')
  })

  it('leaves URL-like values unchanged', () => {
    expect(resolveSessionPreviewPath('https://example.com/image.png', SESSION)).toBe('https://example.com/image.png')
    expect(resolveSessionPreviewPath('data:image/png;base64,abc', SESSION)).toBe('data:image/png;base64,abc')
  })

  it('resolves data and plans paths under the session folder', () => {
    expect(resolveSessionPreviewPath('data/image.png', SESSION)).toBe(`${SESSION}/data/image.png`)
    expect(resolveSessionPreviewPath('plans/fix.md', SESSION)).toBe(`${SESSION}/plans/fix.md`)
  })

  it('supports Windows separators for session-relative data/plans paths', () => {
    expect(resolveSessionPreviewPath('data\\nested\\image.png', SESSION)).toBe(`${SESSION}/data/nested/image.png`)
  })

  it('does not resolve session-relative paths without a session folder', () => {
    expect(resolveSessionPreviewPath('data/image.png')).toBe('data/image.png')
  })

  it('does not resolve traversal or malformed relative paths', () => {
    expect(resolveSessionPreviewPath('../image.png', SESSION)).toBe('../image.png')
    expect(resolveSessionPreviewPath('data/../../secret.txt', SESSION)).toBe('data/../../secret.txt')
    expect(resolveSessionPreviewPath('plans/../data/file.png', SESSION)).toBe('plans/../data/file.png')
    expect(resolveSessionPreviewPath('data//file.png', SESSION)).toBe('data//file.png')
    expect(resolveSessionPreviewPath('data/./file.png', SESSION)).toBe('data/./file.png')
  })
})
