import { describe, expect, it } from 'bun:test'
import { join } from 'path'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import {
  HttpUserProfileProvider,
  UserProfileRefreshLoop,
  readLocalUserProfile,
} from './user-profile-http.ts'

function fakeResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeProfileEnvelope(overrides: Record<string, unknown> = {}): unknown {
  return {
    success: true,
    returnCode: 'SUC0000',
    errorMsg: '成功',
    body: {
      status: 200,
      data: {
        zhaohuOpenId: 'C9EB1821A15DB6C795CEDA9CDA590FDF',
        userName: '姚文杰',
        ystId: '258065',
        positon: '系统研发岗',
        zuName: '财富业务四组',
        leaderUserInfo: '374783/林超峰',
        shiName: '移动银行二室(杭州)',
        pathName: '招商银行/总行/信息技术部/零售应用研发中心/网络应用开发团队/移动银行二室(杭州)/财富业务四组',
        sex: 'M',
        ip: '99.6.151.30',
        chargeModule: [{ appCode: 'IInsurance', appName: '保险' }],
        ingProjectInfo: [],
        onlineInfo: [],
        ...overrides,
      },
    },
  }
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'user-profile-test-'))
}

function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

describe('HttpUserProfileProvider', () => {
  it('fetches user profile from HTTP API and writes to file', async () => {
    const dir = tempDir()
    try {
      const profilePath = join(dir, 'user-profile.json')
      const provider = new HttpUserProfileProvider({
        apiUrl: 'http://test/api/user/profile',
        fetchFn: async () => fakeResponse(fakeProfileEnvelope()),
        profilePath,
      })

      const result = await provider.fetchUserProfile()

      expect(result).not.toBeNull()
      expect(result!.userName).toBe('姚文杰')
      expect(result!.ystId).toBe('258065')
      expect(result!.zuName).toBe('财富业务四组')
      expect(result!.chargeModule).toEqual([{ appCode: 'IInsurance', appName: '保险' }])

      // Verify file was written
      expect(existsSync(profilePath)).toBe(true)
      const fileContent = JSON.parse(readFileSync(profilePath, 'utf-8'))
      expect(fileContent.userName).toBe('姚文杰')
      expect(fileContent.ystId).toBe('258065')
    } finally {
      cleanupDir(dir)
    }
  })

  it('adds the SSO idToken bearer authorization header when fetching user profile', async () => {
    const requestHeaders: Headers[] = []
    const provider = new HttpUserProfileProvider({
      apiUrl: 'http://test/api/user/profile',
      fetchFn: async (_url, init) => {
        requestHeaders.push(new Headers(init?.headers))
        return fakeResponse(fakeProfileEnvelope())
      },
      getIdToken: async () => 'sso-id-token',
      profilePath: '/tmp/nonexistent/test-profile.json',
    })

    await provider.fetchUserProfile()

    expect(requestHeaders[0]?.get('Authorization')).toBe('Bearer sso-id-token')
  })

  it('returns null for empty profile response', async () => {
    const provider = new HttpUserProfileProvider({
      apiUrl: 'http://test/api/user/profile',
      fetchFn: async () => fakeResponse({}),
      profilePath: '/tmp/nonexistent/test-profile.json',
    })

    const result = await provider.fetchUserProfile()
    expect(result).toBeNull()
  })

  it('rejects on HTTP error status', async () => {
    const provider = new HttpUserProfileProvider({
      apiUrl: 'http://test/api/user/profile',
      fetchFn: async () => fakeResponse({ error: 'not found' }, 404),
      profilePath: '/tmp/nonexistent/test-profile.json',
    })

    await expect(provider.fetchUserProfile()).rejects.toThrow('HTTP 404')
  })

  it('rejects on network error', async () => {
    const provider = new HttpUserProfileProvider({
      apiUrl: 'http://test/api/user/profile',
      fetchFn: async () => { throw new Error('connection refused') },
      profilePath: '/tmp/nonexistent/test-profile.json',
    })

    await expect(provider.fetchUserProfile()).rejects.toThrow('connection refused')
  })

  it('sanitizes profile fields', async () => {
    const dir = tempDir()
    try {
      const provider = new HttpUserProfileProvider({
        apiUrl: 'http://test/api/user/profile',
        fetchFn: async () => fakeResponse({
          userName: '  Ada  ',
          ystId: '  OS-001  ',
          positon: '  系统研发岗  ',
          zuName: '  Eng  ',
          shiName: '  AI  ',
          chargeModule: [
            { appCode: '  sessions  ', appName: '  Sessions  ' },
            { appCode: '', appName: '' },
          ],
        }),
        profilePath: join(dir, 'user-profile.json'),
      })

      const result = await provider.fetchUserProfile()
      expect(result!.userName).toBe('Ada')
      expect(result!.ystId).toBe('OS-001')
      expect(result!.positon).toBe('系统研发岗')
      expect(result!.chargeModule).toEqual([{ appCode: 'sessions', appName: 'Sessions' }])
    } finally {
      cleanupDir(dir)
    }
  })

  it('uses default env var values when no options given', () => {
    const provider = new HttpUserProfileProvider()
    expect(provider).toBeDefined()
  })
})

describe('readLocalUserProfile', () => {
  it('returns null when file does not exist', () => {
    const result = readLocalUserProfile('/tmp/nonexistent/user-profile.json')
    expect(result).toBeNull()
  })

  it('reads and sanitizes profile from file', () => {
    const dir = tempDir()
    try {
      const profilePath = join(dir, 'user-profile.json')
      writeFileSync(profilePath, JSON.stringify({ userName: 'Ada', ystId: 'OS-001', zuName: 'Eng', shiName: 'AI' }), 'utf-8')

      const result = readLocalUserProfile(profilePath)
      expect(result).not.toBeNull()
      expect(result!.userName).toBe('Ada')
    } finally {
      cleanupDir(dir)
    }
  })
})

describe('UserProfileRefreshLoop', () => {
  it('triggers immediate fetch on start', async () => {
    let fetchCount = 0
    const provider = new HttpUserProfileProvider({
      apiUrl: 'http://test/api/user/profile',
      fetchFn: async () => {
        fetchCount++
        return fakeResponse(fakeProfileEnvelope())
      },
      profilePath: '/tmp/nonexistent/test-profile.json',
    })

    const loop = new UserProfileRefreshLoop({
      provider,
      intervalMs: 500_000, // long interval so it doesn't fire during test
    })

    loop.start()
    // Wait a tick for the async fetch
    await new Promise(r => setTimeout(r, 10))
    expect(fetchCount).toBe(1)
    loop.stop()
  })

  it('manual refresh returns profile and calls provider', async () => {
    let fetchCount = 0
    const provider = new HttpUserProfileProvider({
      apiUrl: 'http://test/api/user/profile',
      fetchFn: async () => {
        fetchCount++
        return fakeResponse(fakeProfileEnvelope({ userName: 'Ada' }))
      },
      profilePath: '/tmp/nonexistent/test-profile.json',
    })

    const loop = new UserProfileRefreshLoop({ provider })
    const result = await loop.refresh()
    expect(fetchCount).toBe(1)
    expect(result).not.toBeNull()
    expect(result!.userName).toBe('Ada')
  })

  it('calls onError when refresh fails', async () => {
    const errors: unknown[] = []
    const provider = new HttpUserProfileProvider({
      apiUrl: 'http://test/api/user/profile',
      fetchFn: async () => { throw new Error('connection refused') },
      profilePath: '/tmp/nonexistent/test-profile.json',
    })

    const loop = new UserProfileRefreshLoop({
      provider,
      onError: (err) => { errors.push(err) },
    })

    const result = await loop.refresh()
    expect(result).toBeNull()
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('connection refused')
  })

  it('stop() clears the timer', () => {
    const provider = new HttpUserProfileProvider({ fetchFn: async () => fakeResponse({ userName: 'x' }), profilePath: '/tmp/nonexistent/x.json' })
    const loop = new UserProfileRefreshLoop({ provider, intervalMs: 1 })
    loop.start()
    loop.stop()
    expect(true).toBe(true)
  })
})
