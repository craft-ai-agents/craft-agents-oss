import { describe, expect, test } from 'bun:test'
import {
  detectSiyuanBinary,
  siyuanBinaryCandidates,
  shouldAutoStartSiyuan,
  SIYUAN_INSTALL_URL,
  SIYUAN_LOCAL_BASE_URL,
} from '../siyuan-binary'

describe('siyuanBinaryCandidates', () => {
  test('darwin includes Applications kernel + MacOS paths and PATH entries', () => {
    const list = siyuanBinaryCandidates({
      platform: 'darwin',
      homeDir: '/Users/me',
      pathEnv: '/opt/bin:/usr/local/bin',
    })
    expect(list).toContain('/Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel')
    expect(list).toContain('/Applications/SiYuan.app/Contents/MacOS/SiYuan')
    expect(list).toContain('/Users/me/Applications/SiYuan.app/Contents/MacOS/SiYuan')
    expect(list).toContain('/opt/bin/siyuan')
    expect(list).toContain('/usr/local/bin/SiYuan-Kernel')
  })

  test('linux includes common install prefixes', () => {
    const list = siyuanBinaryCandidates({
      platform: 'linux',
      homeDir: '/home/me',
      pathEnv: '',
    })
    expect(list).toContain('/usr/bin/siyuan')
    expect(list).toContain('/home/me/.local/bin/siyuan')
  })

  test('win32 includes Program Files paths', () => {
    const list = siyuanBinaryCandidates({
      platform: 'win32',
      homeDir: 'C:\\Users\\me',
      pathEnv: 'C:\\Tools',
    })
    expect(list.some((p) => p.includes('Program Files') && p.endsWith('SiYuan.exe'))).toBe(true)
    expect(list).toContain('C:\\Tools\\siyuan.exe')
  })

  test('extraCandidates are prepended and deduped', () => {
    const list = siyuanBinaryCandidates({
      platform: 'darwin',
      pathEnv: '',
      homeDir: '',
      extraCandidates: [
        '/custom/SiYuan-Kernel',
        '/Applications/SiYuan.app/Contents/MacOS/SiYuan',
      ],
    })
    expect(list[0]).toBe('/custom/SiYuan-Kernel')
    expect(list.filter((p) => p === '/Applications/SiYuan.app/Contents/MacOS/SiYuan')).toHaveLength(1)
  })
})

describe('detectSiyuanBinary', () => {
  test('returns first existing candidate via injected existsSync', () => {
    const existing = new Set([
      '/Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel',
    ])
    const found = detectSiyuanBinary({
      platform: 'darwin',
      pathEnv: '',
      homeDir: '',
      existsSync: (p) => existing.has(p),
    })
    expect(found).toBe('/Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel')
  })

  test('returns null when nothing exists', () => {
    const found = detectSiyuanBinary({
      platform: 'darwin',
      pathEnv: '',
      homeDir: '',
      existsSync: () => false,
    })
    expect(found).toBeNull()
  })

  test('skips candidates that throw on existsSync', () => {
    const found = detectSiyuanBinary({
      platform: 'linux',
      pathEnv: '/bin',
      homeDir: '',
      existsSync: (p) => {
        if (p.includes('/usr/')) throw new Error('eacces')
        return p === '/bin/siyuan'
      },
    })
    expect(found).toBe('/bin/siyuan')
  })
})

describe('shouldAutoStartSiyuan', () => {
  test('defaults on for darwin when env unset', () => {
    expect(shouldAutoStartSiyuan({}, 'darwin')).toBe(true)
  })

  test('defaults off for non-darwin when env unset', () => {
    expect(shouldAutoStartSiyuan({}, 'linux')).toBe(false)
    expect(shouldAutoStartSiyuan({}, 'win32')).toBe(false)
  })

  test('honors CRAFT_SIYUAN_AUTO_START=0/1', () => {
    expect(shouldAutoStartSiyuan({ CRAFT_SIYUAN_AUTO_START: '0' }, 'darwin')).toBe(false)
    expect(shouldAutoStartSiyuan({ CRAFT_SIYUAN_AUTO_START: 'false' }, 'darwin')).toBe(false)
    expect(shouldAutoStartSiyuan({ CRAFT_SIYUAN_AUTO_START: '1' }, 'linux')).toBe(true)
    expect(shouldAutoStartSiyuan({ CRAFT_SIYUAN_AUTO_START: 'true' }, 'win32')).toBe(true)
  })
})

describe('constants', () => {
  test('install URL and local base URL are stable', () => {
    expect(SIYUAN_INSTALL_URL).toMatch(/^https:\/\//)
    expect(SIYUAN_LOCAL_BASE_URL).toBe('http://127.0.0.1:6806')
  })
})
